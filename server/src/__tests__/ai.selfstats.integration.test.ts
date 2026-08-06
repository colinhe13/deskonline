import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db/client.js";
import { loadSelfStats } from "../ai/selfreview/persist.js";

// Integration test against the real remote texaspoker database
// (DATABASE_URL from .env, per AGENTS.md test strategy). Skipped when no
// database is configured. Uses a throwaway user; cascade deletion is both
// asserted and the cleanup mechanism.
const RUN = process.env.DATABASE_URL ? describe : describe.skip;

RUN("ai_self_stats persistence (remote DB)", () => {
  let userId: string;
  const username = `it_selfstats_${process.pid}`;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username, password: "unused-in-test" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Cascade drops the stats row too; ignore if the cascade test already
    // removed the user.
    await prisma.user.deleteMany({ where: { username } });
  });

  it("creates and accumulates counters with increment semantics", async () => {
    await prisma.aiSelfStats.upsert({
      where: { userId },
      update: {
        bluffAttempts: { increment: 1 },
        bluffSuccess: { increment: 1 },
      },
      create: { userId, bluffAttempts: 1, bluffSuccess: 1 },
    });
    await prisma.aiSelfStats.upsert({
      where: { userId },
      update: {
        bluffAttempts: { increment: 2 },
        cbetAttempts: { increment: 3 },
        cbetSuccess: { increment: 2 },
      },
      create: { userId },
    });

    const map = await loadSelfStats([userId]);
    expect(map.get(userId)).toEqual({
      bluffAttempts: 3,
      bluffSuccess: 1,
      cbetAttempts: 3,
      cbetSuccess: 2,
    });
  });

  it("loads nothing for unknown users", async () => {
    const map = await loadSelfStats(["no-such-user-id"]);
    expect(map.size).toBe(0);
  });

  it("cascade-deletes stats when the AI account is removed", async () => {
    await prisma.user.delete({ where: { id: userId } });
    const row = await prisma.aiSelfStats.findUnique({ where: { userId } });
    expect(row).toBeNull();
  });

  it("persists only counter columns — no card-bearing fields in the table", async () => {
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      "select column_name from information_schema.columns where table_name = 'ai_self_stats'",
    );
    const names = columns.map((c) => c.column_name);
    expect(names.sort()).toEqual([
      "bluff_attempts",
      "bluff_success",
      "cbet_attempts",
      "cbet_success",
      "updated_at",
      "user_id",
    ]);
    for (const name of names) {
      expect(name.toLowerCase()).not.toContain("card");
    }
  });
});
