import { prisma } from "../db/client.js";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  isAi: boolean;
  points: number;
  tableChips: number;
  total: number;
}

// Total assets = DB points + chips committed to tables (buy-in already
// deducted points, so ranking on points alone would undervalue seated
// players).
export async function getLeaderboard(
  tableChipsByUser: ReadonlyMap<string, number>,
): Promise<LeaderboardEntry[]> {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, points: true, isAi: true },
  });

  const entries = users.map((u) => {
    const tableChips = tableChipsByUser.get(u.id) ?? 0;
    return {
      userId: u.id,
      username: u.username,
      isAi: u.isAi,
      points: u.points,
      tableChips,
      total: u.points + tableChips,
    };
  });

  entries.sort(
    (a, b) => b.total - a.total || a.username.localeCompare(b.username),
  );
  return entries.map((e, i) => ({ rank: i + 1, ...e }));
}
