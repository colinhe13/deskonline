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
      update: vi.fn(),
    },
    aiSelfStats: {
      upsert: vi.fn(),
      findMany: vi.fn(),
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

vi.mock("../voice/livekit.service.js", () => ({
  livekitService: {
    getRoomName: () => "room",
    generateToken: async () => "token",
    getClientUrl: () => "ws://localhost:7880",
  },
}));

// The persistence layer is exercised by ai.evolution.persist.test.ts; here we
// only verify the lobby wiring (when flush/evolve fire, with what inputs).
vi.mock("../ai/selfreview/persist.js", () => ({
  accumulateEvaluation: vi.fn(),
  flushSelfStats: vi.fn().mockResolvedValue(undefined),
  loadSelfStats: vi.fn().mockResolvedValue(new Map()),
  clearSelfStatsRoom: vi.fn(),
  resetSelfStatsPersistForTests: vi.fn(),
}));

import { prisma } from "../db/client.js";
import {
  flushSelfStats,
  loadSelfStats,
  clearSelfStatsRoom,
} from "../ai/selfreview/persist.js";
import { ensureAiAccounts, resetAiStateForTests } from "../ai/accounts.js";
import { personaOfUser } from "../ai/personas.js";
import { config } from "../config.js";
import { profileStore } from "../ai/profiling/store.js";
import { selfReviewStore } from "../ai/selfreview/store.js";
import { LobbyHandler } from "../lobby/lobby.handler.js";
import { roomManager } from "../lobby/room.manager.js";
import { Room } from "../lobby/room.js";

const ORIGINAL_EVOLVE_EVERY = config.aiEvolveEveryHands;
const TEST_AI_ACCOUNTS = [
  "AI_XiaoZhi",
  "AI_LaoWang",
  "AI_XiaoMei",
  "AI_AQiang",
];

function makeFakeGateway() {
  const sent: unknown[] = [];
  return {
    sent,
    sendToUser: vi.fn((...args: unknown[]) => sent.push(args)),
    broadcast: vi.fn((...args: unknown[]) => sent.push(args)),
    broadcastAll: vi.fn((...args: unknown[]) => sent.push(args)),
    requestLeaderboardRefresh: vi.fn(),
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

describe("cross-match learning lobby wiring", () => {
  let gateway: ReturnType<typeof makeFakeGateway>;
  let handler: LobbyHandler;
  let room: Room;

  beforeEach(async () => {
    vi.clearAllMocks();
    config.aiAccounts = TEST_AI_ACCOUNTS.join(",");
    config.aiEvolveEveryHands = 2;
    vi.mocked(prisma.aiPersona.upsert).mockImplementation(
      async (args: { create: Record<string, unknown> }) =>
        ({ id: `persona-${args.create.slug}`, ...args.create }) as never,
    );
    vi.mocked(prisma.aiPersona.update).mockResolvedValue({} as never);
    vi.mocked(prisma.aiSelfStats.findMany).mockResolvedValue([]);
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
    selfReviewStore.clearRoom(room.id);
    handler["engines"].clear();
    handler["aiPending"].clear();
    handler["engineGeneration"].clear();
    handler["roomCommandQueues"].clear();
    handler["roomHandCounts"].clear();
    handler["evolutionBusy"].clear();
  });

  afterEach(() => {
    handler["seatDisconnectTimers"].forEach((timer) => clearTimeout(timer));
    handler["pendingDisconnectTimers"].forEach((timer) => clearTimeout(timer));
    handler["engines"].clear();
    profileStore.clearRoom(room.id);
    selfReviewStore.clearRoom(room.id);
    resetRoom(room);
  });

  afterAll(() => {
    config.aiEvolveEveryHands = ORIGINAL_EVOLVE_EVERY;
  });

  async function joinAndConfirm(userId: string, username: string) {
    await handler.handleMessage(userId, username, "room:join", {
      roomId: "main",
    });
    await handler.handleMessage(userId, username, "room:confirm", {
      buyIn: room.settings.minBuyIn,
    });
  }

  async function addAiAs(hostId: string, aiUsername: string) {
    await handler.handleMessage(hostId, "host", "ai:add", { aiUsername });
  }

  // Plays the current hand to settlement: humans check/call, AI turns arrive
  // asynchronously (mocked LLM folds). The engine's own hand_result
  // broadcast drives the settlement pipeline under test.
  async function driveToSettled() {
    const engine = handler["engines"].get(room.id)!;
    let guard = 0;
    while (engine.getState().phase !== "settled" && guard++ < 500) {
      const state = engine.getState();
      const current = state.players[state.currentPlayerIndex];
      if (!current || current.folded) {
        await new Promise((r) => setTimeout(r, 10));
        continue;
      }
      const actions = engine.getAvailableActionsForPlayer(current.userId);
      if (actions.length === 0) {
        await new Promise((r) => setTimeout(r, 10));
        continue;
      }
      const check = actions.find((a) => a.type === "check");
      const call = actions.find((a) => a.type === "call");
      engine.handleAction(
        current.userId,
        check ? "check" : "call",
        call?.amount,
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(engine.getState().phase).toBe("settled");
    return engine;
  }

  async function settleAndRebuild() {
    await handler["handleHandEnd"](
      room,
      handler["engineGeneration"].get(room.id)!,
    );
  }

  it("flushes and evolves at the aiEvolveEveryHands boundary, not before", async () => {
    await joinAndConfirm("h1", "alice");
    await addAiAs("h1", "AI_XiaoZhi");
    room.status = "playing";
    handler["startEngine"](room);

    await driveToSettled();
    expect(flushSelfStats).not.toHaveBeenCalled();

    await settleAndRebuild();
    expect(handler["engines"].get(room.id)).toBeDefined();

    await driveToSettled();
    await vi.waitFor(() => {
      expect(flushSelfStats).toHaveBeenCalledWith(room.id);
    });
    // Evolution ran for the seated AI (no persisted stats → no persona write).
    expect(loadSelfStats).toHaveBeenCalled();
    expect(prisma.aiPersona.update).not.toHaveBeenCalled();
  });

  it("applies the evolved baseline to the hot path after the boundary cycle", async () => {
    vi.mocked(loadSelfStats).mockResolvedValue(
      new Map([
        [
          "ai-AI_XiaoZhi",
          {
            bluffAttempts: 10,
            bluffSuccess: 9,
            cbetAttempts: 0,
            cbetSuccess: 0,
          },
        ],
      ]),
    );
    await joinAndConfirm("h1", "alice");
    await addAiAs("h1", "AI_XiaoZhi");
    room.status = "playing";
    handler["startEngine"](room);

    await driveToSettled();
    await settleAndRebuild();
    await driveToSettled();

    // tight-aggressive seed 0.08, rate 0.9 >= 0.6 → ×1.1 = 0.088.
    await vi.waitFor(() => {
      expect(prisma.aiPersona.update).toHaveBeenCalledWith({
        where: { id: "persona-tight-aggressive" },
        data: expect.objectContaining({
          evolvedBluffHintRate: expect.closeTo(0.088, 10),
        }),
      });
    });
    expect(personaOfUser("ai-AI_XiaoZhi")?.bluffHintRate).toBeCloseTo(
      0.088,
      10,
    );
    expect(personaOfUser("ai-AI_XiaoZhi")?.seedBluffHintRate).toBeCloseTo(
      0.08,
      10,
    );
  });

  it("runs a final flush + evolution at teardown when the last human leaves", async () => {
    await joinAndConfirm("h1", "alice");
    await addAiAs("h1", "AI_XiaoZhi");
    room.status = "playing";
    handler["startEngine"](room);

    await driveToSettled();
    expect(flushSelfStats).not.toHaveBeenCalled();

    // Human leaves; the hand is already settled, so the hand boundary removes
    // the last human and tears the AI seats down.
    await handler.handleMessage("h1", "alice", "room:leave", {});
    await settleAndRebuild();

    await vi.waitFor(() => {
      expect(flushSelfStats).toHaveBeenCalledWith(room.id);
      expect(clearSelfStatsRoom).toHaveBeenCalledWith(room.id);
      expect(loadSelfStats).toHaveBeenCalledWith(["ai-AI_XiaoZhi"]);
    });
    expect(room.aiSeats()).toHaveLength(0);
    expect(handler["roomHandCounts"].has(room.id)).toBe(false);
  });

  it("never lets a persistence failure escape into settlement", async () => {
    vi.mocked(flushSelfStats).mockRejectedValue(new Error("pg down"));
    vi.mocked(prisma.aiSelfStats.findMany).mockRejectedValue(
      new Error("pg down"),
    );
    await joinAndConfirm("h1", "alice");
    await addAiAs("h1", "AI_XiaoZhi");
    room.status = "playing";
    handler["startEngine"](room);

    await driveToSettled();
    await settleAndRebuild();
    await driveToSettled();
    await settleAndRebuild();

    // The table keeps running: a fresh engine was built despite DB outage.
    expect(handler["engines"].get(room.id)).toBeDefined();
    expect(room.status).toBe("playing");
  });
});
