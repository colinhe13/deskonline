import { prisma } from "../../db/client.js";
import type { HandSelfEvaluation } from "./evaluate.js";

// Cross-match cumulative counters for one AI's own outcomes — the evolution
// signal. Deliberately not an opponent impression: it describes how the AI's
// own play style fares overall, independent of who sits at the table.
export interface SelfStatsDelta {
  bluffAttempts: number;
  bluffSuccess: number;
  cbetAttempts: number;
  cbetSuccess: number;
}

// Room-scoped pending increments, flushed to PG at hand boundaries
// (every aiEvolveEveryHands) and once more at room teardown.
const pendingByRoom = new Map<string, Map<string, SelfStatsDelta>>();

function emptyDelta(): SelfStatsDelta {
  return { bluffAttempts: 0, bluffSuccess: 0, cbetAttempts: 0, cbetSuccess: 0 };
}

export function accumulateEvaluation(
  roomId: string,
  evaluation: HandSelfEvaluation,
): void {
  if (!evaluation.bluff && !evaluation.cbet) return;
  let byUser = pendingByRoom.get(roomId);
  if (!byUser) {
    byUser = new Map();
    pendingByRoom.set(roomId, byUser);
  }
  const delta = byUser.get(evaluation.userId) ?? emptyDelta();
  if (evaluation.bluff) {
    delta.bluffAttempts += 1;
    if (evaluation.bluff === "success") delta.bluffSuccess += 1;
  }
  if (evaluation.cbet) {
    delta.cbetAttempts += 1;
    if (evaluation.cbet === "success") delta.cbetSuccess += 1;
  }
  byUser.set(evaluation.userId, delta);
}

// Writes pending increments with increment semantics. On success only the
// flushed amounts are removed from the buffer, so events accumulated while
// the write was in flight survive; on failure the buffer is untouched and
// the next flush retries. Callers fire-and-forget and log failures — PG
// outage degrades to in-memory-only self stats, never disturbs the game.
export async function flushSelfStats(roomId: string): Promise<void> {
  const byUser = pendingByRoom.get(roomId);
  if (!byUser || byUser.size === 0) return;
  // Copy the deltas: the buffer keeps mutating the same objects while the
  // write is in flight, and the subtraction below must use the flushed values.
  const snapshot = [...byUser.entries()]
    .filter(([, d]) => d.bluffAttempts + d.cbetAttempts > 0)
    .map(([userId, d]) => [userId, { ...d }] as const);
  if (snapshot.length === 0) {
    pendingByRoom.delete(roomId);
    return;
  }
  await Promise.all(
    snapshot.map(([userId, d]) =>
      prisma.aiSelfStats.upsert({
        where: { userId },
        update: {
          bluffAttempts: { increment: d.bluffAttempts },
          bluffSuccess: { increment: d.bluffSuccess },
          cbetAttempts: { increment: d.cbetAttempts },
          cbetSuccess: { increment: d.cbetSuccess },
        },
        create: { userId, ...d },
      }),
    ),
  );
  for (const [userId, flushed] of snapshot) {
    const current = byUser.get(userId);
    if (!current) continue;
    current.bluffAttempts -= flushed.bluffAttempts;
    current.bluffSuccess -= flushed.bluffSuccess;
    current.cbetAttempts -= flushed.cbetAttempts;
    current.cbetSuccess -= flushed.cbetSuccess;
    if (
      current.bluffAttempts +
        current.bluffSuccess +
        current.cbetAttempts +
        current.cbetSuccess <=
      0
    ) {
      byUser.delete(userId);
    }
  }
  if (byUser.size === 0) pendingByRoom.delete(roomId);
}

export async function loadSelfStats(
  userIds: string[],
): Promise<Map<string, SelfStatsDelta>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.aiSelfStats.findMany({
    where: { userId: { in: userIds } },
  });
  return new Map(
    rows.map((r) => [
      r.userId,
      {
        bluffAttempts: r.bluffAttempts,
        bluffSuccess: r.bluffSuccess,
        cbetAttempts: r.cbetAttempts,
        cbetSuccess: r.cbetSuccess,
      },
    ]),
  );
}

// Called after the final teardown flush; drops whatever (if anything) a
// failed flush left behind so a recycled room id starts clean.
export function clearSelfStatsRoom(roomId: string): void {
  pendingByRoom.delete(roomId);
}

export function resetSelfStatsPersistForTests(): void {
  pendingByRoom.clear();
}
