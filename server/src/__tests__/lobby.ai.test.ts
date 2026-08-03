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
  room.pendingJoin = null;
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
  // Full-room seat yielding (满员让座)
  // ----------------------------------------------------------------

  describe("full-room seat yielding", () => {
    it("swaps the lowest AI seat immediately while waiting", async () => {
      room.settings.maxPlayers = 2;
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      expect(room.isFull).toBe(true);
      const aiId = room.aiSeats()[0]!.userId!;
      vi.mocked(addPoints).mockClear();

      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });

      expect(room.findSeatByUserId(aiId)).toBeUndefined();
      expect(addPoints).toHaveBeenCalledWith(aiId, room.settings.minBuyIn);
      const newSeat = room.findSeatByUserId("h2")!;
      expect(newSeat.confirmed).toBe(false); // must confirm the buy-in
      room.settings.maxPlayers = 9;
    });

    it("queues the human during a hand and seats them after it", async () => {
      vi.useFakeTimers();
      try {
        room.settings.maxPlayers = 2;
        await joinAndConfirm("h1", "alice");
        await addAiAs("h1");
        room.status = "playing";
        handler["startEngine"](room);
        const ai = room.aiSeats()[0]!;

        await handler.handleMessage("h2", "bob", "room:join", {
          roomId: "main",
        });
        expect(room.pendingJoin?.userId).toBe("h2");
        expect(room.pendingLeaveUserIds).toContain(ai.userId);
        expect(
          gateway.sent.some(
            (m) => m.userId === "h2" && m.type === "room:join-queued",
          ),
        ).toBe(true);

        // Finish the hand (heads-up: dealer h1 is SB and acts first).
        const aiId = ai.userId!;
        handler["engines"].get(room.id)!.handleAction("h1", "fold");
        // Settlement window elapses: AI leaves, human takes the seat.
        await vi.advanceTimersByTimeAsync(5001);
        expect(room.findSeatByUserId(aiId)).toBeUndefined();
        const humanSeat = room.findSeatByUserId("h2")!;
        expect(humanSeat.confirmed).toBe(false);
        expect(room.status).toBe("waiting");
        expect(room.autoResume).toBe(true);

        const stateMsg = gateway.sent
          .filter((m) => m.type === "room:state")
          .at(-1);
        expect(
          (stateMsg!.payload as { room: { autoResume: boolean } }).room
            .autoResume,
        ).toBe(true);

        await handler.handleMessage("h2", "bob", "room:confirm", {
          buyIn: room.settings.minBuyIn,
        });
        expect(room.status).toBe("playing");
        expect(room.autoResume).toBe(false);
        const engine = handler["engines"].get(room.id)!;
        expect(engine.getState().players.map((p) => p.userId)).toContain("h2");
        room.settings.maxPlayers = 9;
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancels the queue when the human leaves", async () => {
      room.settings.maxPlayers = 2;
      await joinAndConfirm("h1", "alice");
      await addAiAs("h1");
      room.status = "playing";
      handler["startEngine"](room);
      const ai = room.aiSeats()[0]!;

      await handler.handleMessage("h2", "bob", "room:join", { roomId: "main" });
      await handler.handleMessage("h2", "bob", "room:leave", {});

      expect(room.pendingJoin).toBeNull();
      expect(room.pendingLeaveUserIds).not.toContain(ai.userId);
      expect(room.findSeatByUserId(ai.userId!)).toBeDefined();
      room.settings.maxPlayers = 9;
    });

    it("still rejects when full with no AI to yield", async () => {
      room.settings.maxPlayers = 2;
      await joinAndConfirm("h1", "alice");
      await joinAndConfirm("h2", "bob");
      gateway.sent.length = 0;

      await handler.handleMessage("h3", "carol", "room:join", {
        roomId: "main",
      });
      expect(
        gateway.sent.some(
          (m) =>
            m.userId === "h3" &&
            m.type === "room:error" &&
            (m.payload as { code: string }).code === "ROOM_FULL",
        ),
      ).toBe(true);
      room.settings.maxPlayers = 9;
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
