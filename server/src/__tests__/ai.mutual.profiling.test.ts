import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";

vi.mock("../db/client.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    aiPersona: {
      upsert: vi.fn(),
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

// Wraps the real decideAiAction so tests can inspect the injected profiles.
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

import { prisma } from "../db/client.js";
import { callLlm } from "../ai/llm.client.js";
import { decideAiAction } from "../ai/decision.js";
import { ensureAiAccounts, resetAiStateForTests } from "../ai/accounts.js";
import { config } from "../config.js";
import { profileStore } from "../ai/profiling/store.js";
import { personaNoteBySlug } from "../ai/profiling/aiNote.js";
import { NOTE_MAX_CHARS } from "../ai/profiling/summarizer.js";
import { PERSONA_SEEDS } from "../ai/personas.js";
import { buildDecisionContext } from "../ai/prompt.js";
import { LobbyHandler } from "../lobby/lobby.handler.js";
import { roomManager } from "../lobby/room.manager.js";
import { Room } from "../lobby/room.js";
import type { GameState, PlayerState } from "../poker/types.js";
import type { HandRecord, ProfileView } from "../ai/profiling/types.js";

const ORIGINAL_AI_ACCOUNTS = config.aiAccounts;
const ORIGINAL_SUMMARY_WINDOW = config.aiProfileSummaryWindow;
const ORIGINAL_MIN_HANDS = config.aiProfileMinHands;
const ORIGINAL_SUMMARY_EVERY = config.aiProfileSummaryEvery;
const TEST_AI_ACCOUNTS = [
  "AI_XiaoZhi",
  "AI_LaoWang",
  "AI_XiaoMei",
  "AI_AQiang",
];

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
    requestLeaderboardRefresh: vi.fn(),
  };
}

function handRecord(handNumber: number, actorId = "h1"): HandRecord {
  return {
    actions: [
      { street: "preflop", userId: actorId, action: "call", amount: 2 },
    ],
    winners: [{ userId: actorId, amount: 4 }],
    showdownParticipantIds: [],
    revealedHandNames: {},
    handNumber,
  };
}

function playerState(overrides: Partial<PlayerState>): PlayerState {
  return {
    userId: "p0",
    username: "p0",
    seatIndex: 0,
    chips: 148,
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    cards: [],
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
    cardsRevealed: false,
    ...overrides,
  };
}

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

describe("AI mutual profiling", () => {
  let gateway: ReturnType<typeof makeFakeGateway>;
  let handler: LobbyHandler;
  let room: Room;

  beforeEach(async () => {
    vi.clearAllMocks();
    config.aiAccounts = TEST_AI_ACCOUNTS.join(",");
    config.aiProfileSummaryWindow = 10;
    config.aiProfileMinHands = 5;
    config.aiProfileSummaryEvery = 10;
    vi.mocked(prisma.aiPersona.upsert).mockImplementation(
      async (args: { create: Record<string, unknown> }) =>
        ({ id: `persona-${args.create.slug}`, ...args.create }) as never,
    );
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
    profileStore.clearRoom(room.id);
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
    profileStore.clearRoom(room.id);
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

  async function addAiAs(hostId: string, requestedUsername?: string) {
    const username =
      requestedUsername ??
      TEST_AI_ACCOUNTS.find(
        (candidate) => !room.seats.some((seat) => seat.username === candidate),
      ) ??
      TEST_AI_ACCOUNTS[0];
    await handler.handleMessage(hostId, "host", "ai:add", {
      aiUsername: username,
    });
    return room.aiSeats().find((seat) => seat.username === username)!;
  }

  // Direct seat assignment for pure-AI scenarios (no human host needed).
  function seatAi(aiUserId: string, username: string) {
    const seat = room.seats.find((s) => !s.userId)!;
    seat.userId = aiUserId;
    seat.username = username;
    seat.chips = room.settings.minBuyIn;
    seat.buyIn = room.settings.minBuyIn;
    seat.confirmed = true;
    seat.isAi = true;
    room.entryOrder.push(aiUserId);
    return seat;
  }

  // ----------------------------------------------------------------
  // personaNoteBySlug
  // ----------------------------------------------------------------

  describe("personaNoteBySlug", () => {
    it("covers every persona seed with a length-bounded note", () => {
      expect(PERSONA_SEEDS).toHaveLength(6);
      for (const seed of PERSONA_SEEDS) {
        const note = personaNoteBySlug[seed.slug];
        expect(note, `missing note for ${seed.slug}`).toBeDefined();
        expect(note.length).toBeGreaterThan(0);
        expect(note.length).toBeLessThanOrEqual(NOTE_MAX_CHARS);
      }
    });

    it("exposes no internal parameter values", () => {
      for (const note of Object.values(personaNoteBySlug)) {
        expect(note).not.toMatch(/bluffHintRate|temperature/);
        // Exact percentages would mirror internal rates; qualitative wording
        // ("约三成", "极高") is allowed.
        expect(note).not.toMatch(/\d+(\.\d+)?%/);
      }
    });
  });

  // ----------------------------------------------------------------
  // AI 建档与簿记
  // ----------------------------------------------------------------

  describe("collectHandForProfiling", () => {
    it("profiles AI participants and books their stats", () => {
      const aiId = "ai-AI_XiaoZhi";
      seatAi(aiId, "AI_XiaoZhi");
      const record: HandRecord = {
        actions: [
          { street: "preflop", userId: aiId, action: "call", amount: 2 },
          { street: "flop", userId: aiId, action: "raise", amount: 6 },
          { street: "flop", userId: "h2", action: "fold", amount: 0 },
        ],
        winners: [{ userId: aiId, amount: 10 }],
        showdownParticipantIds: [],
        revealedHandNames: {},
        handNumber: 1,
      };
      const state = {
        players: [
          playerState({ userId: aiId, username: "AI_XiaoZhi" }),
          playerState({ userId: "h2", username: "bob" }),
        ],
      } as unknown as GameState;

      for (let i = 0; i < 5; i++) {
        handler["collectHandForProfiling"](room, state, record);
      }

      const stats = profileStore.getProfile(room.id, aiId)!.stats;
      expect(stats.hands).toBe(5);
      expect(stats.vpipHands).toBe(5);
      expect(stats.postflopAggr).toBe(5);
    });

    it("writes the deterministic persona note once and keeps it", () => {
      const aiId = "ai-AI_XiaoZhi";
      seatAi(aiId, "AI_XiaoZhi");
      const state = {
        players: [playerState({ userId: aiId, username: "AI_XiaoZhi" })],
      } as unknown as GameState;

      handler["collectHandForProfiling"](room, state, handRecord(1, aiId));
      const note = personaNoteBySlug["tight-aggressive"];
      expect(profileStore.getProfile(room.id, aiId)?.note).toBe(note);

      profileStore.setNote(room.id, aiId, "观察后的更新评语");
      handler["collectHandForProfiling"](room, state, handRecord(2, aiId));
      expect(profileStore.getProfile(room.id, aiId)?.note).toBe(
        "观察后的更新评语",
      );
    });

    it("gates the AI note display on the ready threshold like humans", () => {
      const aiId = "ai-AI_XiaoZhi";
      seatAi(aiId, "AI_XiaoZhi");
      const state = {
        players: [playerState({ userId: aiId, username: "AI_XiaoZhi" })],
      } as unknown as GameState;

      handler["collectHandForProfiling"](room, state, handRecord(1, aiId));
      expect(profileStore.getViews(room.id)[0].note).toBeNull();

      for (let i = 2; i <= 5; i++) {
        handler["collectHandForProfiling"](room, state, handRecord(i, aiId));
      }
      const view = profileStore.getViews(room.id)[0];
      expect(view.note).toBe(personaNoteBySlug["tight-aggressive"]);
    });
  });

  // ----------------------------------------------------------------
  // 广播与快照泄漏防护（安全关键）
  // ----------------------------------------------------------------

  describe("human-facing feeds exclude AI profiles", () => {
    it("broadcastProfiles never emits isAi=true entries", () => {
      const aiId = "ai-AI_XiaoZhi";
      seatAi(aiId, "AI_XiaoZhi");
      for (let i = 1; i <= 5; i++) {
        profileStore.recordHand(
          room.id,
          aiId,
          "AI_XiaoZhi",
          handRecord(i, aiId),
        );
      }
      profileStore.recordHand(room.id, "h1", "alice", handRecord(1));

      handler["broadcastProfiles"](room);

      const msg = gateway.sent.at(-1)!;
      expect(msg.type).toBe("ai:profile:update");
      const profiles = (msg.payload as { profiles: ProfileView[] }).profiles;
      expect(profiles.some((p) => p.isAi)).toBe(false);
      expect(profiles.some((p) => p.userId === aiId)).toBe(false);
      expect(profiles.map((p) => p.userId)).toContain("h1");
    });

    it("roomStatePayload never contains isAi=true entries", () => {
      const aiId = "ai-AI_LaoWang";
      seatAi(aiId, "AI_LaoWang");
      for (let i = 1; i <= 5; i++) {
        profileStore.recordHand(
          room.id,
          aiId,
          "AI_LaoWang",
          handRecord(i, aiId),
        );
      }

      const payload = handler["roomStatePayload"](room) as {
        profiles: ProfileView[];
      };
      expect(payload.profiles.some((p) => p.isAi)).toBe(false);
      expect(payload.profiles.some((p) => p.userId === aiId)).toBe(false);
    });

    it("broadcasts after a settled hand stay free of AI entries", async () => {
      await joinAndConfirm("h1", "alice");
      const ai = await addAiAs("h1");
      room.status = "playing";
      handler["startEngine"](room);
      const engine = handler["engines"].get(room.id)!;

      engine.handleAction("h1", "fold");
      await vi.waitFor(() => {
        expect(engine.getState().phase).toBe("settled");
      });

      // The AI is now profiled in storage…
      expect(profileStore.getProfile(room.id, ai.userId!)).toBeDefined();
      // …but every human-facing profile feed excludes it.
      const profileMsgs = gateway.sent.filter(
        (m) =>
          m.type === "ai:profile:update" ||
          (m.type === "room:state" &&
            (m.payload as { profiles?: unknown[] }).profiles !== undefined),
      );
      expect(profileMsgs.length).toBeGreaterThan(0);
      for (const m of profileMsgs) {
        const profiles = (m.payload as { profiles: ProfileView[] }).profiles;
        expect(profiles.some((p) => p.isAi)).toBe(false);
        expect(profiles.some((p) => p.userId === ai.userId)).toBe(false);
      }
    });
  });

  // ----------------------------------------------------------------
  // AI 决策侧互读
  // ----------------------------------------------------------------

  describe("AI decision side", () => {
    it("injects another seated AI's ready profile into decisions", async () => {
      await joinAndConfirm("h1", "alice");
      const aiA = await addAiAs("h1", "AI_XiaoZhi");
      const aiB = await addAiAs("h1", "AI_LaoWang");

      // Make the other AI's profile ready before any decision runs.
      for (let i = 1; i <= 15; i++) {
        profileStore.recordHand(
          room.id,
          aiA.userId!,
          "AI_XiaoZhi",
          handRecord(i, aiA.userId!),
        );
      }
      profileStore.setNote(
        room.id,
        aiA.userId!,
        personaNoteBySlug["tight-aggressive"],
      );

      vi.mocked(decideAiAction).mockResolvedValue({
        action: "fold",
        amount: 0,
      });
      room.status = "playing";
      handler["startEngine"](room);
      const engine = handler["engines"].get(room.id)!;
      expect(engine.getState().players).toHaveLength(3);

      // Human acts first (BTN/SB); the raise forces both AI decisions.
      engine.handleAction("h1", "raise", 5);
      await vi.waitFor(() => {
        expect(engine.getState().phase).toBe("settled");
      });

      expect(vi.mocked(decideAiAction).mock.calls.length).toBeGreaterThan(0);
      // Mutual reading: the deciding AI (aiB) receives the other seated AI's
      // ready profile in the exact same shape it gets for humans.
      const aiBDecision = vi
        .mocked(decideAiAction)
        .mock.calls.find((call) => call[1] === aiB.userId);
      expect(aiBDecision).toBeDefined();
      const aiAView = (aiBDecision![3] as ProfileView[]).find(
        (p) => p.userId === aiA.userId,
      );
      expect(aiAView).toBeDefined();
      expect(aiAView!.isAi).toBe(true);
      expect(aiAView!.ready).toBe(true);
      expect(aiAView!.stats).not.toBeNull();
      expect(aiAView!.note).toBe(personaNoteBySlug["tight-aggressive"]);
    });
  });

  // ----------------------------------------------------------------
  // LLM 总结过滤
  // ----------------------------------------------------------------

  describe("runProfileSummaries AI exclusion", () => {
    it("never summarizes AI targets even when they are the stalest", async () => {
      const aiId = "ai-AI_XiaoZhi";
      seatAi(aiId, "AI_XiaoZhi");
      for (let i = 1; i <= 20; i++) {
        profileStore.recordHand(
          room.id,
          aiId,
          "AI_XiaoZhi",
          handRecord(i, aiId),
        );
      }
      vi.mocked(callLlm).mockReset();
      vi.mocked(callLlm).mockResolvedValue({ summary: "不应出现" });

      await handler["runProfileSummaries"](room);

      expect(callLlm).not.toHaveBeenCalled();
      // Seeded directly via recordHand, so no deterministic note — the point
      // is that the LLM never wrote one either.
      expect(profileStore.getProfile(room.id, aiId)?.note).toBeNull();
    });

    it("still summarizes stale humans when AIs are also eligible", async () => {
      const aiId = "ai-AI_XiaoZhi";
      seatAi(aiId, "AI_XiaoZhi");
      for (let i = 1; i <= 20; i++) {
        profileStore.recordHand(
          room.id,
          aiId,
          "AI_XiaoZhi",
          handRecord(i, aiId),
        );
      }
      for (let i = 1; i <= 10; i++) {
        profileStore.recordHand(room.id, "h1", "alice", handRecord(i));
      }
      vi.mocked(callLlm).mockReset();
      vi.mocked(callLlm).mockResolvedValue({ summary: "人类评语" });

      await handler["runProfileSummaries"](room);

      expect(callLlm).toHaveBeenCalledTimes(1);
      expect(profileStore.getProfile(room.id, "h1")?.note).toBe("人类评语");
      // The AI target was never handed to the LLM.
      expect(profileStore.getProfile(room.id, aiId)?.note).toBeNull();
    });

    it("makes no summary call on a pure-AI table", async () => {
      seatAi("ai-AI_XiaoZhi", "AI_XiaoZhi");
      seatAi("ai-AI_LaoWang", "AI_LaoWang");
      room.hostId = null;
      for (let i = 1; i <= 20; i++) {
        profileStore.recordHand(
          room.id,
          "ai-AI_XiaoZhi",
          "AI_XiaoZhi",
          handRecord(i, "ai-AI_XiaoZhi"),
        );
      }
      vi.mocked(callLlm).mockReset();
      vi.mocked(callLlm).mockResolvedValue({ summary: "不应出现" });

      await handler["runProfileSummaries"](room);

      expect(callLlm).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // 决策上下文序列化扫描（AI 对手条目无底牌）
  // ----------------------------------------------------------------

  describe("buildDecisionContext with AI opponent profiles", () => {
    const state = (): GameState =>
      ({
        phase: "flop",
        communityCards: [
          { rank: "Q", suit: "spades" },
          { rank: "7", suit: "diamonds" },
          { rank: "2", suit: "clubs" },
        ],
        pot: 9,
        sidePots: [],
        players: [
          playerState({
            userId: "ai-deciding",
            username: "AI_AQiang",
            cards: [
              { rank: "A", suit: "hearts" },
              { rank: "K", suit: "diamonds" },
            ],
          }),
          playerState({
            userId: "ai-opponent",
            username: "AI_LaoWang",
            seatIndex: 1,
            bet: 4,
            cards: [
              { rank: "9", suit: "hearts" },
              { rank: "9", suit: "clubs" },
            ],
          }),
          playerState({
            userId: "h2",
            username: "human2",
            seatIndex: 2,
            folded: true,
            cards: [
              { rank: "3", suit: "hearts" },
              { rank: "4", suit: "hearts" },
            ],
          }),
        ],
        currentPlayerIndex: 0,
        dealerIndex: 0,
        smallBlind: 1,
        bigBlind: 2,
        currentBet: 4,
        minRaise: 4,
        handNumber: 3,
        actionLog: [],
      }) as unknown as GameState;

    it("injects AI opponent profiles like humans, without hole cards", () => {
      const aiProfile: ProfileView = {
        userId: "ai-opponent",
        username: "AI_LaoWang",
        isAi: true,
        hands: 16,
        ready: true,
        stats: {
          hands: 16,
          vpip: 55,
          pfr: 30,
          threeBet: 12,
          af: 3.2,
          foldToRaise: 40,
          foldToCbet: 35,
          wtsd: 28,
        },
        note: personaNoteBySlug["loose-aggressive"],
      };

      const ctx = buildDecisionContext(state(), "ai-deciding", [aiProfile]);
      const profiles = ctx.opponentProfiles as {
        name: string;
        stats: unknown;
        note: string;
      }[];
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("AI_LaoWang");
      expect(profiles[0].note).toBe(personaNoteBySlug["loose-aggressive"]);
      const guidance = ctx.opponentProfileGuidance as string;
      expect(guidance).toContain("AI 对手");
      expect(guidance).toContain("不因其是 AI 而区别对待");

      // Serialization scan: AI opponent entries leak no hole cards.
      const profilesSerialized = JSON.stringify(profiles);
      expect(profilesSerialized).not.toMatch(/[2-9TJQKA][hdcs]\b/);
      expect(profilesSerialized).not.toContain("cards");
    });
  });
});

afterAll(() => {
  config.aiAccounts = ORIGINAL_AI_ACCOUNTS;
  config.aiProfileSummaryWindow = ORIGINAL_SUMMARY_WINDOW;
  config.aiProfileMinHands = ORIGINAL_MIN_HANDS;
  config.aiProfileSummaryEvery = ORIGINAL_SUMMARY_EVERY;
});
