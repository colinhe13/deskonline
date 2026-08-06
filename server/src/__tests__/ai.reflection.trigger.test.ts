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
    aiLesson: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    aiHandSummary: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
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

vi.mock("../ai/selfreview/persist.js", () => ({
  accumulateEvaluation: vi.fn(),
  flushSelfStats: vi.fn().mockResolvedValue(undefined),
  loadSelfStats: vi.fn().mockResolvedValue(new Map()),
  clearSelfStatsRoom: vi.fn(),
  resetSelfStatsPersistForTests: vi.fn(),
}));

// The reflection engine itself is covered by ai.reflection.engine.test.ts;
// here we verify the lobby trigger wiring only.
vi.mock("../ai/reflection/reflect.js", () => ({
  reflectAll: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../db/client.js";
import { reflectAll } from "../ai/reflection/reflect.js";
import { ensureAiAccounts, resetAiStateForTests } from "../ai/accounts.js";
import { config } from "../config.js";
import { profileStore } from "../ai/profiling/store.js";
import { selfReviewStore } from "../ai/selfreview/store.js";
import { LobbyHandler } from "../lobby/lobby.handler.js";
import { roomManager } from "../lobby/room.manager.js";
import { Room } from "../lobby/room.js";

const ORIGINAL_REFLECT_EVERY = config.aiReflectEveryHands;
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

describe("global reflection trigger wiring", () => {
  let gateway: ReturnType<typeof makeFakeGateway>;
  let handler: LobbyHandler;
  let room: Room;

  beforeEach(async () => {
    vi.clearAllMocks();
    config.aiAccounts = TEST_AI_ACCOUNTS.join(",");
    config.aiReflectEveryHands = 2;
    config.aiEvolveEveryHands = 2;

    vi.mocked(prisma.aiPersona.upsert).mockImplementation(
      async (args: { create: Record<string, unknown> }) =>
        ({ id: `persona-${args.create.slug}`, ...args.create }) as never,
    );
    vi.mocked(prisma.aiPersona.update).mockResolvedValue({} as never);
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
    handler["serverHandCount"] = 0;
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
    config.aiReflectEveryHands = ORIGINAL_REFLECT_EVERY;
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

  it("fires reflectAll only at the aiReflectEveryHands boundary", async () => {
    await joinAndConfirm("h1", "alice");
    await handler.handleMessage("h1", "host", "ai:add", {
      aiUsername: "AI_XiaoZhi",
    });
    room.status = "playing";
    handler["startEngine"](room);

    await driveToSettled();
    expect(reflectAll).not.toHaveBeenCalled();
    expect(handler["serverHandCount"]).toBe(1);

    await settleAndRebuild();
    await driveToSettled();
    await vi.waitFor(() => {
      expect(handler["serverHandCount"]).toBe(2);
      expect(reflectAll).toHaveBeenCalledTimes(1);
    });

    // The boundary also flushes accumulated hand summaries for the seated AI.
    await vi.waitFor(() => {
      expect(prisma.aiHandSummary.createMany).toHaveBeenCalled();
    });
    const flushed = vi
      .mocked(prisma.aiHandSummary.createMany)
      .mock.calls.map((c) => (c[0] as { data: unknown[] }).data)
      .flat();
    expect(flushed.some((d) => d.userId === "ai-AI_XiaoZhi")).toBe(true);
  });
});
