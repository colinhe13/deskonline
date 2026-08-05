import { prisma } from "../db/client.js";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  isAi: boolean;
  points: number;
  tableChips: number;
  total: number;
  dailyDelta: number;
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Start of the current day in Beijing time (UTC+8), independent of the
// server's system timezone.
export function beijingDayStart(now: Date = new Date()): Date {
  const beijingDayMs =
    Math.floor((now.getTime() + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(beijingDayMs - BEIJING_OFFSET_MS);
}

// Total assets = DB points + chips committed to tables (buy-in already
// deducted points, so ranking on points alone would undervalue seated
// players).
export async function getLeaderboard(
  tableChipsByUser: ReadonlyMap<string, number>,
): Promise<LeaderboardEntry[]> {
  const [users, dailySums] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, username: true, points: true, isAi: true },
    }),
    prisma.pointsTransaction.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: beijingDayStart() } },
      _sum: { delta: true },
    }),
  ]);

  const deltaByUser = new Map<string, number>();
  for (const row of dailySums) {
    deltaByUser.set(row.userId, row._sum.delta ?? 0);
  }

  const entries = users.map((u) => {
    const tableChips = tableChipsByUser.get(u.id) ?? 0;
    return {
      userId: u.id,
      username: u.username,
      isAi: u.isAi,
      points: u.points,
      tableChips,
      total: u.points + tableChips,
      dailyDelta: deltaByUser.get(u.id) ?? 0,
    };
  });

  entries.sort(
    (a, b) => b.total - a.total || a.username.localeCompare(b.username),
  );
  return entries.map((e, i) => ({ rank: i + 1, ...e }));
}
