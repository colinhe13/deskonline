import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
    pointsTransaction: {
      groupBy: vi.fn(),
    },
  },
}));

import { prisma } from "../db/client.js";
import {
  beijingDayStart,
  getLeaderboard,
} from "../leaderboard/leaderboard.service.js";

function mockUsers(
  rows: { id: string; username: string; points: number; isAi?: boolean }[],
) {
  vi.mocked(prisma.user.findMany).mockResolvedValue(
    rows.map((r) => ({
      id: r.id,
      username: r.username,
      points: r.points,
      isAi: r.isAi ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
      password: "hash",
    })) as never,
  );
}

function mockDailySums(rows: { userId: string; delta: number | null }[]) {
  vi.mocked(prisma.pointsTransaction.groupBy).mockResolvedValue(
    rows.map((r) => ({ userId: r.userId, _sum: { delta: r.delta } })) as never,
  );
}

describe("leaderboard service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDailySums([]);
  });

  it("ranks by total assets = points + table chips", async () => {
    mockUsers([
      { id: "u1", username: "alice", points: 9000 },
      // Bought in 500: DB points dropped, chips on the table instead.
      { id: "u2", username: "bob", points: 8500 },
      { id: "ai1", username: "AI_XiaoZhi", points: 9800, isAi: true },
    ]);

    const entries = await getLeaderboard(
      new Map([
        ["u2", 500],
        ["ai1", 150],
      ]),
    );

    // u1 and u2 both end at 9000; the tie breaks by username (alice < bob).
    expect(entries.map((e) => e.userId)).toEqual(["ai1", "u1", "u2"]);
    expect(entries[0]).toMatchObject({
      rank: 1,
      username: "AI_XiaoZhi",
      isAi: true,
      points: 9800,
      tableChips: 150,
      total: 9950,
      dailyDelta: 0,
    });
    // Seated players must not be undervalued by the buy-in deduction.
    expect(entries[2]).toMatchObject({
      rank: 3,
      points: 8500,
      tableChips: 500,
      total: 9000,
    });
    expect(entries[1]).toMatchObject({ rank: 2, tableChips: 0, total: 9000 });
  });

  it("breaks total ties deterministically by username", async () => {
    mockUsers([
      { id: "u1", username: "zoe", points: 5000 },
      { id: "u2", username: "adam", points: 5000 },
    ]);

    const entries = await getLeaderboard(new Map());
    expect(entries.map((e) => e.username)).toEqual(["adam", "zoe"]);
    expect(entries.map((e) => e.rank)).toEqual([1, 2]);
  });

  it("returns an empty list when there are no users", async () => {
    mockUsers([]);
    expect(await getLeaderboard(new Map())).toEqual([]);
  });

  it("aggregates today's points delta per user, defaulting to 0", async () => {
    mockUsers([
      { id: "u1", username: "alice", points: 9000 },
      { id: "u2", username: "bob", points: 8500 },
      { id: "ai1", username: "AI_XiaoZhi", points: 9800, isAi: true },
    ]);
    mockDailySums([
      { userId: "u1", delta: -1000 },
      { userId: "u2", delta: 250 },
      { userId: "ai1", delta: null },
    ]);

    const entries = await getLeaderboard(new Map());
    const byId = Object.fromEntries(entries.map((e) => [e.userId, e]));
    expect(byId.u1.dailyDelta).toBe(-1000);
    expect(byId.u2.dailyDelta).toBe(250);
    expect(byId.ai1.dailyDelta).toBe(0);
  });

  it("queries deltas only from Beijing midnight onward", async () => {
    mockUsers([]);
    await getLeaderboard(new Map());

    const where = vi.mocked(prisma.pointsTransaction.groupBy).mock.calls[0][0]
      ?.where as { createdAt: { gte: Date } };
    const gte = where.createdAt.gte;
    expect(gte.getUTCHours()).toBe(16); // Beijing 00:00 == UTC 16:00 previous day
    expect(gte.getUTCMinutes()).toBe(0);
  });
});

describe("beijingDayStart", () => {
  it("returns Beijing midnight for a midday Beijing instant", () => {
    // 2026-08-05 10:30 Beijing == 02:30 UTC same day
    const start = beijingDayStart(new Date("2026-08-05T02:30:00Z"));
    expect(start.toISOString()).toBe("2026-08-04T16:00:00.000Z");
  });

  it("rolls back to the previous Beijing day just before midnight Beijing", () => {
    // 2026-08-05 23:59:59 Beijing == 15:59:59 UTC
    const start = beijingDayStart(new Date("2026-08-05T15:59:59Z"));
    expect(start.toISOString()).toBe("2026-08-04T16:00:00.000Z");
  });

  it("rolls forward exactly at Beijing midnight", () => {
    // 2026-08-06 00:00:00 Beijing == 2026-08-05 16:00:00 UTC
    const start = beijingDayStart(new Date("2026-08-05T16:00:00Z"));
    expect(start.toISOString()).toBe("2026-08-05T16:00:00.000Z");
  });

  it("is stable for early-morning UTC instants of the same Beijing day", () => {
    const start = beijingDayStart(new Date("2026-08-05T00:30:00Z"));
    // 00:30 UTC == 08:30 Beijing, still Aug 5 in Beijing
    expect(start.toISOString()).toBe("2026-08-04T16:00:00.000Z");
  });
});
