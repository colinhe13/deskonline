import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../db/client.js";
import { getLeaderboard } from "../leaderboard/leaderboard.service.js";

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

describe("leaderboard service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
