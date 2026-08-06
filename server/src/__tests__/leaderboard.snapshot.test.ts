import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  prisma: {
    user: { findMany: mocks.findMany },
    pointsTransaction: { groupBy: mocks.groupBy },
  },
}));

import { createServer } from "node:http";
import { prisma } from "../db/client.js";
import { WebSocketGateway } from "../ws/gateway.js";

function setUsers(points: number) {
  mocks.findMany.mockResolvedValue([
    {
      id: "u1",
      username: "alice",
      points,
      isAi: false,
    },
  ]);
  mocks.groupBy.mockResolvedValue([]);
}

describe("leaderboard settlement snapshots", () => {
  let gateway: WebSocketGateway;
  let tableChips: Map<string, number>;

  beforeEach(() => {
    vi.clearAllMocks();
    setUsers(9000);
    tableChips = new Map([["u1", 1000]]);
    gateway = new WebSocketGateway(createServer());

    const handler = gateway["lobbyHandler"] as unknown as {
      getSettledTableChipsByUserId: () => Map<string, number>;
      getTableChipsByUserId: () => Map<string, number>;
    };
    handler.getSettledTableChipsByUserId = () => new Map(tableChips);
    handler.getTableChipsByUserId = () => new Map(tableChips);
  });

  afterEach(() => {
    gateway.destroy();
  });

  it("returns a stable snapshot until an explicit settlement refresh", async () => {
    const first = await gateway.getLeaderboardSnapshot();
    expect(first).toMatchObject({ revision: 1 });
    expect(first.entries[0]).toMatchObject({ total: 10000 });

    tableChips.set("u1", 1);
    const duringHand = await gateway.getLeaderboardSnapshot();
    expect(duringHand).toBe(first);
    expect(duringHand.entries[0].total).toBe(10000);

    const broadcast = vi.spyOn(gateway, "broadcastAll");
    gateway.requestLeaderboardRefresh();
    const afterHand = await gateway.getLeaderboardSnapshot();
    expect(afterHand.revision).toBe(2);
    expect(afterHand.entries[0].total).toBe(9001);
    expect(broadcast).toHaveBeenCalledWith(
      "leaderboard:update",
      expect.objectContaining({ revision: 2 }),
    );
  });

  it("coalesces refresh requests raised by the same hand boundary", async () => {
    await gateway.getLeaderboardSnapshot();
    vi.mocked(prisma.user.findMany).mockClear();
    vi.mocked(prisma.pointsTransaction.groupBy).mockClear();
    const broadcast = vi.spyOn(gateway, "broadcastAll");

    tableChips.set("u1", 700);
    gateway.requestLeaderboardRefresh();
    gateway.requestLeaderboardRefresh();
    gateway.requestLeaderboardRefresh();

    const snapshot = await gateway.getLeaderboardSnapshot();
    expect(snapshot.entries[0].total).toBe(9700);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.pointsTransaction.groupBy).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("does not replace the last snapshot when a refresh query fails", async () => {
    const first = await gateway.getLeaderboardSnapshot();
    vi.mocked(prisma.user.findMany).mockRejectedValueOnce(
      new Error("temporary database failure"),
    );

    gateway.requestLeaderboardRefresh();
    await new Promise<void>((resolve) => setImmediate(resolve));

    const afterFailure = await gateway.getLeaderboardSnapshot();
    expect(afterFailure).toBe(first);
    expect(afterFailure.entries[0].total).toBe(10000);
  });
});
