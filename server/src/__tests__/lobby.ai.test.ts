import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/client.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$12$hashedpassword"),
    compare: vi.fn(),
  },
}));

vi.mock("../points/points.service.js", () => ({
  deductPoints: vi.fn().mockResolvedValue(undefined),
  addPoints: vi.fn().mockResolvedValue(undefined),
  getPoints: vi.fn().mockResolvedValue(10000),
  createBuyInHold: vi.fn().mockResolvedValue(undefined),
  activateBuyInHold: vi.fn().mockResolvedValue(true),
  refundBuyInHold: vi.fn().mockResolvedValue(true),
  settleBuyInHold: vi.fn().mockResolvedValue(true),
  updateBuyInHoldAmount: vi.fn().mockResolvedValue(true),
  recoverUnsettledBuyInHolds: vi.fn().mockResolvedValue(0),
}));

vi.mock("../ai/llm.client.js", () => ({
  callLlm: vi.fn().mockResolvedValue({ action: "fold" }),
}));

// Wraps the real decideAiAction so tests can simulate a hung decision.
vi.mock("../ai/decision.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/decision.js")>();
  return { ...actual, decideAiAction: vi.fn(actual.decideAiAction) };
});

vi.mock("../voice/livekit.service.js", () => ({
  livekitService: {
    getRoomName: () => "room",
    generateToken: async () => "token",
    getClientUrl: () => "ws://localhost:7880",
  },
}));

// Deterministic dealing: identity shuffle + an optional rigged deck order.
const deckRig = vi.hoisted(() => ({ cards: null as unknown[] | null }));
vi.mock("../poker/deck.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../poker/deck.js")>();
  return {
    ...actual,
    createDeck: (): Card[] =>
      deckRig.cards ? ([...deckRig.cards] as Card[]) : actual.createDeck(),
    shuffle: (deck: Card[]) => deck,
  };
});

import { prisma } from "../db/client.js";
import {
  deductPoints,
  addPoints,
  settleBuyInHold,
} from "../points/points.service.js";
import { callLlm } from "../ai/llm.client.js";
import { decideAiAction } from "../ai/decision.js";
import { ensureAiAccounts, resetAiStateForTests } from "../ai/accounts.js";
import { LobbyHandler, SETTLEMENT_WINDOW_MS } from "../lobby/lobby.handler.js";
import { roomManager } from "../lobby/room.manager.js";
import { Room } from "../lobby/room.js";
import { PokerEngine } from "../poker/engine.js";
import type { Card } from "../poker/types.js";

interface SentMessage {
  userId?: string;
  userIds?: string[];
  type: string;
  payload: unknown;
}

function makeFakeGateway() {
  const sent: SentMessage[] = [];
  return {
    sent,
    sendToUser: vi.fn((userId: string, type: string, payload: unknown) => {
      sent.push({ userId, type, payload });
    }),
    broadcast: vi.fn((userIds: string[], type: string, payload: unknown) => {
      sent.push({ userIds, type, payload });
    }),
    broadcastAll: vi.fn((type: string, payload: unknown) => {
      sent.push({ type, payload });
    }),
  };
}

const card = (rank: string, suit: string): Card => ({ rank, suit }) as Card;

function resetRoom(room: Room) {
  for (const seat of room.seats) {
    seat.userId = null;
    seat.username = null;
    seat.chips = 0;
    seat.buyIn = 0;
    seat.connected = false;
    seat.autoManaged = false;
    seat.confirmed = false;
    seat.isAi = false;
  }
  room.hostId = null;
  room.entryOrder = [];
  room.status = "waiting";
  room.autoResume = false;
  room.spectators = [];
  room.pendingSeatReservations = [];
  room.pendingLeaveUserIds = [];
  room.dealerSeatIndex = null;
}

describe("lobby AI lifecycle", () => {
  let gateway: ReturnType<typeof makeFakeGateway>;
  let handler: LobbyHandler;
  let room: Room;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockImplementation(
      async (args: { data: { username: string } }) =>
        ({
          id: `ai-${args.data.username}`,
          username: args.data.username,
          password: "x",
          points: 10000,
          isAi: true,
          createdAt: new Date(),
        }) as never,
    );

    resetAiStateForTests();
    await ensureAiAccounts();

    gateway = makeFakeGateway();
    handler = new LobbyHandler(gateway as never);
    room = roomManager.getRoom("main")!;
    resetRoom(room);
    handler["engines"].clear();
    handler["aiPending"].clear();
    handler["engineGeneration"].clear();
    handler["roomCommandQueues"].clear();
    handler["disconnectedActionRooms"].clear();
    handler["seatDisconnectVersions"].clear();
    handler["pendingDisconnectDeadlines"].clear();
    handler["seatDisconnectTimers"].forEach((timer) => clearTimeout(timer));
    handler["seatDisconnectTimers"].clear();
    handler["pendingDisconnectTimers"].forEach((timer) => clearTimeout(timer));
    handler["pendingDisconnectTimers"].clear();
  });

  afterEach(() => {
    handler["seatDisconnectTimers"].forEach((timer) => clearTimeout(timer));
    handler["pendingDisconnectTimers"].forEach((timer) => clearTimeout(timer));
    handler["engines"].clear();
    resetRoom(room);
  });

  async function joinAndConfirm(userId: string, username: string) {
    await handler.handleMessage(userId, username, "room:join", {
      roomId: "main",
    });
    await handler.handleMessage(userId, username, "room:confirm", {
      buyIn: room.settings.minBuyIn,
    });
  }

  async function addAiAs(hostId: string) {
    await handler.handleMessage(hostId, "host", "ai:add", {});
  }

  // ----------------------------------------------------------------
  // ai:add / ai:remove
  // ----------------------------------------------------------------

  describe("ai:add", () => {
    it("seats a pool AI with confirmed min buy-in and deducts points", async () => {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");

      const seat = room.aiSeats()[0];
      expect(seat).toBeDefined();
      expect(seat!.username).toBe("AI_XiaoZhi");
      expect(seat!.confirmed).toBe(true);
      expect(seat!.chips).toBe(room.settings.minBuyIn);
      expect(deductPoints).toHaveBeenCalledWith(
        seat!.userId,
        room.settings.minBuyIn,
      );
    });

    it("rejects non-host", async () => {
      await joinAndConfirm("h1", "alice");
      await joinAndConfirm("h2", "bob");
      await handler.handleMessage("h2", "bob", "ai:add", {});
      expect(room.aiSeats()).toHaveLength(0);
      expect(
        gateway.sent.some(
          (m) =>
            m.userId === "h2" &&
            m.type === "room:error" &&
            (m.payload as { code: string }).code === "NOT_HOST",
        ),
      ).toBe(true);
    });

    it("rejects when the room is full", async () => {
      room.settings.maxPlayers = 2;
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      gateway.sent.length = 0;
      await addAiAs("h1");
      expect(room.aiSeats()).toHaveLength(1);
      expect(
        gateway.sent.some(
          (m) =>
            m.type === "room:error" &&
            (m.payload as { code: string }).code === "ROOM_FULL",
        ),
      ).toBe(true);
      room.settings.maxPlayers = 9;
    });

    it("rejects when no pool account is free", async () => {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      await addAiAs("h1");
      await addAiAs("h1");
      expect(room.aiSeats()).toHaveLength(3);
      gateway.sent.length = 0;
      await addAiAs("h1");
      expect(room.aiSeats()).toHaveLength(3);
      expect(
        gateway.sent.some(
          (m) =>
            m.type === "room:error" &&
            (m.payload as { code: string }).code === "NO_FREE_AI",
        ),
      ).toBe(true);
    });

    it("rolls the seat back when the AI account cannot pay", async () => {
      await joinAndConfirm("h1", "alice");
      vi.mocked(deductPoints).mockRejectedValueOnce(
        new Error("INSUFFICIENT_POINTS"),
      );
      await addAiAs("h1");
      expect(room.aiSeats()).toHaveLength(0);
      expect(
        gateway.sent.some(
          (m) =>
            m.type === "room:error" &&
            (m.payload as { code: string }).code === "AI_INSUFFICIENT_POINTS",
        ),
      ).toBe(true);
    });

    it("resumes a paused game once the AI confirms", async () => {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      room.status = "playing";
      handler["startEngine"](room);
      // Human busts → pause
      room.findSeatByUserId("h1")!.chips = 0;
      room.findSeatByUserId("h1")!.confirmed = false;
      room.status = "waiting";
      room.autoResume = true;

      await handler.handleMessage("h1", "alice", "room:confirm", {
        buyIn: room.settings.minBuyIn,
      });
      expect(room.status).toBe("playing");
      expect(room.autoResume).toBe(false);
      expect(handler["engines"].has(room.id)).toBe(true);
    });
  });

  describe("ai:remove", () => {
    it("removes immediately during waiting and refunds chips", async () => {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      const aiId = room.aiSeats()[0]!.userId!;
      vi.mocked(addPoints).mockClear();

      await handler.handleMessage("h1", "host", "ai:remove", {
        targetUserId: aiId,
      });
      expect(room.aiSeats()).toHaveLength(0);
      expect(addPoints).toHaveBeenCalledWith(aiId, room.settings.minBuyIn);
    });

    it("defers removal to the hand boundary during a game", async () => {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      room.status = "playing";
      handler["startEngine"](room);
      const ai = room.aiSeats()[0]!;

      const aiId = ai.userId!;
      await handler.handleMessage("h1", "host", "ai:remove", {
        targetUserId: aiId,
      });
      expect(room.findSeatByUserId(aiId)).toBeDefined();
      expect(room.pendingLeaveUserIds).toContain(aiId);

      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      expect(room.aiSeats()).toHaveLength(0);
      expect(addPoints).toHaveBeenCalledWith(aiId, room.settings.minBuyIn);
    });
  });

  describe("manual leave during a hand", () => {
    async function startPlayingWithHumans() {
      await joinAndConfirm("h1", "alice");
      await joinAndConfirm("h2", "bob");
      await joinAndConfirm("h3", "carol");
      room.status = "playing";
      handler["startEngine"](room);
    }

    it("folds the leaver and keeps the same engine for the remaining players", async () => {
      await startPlayingWithHumans();
      const engine = handler["engines"].get(room.id)!;
      const handNumber = engine.getState().handNumber;

      await handler.handleMessage("h2", "bob", "room:leave", {});

      expect(handler["engines"].get(room.id)).toBe(engine);
      expect(engine.getState().handNumber).toBe(handNumber);
      expect(
        engine.getState().players.find((p) => p.userId === "h2")?.folded,
      ).toBe(true);
      expect(room.pendingLeaveUserIds).toContain("h2");
      expect(room.findSeatByUserId("h2")?.connected).toBe(false);
      expect(room.status).toBe("playing");

      await handler.handleMessage("h2", "bob", "room:leave", {});
      expect(room.pendingLeaveUserIds).toEqual(["h2"]);
      expect(
        engine.getState().actionLog.filter((entry) => entry === "bob fold"),
      ).toHaveLength(1);
    });

    it("removes the leaver and refunds only the remaining stack at the hand boundary", async () => {
      await startPlayingWithHumans();
      const engine = handler["engines"].get(room.id)!;
      await handler.handleMessage("h1", "alice", "room:leave", {});

      let guard = 0;
      while (engine.getState().phase !== "settled" && guard++ < 100) {
        const state = engine.getState();
        const current = state.players[state.currentPlayerIndex]!;
        const actions = engine.getAvailableActionsForPlayer(current.userId);
        const check = actions.find((action) => action.type === "check");
        const call = actions.find((action) => action.type === "call");
        expect(
          engine.handleAction(
            current.userId,
            check ? "check" : "call",
            call?.amount,
          ),
        ).toBe(true);
      }
      expect(engine.getState().phase).toBe("settled");

      const remainingStack = engine
        .getState()
        .players.find((player) => player.userId === "h1")!.chips;
      vi.mocked(addPoints).mockClear();
      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      expect(room.findSeatByUserId("h1")).toBeUndefined();
      expect(room.pendingLeaveUserIds).toEqual([]);
      expect(addPoints).toHaveBeenCalledWith("h1", remainingStack);
      expect(handler["engines"].get(room.id)).not.toBe(engine);
      expect(
        handler["engines"]
          .get(room.id)!
          .getState()
          .players.map((p) => p.userId),
      ).not.toContain("h1");
    });

    it("settles a manual leaver's active hold exactly once", async () => {
      await startPlayingWithHumans();
      const engine = handler["engines"].get(room.id)!;
      const seat = room.findSeatByUserId("h2")!;
      const player = engine.getState().players.find((p) => p.userId === "h2")!;
      seat.buyInHoldOperationId = "hold-h2";

      await handler.handleMessage("h2", "bob", "room:leave", {});

      let guard = 0;
      while (engine.getState().phase !== "settled" && guard++ < 100) {
        const state = engine.getState();
        const current = state.players[state.currentPlayerIndex]!;
        const actions = engine.getAvailableActionsForPlayer(current.userId);
        const check = actions.find((action) => action.type === "check");
        const call = actions.find((action) => action.type === "call");
        expect(
          engine.handleAction(
            current.userId,
            check ? "check" : "call",
            call?.amount,
          ),
        ).toBe(true);
      }
      expect(engine.getState().phase).toBe("settled");

      vi.mocked(settleBuyInHold).mockClear();
      vi.mocked(addPoints).mockClear();
      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      expect(settleBuyInHold).toHaveBeenCalledTimes(1);
      expect(settleBuyInHold).toHaveBeenCalledWith("hold-h2", player.chips);
      expect(addPoints).not.toHaveBeenCalledWith("h2", expect.anything());
      expect(room.findSeatByUserId("h2")).toBeUndefined();
    });

    it("defers a leave received in the settlement window to the single hand boundary", async () => {
      await startPlayingWithHumans();
      const engine = handler["engines"].get(room.id)!;
      engine.getState().phase = "settled";

      await handler.handleMessage("h2", "bob", "room:leave", {});
      expect(handler["engines"].get(room.id)).toBe(engine);
      expect(room.pendingLeaveUserIds).toEqual(["h2"]);

      const oldGeneration = handler["engineGeneration"].get(room.id)!;
      await handler["handleHandEnd"](room, oldGeneration);
      const nextEngine = handler["engines"].get(room.id)!;
      expect(nextEngine).not.toBe(engine);
      expect(
        nextEngine.getState().players.map((player) => player.userId),
      ).not.toContain("h2");

      await handler["handleHandEnd"](room, oldGeneration);
      expect(handler["engines"].get(room.id)).toBe(nextEngine);
    });

    it("does not pause the remaining humans when the leaver has zero chips", async () => {
      await startPlayingWithHumans();
      const engine = handler["engines"].get(room.id)!;
      const seat = room.findSeatByUserId("h2")!;
      seat.chips = 0;
      seat.confirmed = false;
      room.autoResume = true;
      engine.getState().phase = "settled";

      await handler.handleMessage("h2", "bob", "room:leave", {});
      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      expect(room.status).toBe("playing");
      expect(room.autoResume).toBe(false);
      expect(room.findSeatByUserId("h2")).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // Hand boundary: AI rebuy / pure-AI dissolve / rebuild
  // ----------------------------------------------------------------

  describe("hand boundary", () => {
    async function startPlayingWithAi() {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      room.status = "playing";
      handler["startEngine"](room);
      return room.aiSeats()[0]!;
    }

    it("auto-rebuys busted AI seats and keeps the game running", async () => {
      const ai = await startPlayingWithAi();
      room.findSeatByUserId(ai.userId!)!.chips = 0; // busted this hand

      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      expect(deductPoints).toHaveBeenCalledWith(
        ai.userId,
        room.settings.minBuyIn,
      );
      const seat = room.findSeatByUserId(ai.userId!)!;
      expect(seat.confirmed).toBe(true);
      // The rebuilt hand may already have posted a blind or completed an AI
      // action before this assertion runs; the rebuy invariant is confirmed
      // status plus a positive stack.
      expect(seat.chips).toBeGreaterThan(0);
      expect(room.status).toBe("playing");
      expect(room.autoResume).toBe(false);
      const engine = handler["engines"].get(room.id)!;
      expect(engine.getState().players.map((p) => p.userId)).toContain(
        ai.userId,
      );
    });

    it("removes the AI without minting chips when rebuy fails", async () => {
      const ai = await startPlayingWithAi();
      const aiId = ai.userId!;
      room.findSeatByUserId(aiId)!.chips = 0;
      vi.mocked(deductPoints).mockRejectedValueOnce(
        new Error("INSUFFICIENT_POINTS"),
      );
      vi.mocked(addPoints).mockClear();

      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      expect(room.findSeatByUserId(aiId)).toBeUndefined();
      // busted chips were 0 → nothing may be credited back
      expect(addPoints).not.toHaveBeenCalledWith(aiId, expect.anything());
      // single human left → back to waiting, no engine
      expect(room.status).toBe("waiting");
      expect(handler["engines"].has(room.id)).toBe(false);
    });

    it("seats an AI added mid-hand at the next rebuild", async () => {
      await joinAndConfirm("h1", "alice");
      await joinAndConfirm("h2", "bob");
      room.status = "playing";
      handler["startEngine"](room);

      await addAiAs("h1");
      const ai = room.aiSeats()[0]!;
      let engine = handler["engines"].get(room.id)!;
      expect(engine.getState().players.map((p) => p.userId)).not.toContain(
        ai.userId,
      );

      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      engine = handler["engines"].get(room.id)!;
      expect(engine.getState().players.map((p) => p.userId)).toContain(
        ai.userId,
      );
      // The AI posts a blind in the rebuilt hand (it is in the roster).
      const aiPlayer = engine
        .getState()
        .players.find((p) => p.userId === ai.userId)!;
      expect(aiPlayer.totalBet).toBeGreaterThanOrEqual(0);
    });

    it("dissolves a pure-AI table when the last human leaves mid-hand", async () => {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      room.status = "playing";
      handler["startEngine"](room);
      const aiId = room.aiSeats()[0]!.userId!;
      vi.mocked(addPoints).mockClear();

      await handler.handleMessage("h1", "alice", "room:leave", {});
      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      expect(room.playerCount).toBe(0);
      expect(addPoints).toHaveBeenCalledWith(aiId, expect.any(Number));
      expect(room.status).toBe("waiting");
      expect(handler["engines"].has(room.id)).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // Spectating (观战)
  // ----------------------------------------------------------------

  describe("spectating", () => {
    async function startPlayingWithAi() {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      room.status = "playing";
      handler["startEngine"](room);
    }

    it("join mid-hand enters as spectator with a card-hidden snapshot", async () => {
      await startPlayingWithAi();
      gateway.sent.length = 0;

      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });

      expect(room.isSpectator("h2")).toBe(true);
      expect(room.findSeatByUserId("h2")).toBeUndefined();
      expect(
        gateway.sent.some((m) => m.userId === "h2" && m.type === "room:error"),
      ).toBe(false);

      const update = gateway.sent.find(
        (m) => m.userId === "h2" && m.type === "poker:update",
      );
      expect(update).toBeDefined();
      const payload = update!.payload as {
        state: { players: { cards: unknown[] }[] };
        availableActions: unknown[];
      };
      expect(payload.availableActions).toEqual([]);
      for (const p of payload.state.players) expect(p.cards).toEqual([]);

      // Spectators get no voice token.
      expect(
        gateway.sent.some((m) => m.userId === "h2" && m.type === "voice:token"),
      ).toBe(false);
    });

    it("full waiting room enters as spectator without displacing anyone", async () => {
      room.settings.maxPlayers = 2;
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      expect(room.isFull).toBe(true);
      vi.mocked(addPoints).mockClear();

      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });

      expect(room.isSpectator("h2")).toBe(true);
      // The AI seat is untouched — no refund, no swap.
      expect(room.aiSeats()).toHaveLength(1);
      expect(addPoints).not.toHaveBeenCalled();
      room.settings.maxPlayers = 9;
    });

    it("engine updates reach spectators with no hole cards", async () => {
      await startPlayingWithAi();
      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });
      gateway.sent.length = 0;

      const engine = handler["engines"].get(room.id)!;
      engine.handleAction("h1", "raise", 4);

      const toSpectator = gateway.sent.filter(
        (m) => m.type === "poker:update" && m.userIds?.includes("h2"),
      );
      expect(toSpectator.length).toBeGreaterThan(0);
      for (const m of toSpectator) {
        const payload = m.payload as {
          state: { players: { cards: unknown[] }[] };
          availableActions: unknown[];
        };
        expect(payload.availableActions).toEqual([]);
        for (const p of payload.state.players) expect(p.cards).toEqual([]);
      }
    });

    it("hand results are broadcast to spectators", async () => {
      await startPlayingWithAi();
      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });
      gateway.sent.length = 0;

      handler["engines"].get(room.id)!.handleAction("h1", "fold");

      expect(
        gateway.sent.some(
          (m) => m.type === "poker:hand_result" && m.userIds?.includes("h2"),
        ),
      ).toBe(true);
    });

    it("spectator seats themselves once a seat frees up", async () => {
      room.settings.maxPlayers = 2;
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });
      expect(room.isSpectator("h2")).toBe(true);

      // Still spectating while the room is full.
      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });
      expect(room.isSpectator("h2")).toBe(true);

      const aiId = room.aiSeats()[0]!.userId!;
      await handler.handleMessage("h1", "alice", "ai:remove", {
        targetUserId: aiId,
      });

      gateway.sent.length = 0;
      await handler.handleMessage("h2", "bob", "room:join", {
        roomId: "main",
        seatIndex: 1,
      });
      expect(room.isSpectator("h2")).toBe(false);
      const seat = room.findSeatByUserId("h2")!;
      expect(seat.index).toBe(1);
      expect(seat.confirmed).toBe(false); // must confirm the buy-in
      expect(
        gateway.sent.some((m) => m.userId === "h2" && m.type === "voice:token"),
      ).toBe(true);
      room.settings.maxPlayers = 9;
    });

    it("room:leave and disconnect remove spectators immediately", async () => {
      await startPlayingWithAi();
      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });
      expect(room.isSpectator("h2")).toBe(true);

      handler.handleDisconnect("h2");
      expect(room.isSpectator("h2")).toBe(false);
      // Players are untouched by spectator cleanup.
      expect(room.playerCount).toBe(2);

      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });
      expect(room.isSpectator("h2")).toBe(true);
      await handler.handleMessage("h2", "bob", "room:leave", {});
      expect(room.isSpectator("h2")).toBe(false);
    });

    it("reconnect restores the spectator snapshot without voice", async () => {
      await startPlayingWithAi();
      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });
      gateway.sent.length = 0;

      await handler.handleMessage("h2", "bob", "reconnect", {});

      expect(
        gateway.sent.some(
          (m) => m.userId === "h2" && m.type === "poker:update",
        ),
      ).toBe(true);
      expect(
        gateway.sent.some(
          (m) =>
            m.userId === "h2" &&
            m.type === "reconnect:success" &&
            (m.payload as { roomId: string }).roomId === "main",
        ),
      ).toBe(true);
      expect(
        gateway.sent.some((m) => m.userId === "h2" && m.type === "voice:token"),
      ).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // AI turns + real hand integration
  // ----------------------------------------------------------------

  describe("AI turns", () => {
    it("drives the AI seat server-side so the hand never stalls", async () => {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      room.status = "playing";
      handler["startEngine"](room);

      const engine = handler["engines"].get(room.id)!;
      const state = engine.getState();
      // Heads-up style 2-player hand: dealer idx0 (h1) is SB and acts first.
      expect(state.players).toHaveLength(2);
      const current = state.players[state.currentPlayerIndex];
      expect(current.userId).toBe("h1");

      // Human raises; the AI (BB) must respond via the mocked LLM (fold).
      expect(engine.handleAction("h1", "raise", 4)).toBe(true);
      await vi.waitFor(() => {
        expect(engine.getState().phase).toBe("settled");
      });
      expect(callLlm).toHaveBeenCalled();
    });

    it("falls back to check/fold when the LLM is unavailable", async () => {
      vi.mocked(callLlm).mockResolvedValue(null);
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      room.status = "playing";
      handler["startEngine"](room);

      const engine = handler["engines"].get(room.id)!;
      engine.handleAction("h1", "raise", 4);
      await vi.waitFor(() => {
        expect(engine.getState().phase).toBe("settled");
      });
      // AI had to call the raise (no check) → fallback folded.
      expect(
        engine.getState().players.find((p) => p.isAi)?.folded ?? true,
      ).toBe(true);
    });

    it("watchdog forces a fallback action if the decision hangs forever", async () => {
      const original = vi.mocked(decideAiAction).getMockImplementation();
      vi.useFakeTimers();
      try {
        vi.mocked(decideAiAction).mockReturnValue(
          new Promise(() => {}) as never,
        );
        await joinAndConfirm("h1", "alice");
        await addAiAs("h1");
        room.status = "playing";
        handler["startEngine"](room);

        const engine = handler["engines"].get(room.id)!;
        engine.handleAction("h1", "raise", 4);
        // Watchdog fires at aiTimeoutMs + 5000 even though decide never
        // resolves; the fallback calls the raise and the hand advances.
        await vi.advanceTimersByTimeAsync(16000);
        expect(engine.getState().phase).toBe("flop");
        expect(
          engine.getState().actionLog.some((l) => l.includes("call")),
        ).toBe(true);
      } finally {
        vi.useRealTimers();
        if (original) vi.mocked(decideAiAction).mockImplementation(original);
      }
    });

    it("pauses with autoResume when a human busts, resuming after rebuy", async () => {
      vi.useFakeTimers();
      try {
        await joinAndConfirm("h1", "alice");
        await addAiAs("h1");
        room.status = "playing";

        // Build the engine manually so the deck can be rigged before deal.
        const players = room.confirmedSeats().map((s) => ({
          userId: s.userId!,
          username: s.username!,
          seatIndex: s.index,
          chips: s.chips,
          isAi: s.isAi,
        }));
        const engine = new PokerEngine(
          players,
          room.settings.smallBlind,
          room.settings.bigBlind,
          0,
          (type, payload) =>
            handler["broadcastEngineMessage"](room, type, payload),
        );
        deckRig.cards = [
          // idx0 (h1) hole cards: junk; idx1 (AI) hole cards: aces.
          card("7", "hearts"),
          card("2", "diamonds"),
          card("A", "spades"),
          card("A", "clubs"),
          // board — no straight/flush help; aces stay best
          card("9", "diamonds"),
          card("4", "clubs"),
          card("3", "spades"),
          card("K", "hearts"),
          card("8", "spades"),
        ];
        handler["engines"].set(room.id, engine);
        handler["bumpGeneration"](room.id);
        engine.startHand();
        deckRig.cards = null;

        // Heads-up: dealer idx0 (h1) is SB and acts first. Human shoves;
        // the AI must call off its stack (stack == toCall → allin option).
        vi.mocked(callLlm).mockResolvedValue({ action: "allin", amount: 148 });
        engine.handleAction("h1", "allin", 149);
        await vi.advanceTimersByTimeAsync(0);
        expect(engine.getState().phase).toBe("settled");
        expect(room.findSeatByUserId("h1")!.chips).toBe(0);
        expect(room.autoResume).toBe(true);
        expect(room.findSeatByUserId("h1")!.confirmed).toBe(false);

        // Settlement window elapses → game pauses for the human rebuy.
        await vi.advanceTimersByTimeAsync(SETTLEMENT_WINDOW_MS + 1);
        expect(room.status).toBe("waiting");
        expect(room.autoResume).toBe(true);
        const stateMsg = gateway.sent
          .filter((m) => m.type === "room:state")
          .at(-1);
        expect(
          (stateMsg!.payload as { room: { autoResume: boolean } }).room
            .autoResume,
        ).toBe(true);

        // Human re-buys → auto-resume with the same roster.
        await handler.handleMessage("h1", "alice", "room:confirm", {
          buyIn: room.settings.minBuyIn,
        });
        expect(room.status).toBe("playing");
        expect(room.autoResume).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ----------------------------------------------------------------
  // Disconnect management
  // ----------------------------------------------------------------

  describe("disconnect management", () => {
    async function startPlayingWithHumans() {
      await joinAndConfirm("h1", "alice");
      await joinAndConfirm("h2", "bob");
      room.status = "playing";
      handler["startEngine"](room);
      gateway.sent.length = 0;
    }

    it("keeps a disconnected player seated until the 60s deadline", async () => {
      vi.useFakeTimers();
      try {
        await startPlayingWithHumans();
        handler.handleDisconnect("h2");

        expect(room.findSeatByUserId("h2")).toMatchObject({
          connected: false,
          autoManaged: false,
        });

        await vi.advanceTimersByTimeAsync(59_999);
        expect(room.findSeatByUserId("h2")).toMatchObject({
          connected: false,
          autoManaged: false,
        });

        await vi.advanceTimersByTimeAsync(1);
        expect(room.findSeatByUserId("h2")).toMatchObject({
          connected: false,
          autoManaged: true,
        });
        expect(room.isSpectator("h2")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("automatically checks without adding chips when check is legal", async () => {
      vi.useFakeTimers();
      try {
        await startPlayingWithHumans();
        const engine = handler["engines"].get(room.id)!;
        const state = engine.getState();
        const current = state.players[state.currentPlayerIndex]!;
        state.currentBet = current.bet;
        const chipsBefore = current.chips;
        const totalBetBefore = current.totalBet;

        handler.handleDisconnect(current.userId);
        await vi.advanceTimersByTimeAsync(0);

        expect(current.chips).toBe(chipsBefore);
        expect(current.totalBet).toBe(totalBetBefore);
        expect(current.folded).toBe(false);
        expect(state.actionLog).toContain(`${current.username} check`);
      } finally {
        vi.useRealTimers();
      }
    });

    it("automatically folds instead of calling when chips are required", async () => {
      vi.useFakeTimers();
      try {
        await startPlayingWithHumans();
        const engine = handler["engines"].get(room.id)!;
        const state = engine.getState();
        const current = state.players[state.currentPlayerIndex]!;
        const totalBetBefore = current.totalBet;

        handler.handleDisconnect(current.userId);
        await vi.advanceTimersByTimeAsync(0);

        expect(current.folded).toBe(true);
        expect(current.totalBet).toBe(totalBetBefore);
        expect(state.actionLog).not.toContain(`${current.username} call 1`);
        expect(state.actionLog.some((entry) => entry.endsWith(" fold"))).toBe(
          true,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancels the managed state on reconnect and invalidates the timer", async () => {
      vi.useFakeTimers();
      try {
        await startPlayingWithHumans();
        handler.handleDisconnect("h2");
        await vi.advanceTimersByTimeAsync(60_000);
        expect(room.findSeatByUserId("h2")?.autoManaged).toBe(true);

        await handler.handleMessage("h2", "bob", "reconnect", {});
        expect(room.findSeatByUserId("h2")).toMatchObject({
          connected: true,
          autoManaged: false,
        });

        await vi.advanceTimersByTimeAsync(60_000);
        expect(room.findSeatByUserId("h2")).toBeDefined();
        expect(room.isSpectator("h2")).toBe(false);
        expect(
          gateway.sent.some(
            (message) =>
              message.userId === "h2" && message.type === "reconnect:success",
          ),
        ).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("restarts the 60s window after a short reconnect", async () => {
      vi.useFakeTimers();
      try {
        await startPlayingWithHumans();
        handler.handleDisconnect("h2");
        await vi.advanceTimersByTimeAsync(30_000);
        await handler.handleMessage("h2", "bob", "reconnect", {});

        handler.handleDisconnect("h2");
        await vi.advanceTimersByTimeAsync(30_000);
        expect(room.findSeatByUserId("h2")?.autoManaged).toBe(false);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(room.findSeatByUserId("h2")?.autoManaged).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not reset a timer when duplicate disconnect events arrive", async () => {
      vi.useFakeTimers();
      try {
        await startPlayingWithHumans();
        handler.handleDisconnect("h2");
        await vi.advanceTimersByTimeAsync(30_000);
        handler.handleDisconnect("h2");

        await vi.advanceTimersByTimeAsync(30_000);
        expect(room.findSeatByUserId("h2")?.autoManaged).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("moves an unreconnected managed player to spectators after settlement", async () => {
      await startPlayingWithHumans();
      const engine = handler["engines"].get(room.id)!;
      const seat = room.findSeatByUserId("h2")!;
      const player = engine.getState().players.find((p) => p.userId === "h2")!;
      seat.connected = false;
      seat.autoManaged = true;
      seat.chips = 123;
      player.chips = 123;
      engine.getState().phase = "settled";
      vi.mocked(addPoints).mockClear();

      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      expect(room.findSeatByUserId("h2")).toBeUndefined();
      expect(room.isSpectator("h2")).toBe(true);
      expect(addPoints).toHaveBeenCalledWith("h2", 123);
      expect(room.status).toBe("waiting");
    });

    it("settles an active hold exactly once when moving a managed player", async () => {
      await startPlayingWithHumans();
      const engine = handler["engines"].get(room.id)!;
      const seat = room.findSeatByUserId("h2")!;
      const player = engine.getState().players.find((p) => p.userId === "h2")!;
      seat.connected = false;
      seat.autoManaged = true;
      seat.chips = 234;
      seat.buyInHoldOperationId = "hold-h2";
      player.chips = 234;
      engine.getState().phase = "settled";
      vi.mocked(addPoints).mockClear();
      vi.mocked(settleBuyInHold).mockClear();

      await handler["handleHandEnd"](
        room,
        handler["engineGeneration"].get(room.id)!,
      );

      expect(settleBuyInHold).toHaveBeenCalledWith("hold-h2", 234);
      expect(addPoints).not.toHaveBeenCalledWith("h2", expect.anything());
      expect(room.isSpectator("h2")).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // Table chips aggregation (leaderboard support)
  // ----------------------------------------------------------------

  describe("getTableChipsByUserId", () => {
    it("reports seat chips while waiting", async () => {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      const aiId = room.aiSeats()[0]!.userId!;

      const chips = handler.getTableChipsByUserId();
      expect(chips.get("h1")).toBe(room.settings.minBuyIn);
      expect(chips.get(aiId)).toBe(room.settings.minBuyIn);
    });

    it("prefers engine state mid-hand and conserves chips + bet", async () => {
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      const aiId = room.aiSeats()[0]!.userId!;
      room.status = "playing";
      handler["startEngine"](room);

      // Blinds move chips into bets; the per-player total must be conserved.
      const chips = handler.getTableChipsByUserId();
      expect(chips.get("h1")).toBe(room.settings.minBuyIn);
      expect(chips.get(aiId)).toBe(room.settings.minBuyIn);
    });
  });
});
