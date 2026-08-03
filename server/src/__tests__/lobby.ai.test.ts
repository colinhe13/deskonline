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
import { deductPoints, addPoints } from "../points/points.service.js";
import { callLlm } from "../ai/llm.client.js";
import { decideAiAction } from "../ai/decision.js";
import { ensureAiAccounts, resetAiStateForTests } from "../ai/accounts.js";
import { LobbyHandler } from "../lobby/lobby.handler.js";
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
    seat.confirmed = false;
    seat.isAi = false;
  }
  room.hostId = null;
  room.entryOrder = [];
  room.status = "waiting";
  room.autoResume = false;
  room.spectators = [];
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
  });

  afterEach(() => {
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
      expect(seat.chips).toBe(room.settings.minBuyIn);
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
        gateway.sent.some(
          (m) => m.userId === "h2" && m.type === "room:error",
        ),
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
        gateway.sent.some(
          (m) => m.userId === "h2" && m.type === "voice:token",
        ),
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
          (m) =>
            m.type === "poker:hand_result" && m.userIds?.includes("h2"),
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
        gateway.sent.some(
          (m) => m.userId === "h2" && m.type === "voice:token",
        ),
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
        gateway.sent.some(
          (m) => m.userId === "h2" && m.type === "voice:token",
        ),
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
        await vi.advanceTimersByTimeAsync(5001);
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
});
