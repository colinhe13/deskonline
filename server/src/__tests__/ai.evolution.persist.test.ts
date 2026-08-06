import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../db/client.js", () => ({
  prisma: {
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

import { prisma } from "../db/client.js";
import {
  accumulateEvaluation,
  clearSelfStatsRoom,
  flushSelfStats,
  loadSelfStats,
  resetSelfStatsPersistForTests,
} from "../ai/selfreview/persist.js";
import type { HandSelfEvaluation } from "../ai/selfreview/evaluate.js";
import { evolveAiUser } from "../ai/evolution/engine.js";
import {
  PERSONA_SEEDS,
  bindUserPersona,
  ensureAiPersonas,
  personaOfUser,
  resetPersonasForTests,
} from "../ai/personas.js";

const evaluation = (
  userId: string,
  fields: Partial<HandSelfEvaluation> = {},
): HandSelfEvaluation => ({ userId, handNumber: 1, ...fields });

beforeEach(() => {
  vi.clearAllMocks();
  resetSelfStatsPersistForTests();
  vi.mocked(prisma.aiSelfStats.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.aiPersona.update).mockResolvedValue({} as never);
});

describe("selfreview persist accumulation + flush", () => {
  it("ignores evaluations without bluff or cbet outcomes", async () => {
    accumulateEvaluation("r1", evaluation("a1"));
    await flushSelfStats("r1");
    expect(prisma.aiSelfStats.upsert).not.toHaveBeenCalled();
  });

  it("aggregates outcomes per user and flushes with increment semantics", async () => {
    accumulateEvaluation("r1", evaluation("a1", { bluff: "success" }));
    accumulateEvaluation("r1", evaluation("a1", { bluff: "caught" }));
    accumulateEvaluation("r1", evaluation("a1", { cbet: "success" }));
    accumulateEvaluation("r1", evaluation("a2", { cbet: "failed" }));

    await flushSelfStats("r1");

    const calls = vi.mocked(prisma.aiSelfStats.upsert).mock.calls;
    expect(calls).toHaveLength(2);
    const byUser = Object.fromEntries(
      calls.map((c) => {
        const arg = c[0] as {
          where: { userId: string };
          update: Record<string, { increment: number }>;
          create: Record<string, number>;
        };
        return [arg.where.userId, arg];
      }),
    );
    expect(byUser["a1"].update).toEqual({
      bluffAttempts: { increment: 2 },
      bluffSuccess: { increment: 1 },
      cbetAttempts: { increment: 1 },
      cbetSuccess: { increment: 1 },
    });
    expect(byUser["a2"].update).toEqual({
      bluffAttempts: { increment: 0 },
      bluffSuccess: { increment: 0 },
      cbetAttempts: { increment: 1 },
      cbetSuccess: { increment: 0 },
    });
    // create payload mirrors the counters — nothing else.
    expect(byUser["a1"].create).toMatchObject({
      userId: "a1",
      bluffAttempts: 2,
      bluffSuccess: 1,
      cbetAttempts: 1,
      cbetSuccess: 1,
    });

    // Buffer drained: a second flush is a no-op.
    await flushSelfStats("r1");
    expect(prisma.aiSelfStats.upsert).toHaveBeenCalledTimes(2);
  });

  it("keeps the buffer intact when the write fails (retry-safe)", async () => {
    accumulateEvaluation("r1", evaluation("a1", { bluff: "success" }));
    vi.mocked(prisma.aiSelfStats.upsert).mockRejectedValueOnce(
      new Error("pg down"),
    );

    await expect(flushSelfStats("r1")).rejects.toThrow("pg down");

    vi.mocked(prisma.aiSelfStats.upsert).mockResolvedValueOnce({} as never);
    await flushSelfStats("r1");
    const retry = vi
      .mocked(prisma.aiSelfStats.upsert)
      .mock.calls.at(-1)![0] as {
      update: Record<string, { increment: number }>;
    };
    expect(retry.update.bluffAttempts).toEqual({ increment: 1 });
  });

  it("preserves events accumulated while a flush is in flight", async () => {
    accumulateEvaluation("r1", evaluation("a1", { bluff: "success" }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(prisma.aiSelfStats.upsert).mockImplementationOnce(async () => {
      await gate;
      return {} as never;
    });

    const inFlight = flushSelfStats("r1");
    accumulateEvaluation("r1", evaluation("a1", { bluff: "caught" }));
    release();
    await inFlight;

    // The in-flight event must survive to the next flush.
    await flushSelfStats("r1");
    const calls = vi.mocked(prisma.aiSelfStats.upsert).mock.calls;
    expect(calls).toHaveLength(2);
    const second = calls[1][0] as {
      update: Record<string, { increment: number }>;
    };
    expect(second.update.bluffAttempts).toEqual({ increment: 1 });
    expect(second.update.bluffSuccess).toEqual({ increment: 0 });
  });

  it("clearSelfStatsRoom drops residue for a recycled room id", async () => {
    accumulateEvaluation("r1", evaluation("a1", { bluff: "success" }));
    clearSelfStatsRoom("r1");
    await flushSelfStats("r1");
    expect(prisma.aiSelfStats.upsert).not.toHaveBeenCalled();
  });

  it("loads cumulative counters by user id", async () => {
    vi.mocked(prisma.aiSelfStats.findMany).mockResolvedValue([
      {
        userId: "a1",
        bluffAttempts: 9,
        bluffSuccess: 6,
        cbetAttempts: 3,
        cbetSuccess: 2,
      },
    ] as never);
    const map = await loadSelfStats(["a1", "missing"]);
    expect(map.get("a1")).toEqual({
      bluffAttempts: 9,
      bluffSuccess: 6,
      cbetAttempts: 3,
      cbetSuccess: 2,
    });
    expect(map.has("missing")).toBe(false);
    expect(await loadSelfStats([])).toEqual(new Map());
  });

  it("writes only flat counter fields — no cards, no opponent data", async () => {
    accumulateEvaluation("r1", evaluation("a1", { bluff: "success" }));
    await flushSelfStats("r1");
    const allowed = new Set([
      "where",
      "update",
      "create",
      "userId",
      "bluffAttempts",
      "bluffSuccess",
      "cbetAttempts",
      "cbetSuccess",
      "increment",
    ]);
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        expect(allowed.has(key)).toBe(true);
        expect(key.toLowerCase()).not.toContain("card");
        walk(child);
      }
    };
    for (const call of vi.mocked(prisma.aiSelfStats.upsert).mock.calls) {
      walk(call[0]);
    }
  });
});

describe("evolution engine", () => {
  beforeEach(async () => {
    resetPersonasForTests();
    vi.mocked(prisma.aiPersona.upsert).mockImplementation(
      async (args: { create: Record<string, unknown> }) =>
        ({ id: `p-${args.create.slug}`, ...args.create }) as never,
    );
    await ensureAiPersonas();
    const maniacSeed = PERSONA_SEEDS.find((s) => s.slug === "maniac")!;
    bindUserPersona("a1", {
      id: "p-maniac",
      slug: "maniac",
      displayName: maniacSeed.displayName,
      styleLabel: maniacSeed.styleLabel,
      promptSection: maniacSeed.promptSection,
      temperature: maniacSeed.temperature,
      bluffHintRate: maniacSeed.bluffHintRate,
      seedTemperature: maniacSeed.temperature,
      seedBluffHintRate: maniacSeed.bluffHintRate,
      evolvedAt: null,
    });
  });

  const selfStats = (bluffAttempts: number, bluffSuccess: number) =>
    [
      {
        userId: "a1",
        bluffAttempts,
        bluffSuccess,
        cbetAttempts: 0,
        cbetSuccess: 0,
      },
    ] as never;

  it("does nothing for users without a persona", async () => {
    vi.mocked(prisma.aiSelfStats.findMany).mockResolvedValue(selfStats(10, 10));
    await evolveAiUser("nobody");
    expect(prisma.aiPersona.update).not.toHaveBeenCalled();
  });

  it("does not evolve before the minimum sample count", async () => {
    vi.mocked(prisma.aiSelfStats.findMany).mockResolvedValue(selfStats(4, 4));
    await evolveAiUser("a1");
    expect(prisma.aiPersona.update).not.toHaveBeenCalled();
    expect(personaOfUser("a1")?.bluffHintRate).toBe(0.4);
  });

  it("does not evolve without any persisted stats yet", async () => {
    vi.mocked(prisma.aiSelfStats.findMany).mockResolvedValue([]);
    await evolveAiUser("a1");
    expect(prisma.aiPersona.update).not.toHaveBeenCalled();
  });

  it("raises the baseline when bluffs keep landing and refreshes the view", async () => {
    vi.mocked(prisma.aiSelfStats.findMany).mockResolvedValue(selfStats(10, 8));
    await evolveAiUser("a1");
    const updateArg = vi.mocked(prisma.aiPersona.update).mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArg.where.id).toBe("p-maniac");
    expect(updateArg.data.evolvedBluffHintRate).toBeCloseTo(0.44, 10);
    expect(updateArg.data.evolvedAt).toBeInstanceOf(Date);
    // Hot-path view picks the new baseline up without a restart; the seed
    // anchor stays put.
    expect(personaOfUser("a1")?.bluffHintRate).toBeCloseTo(0.44, 10);
    expect(personaOfUser("a1")?.seedBluffHintRate).toBeCloseTo(0.4, 10);
    expect(personaOfUser("a1")?.evolvedAt).toBeInstanceOf(Date);
  });

  it("lowers the baseline when bluffs keep getting caught", async () => {
    vi.mocked(prisma.aiSelfStats.findMany).mockResolvedValue(selfStats(10, 1));
    await evolveAiUser("a1");
    expect(personaOfUser("a1")?.bluffHintRate).toBeCloseTo(0.36, 10);
  });

  it("skips the write when the rate lands in the hold band", async () => {
    vi.mocked(prisma.aiSelfStats.findMany).mockResolvedValue(selfStats(10, 5));
    await evolveAiUser("a1");
    expect(prisma.aiPersona.update).not.toHaveBeenCalled();
  });

  it("propagates DB failures to the caller (lobby catches, game untouched)", async () => {
    vi.mocked(prisma.aiSelfStats.findMany).mockRejectedValueOnce(
      new Error("pg down"),
    );
    await expect(evolveAiUser("a1")).rejects.toThrow("pg down");
    expect(personaOfUser("a1")?.bluffHintRate).toBe(0.4);
  });
});

describe("information isolation boundary (source scan)", () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it("table-scoped stores never import the DB client", () => {
    for (const rel of [
      "../ai/profiling/store.ts",
      "../ai/selfreview/store.ts",
    ]) {
      const source = readFileSync(join(here, rel), "utf8");
      expect(source).not.toContain("db/client");
      expect(source).not.toContain("prisma");
    }
  });

  it("persisted self stats carry no card-bearing structures", () => {
    const source = readFileSync(
      join(here, "../ai/selfreview/persist.ts"),
      "utf8",
    );
    expect(source.toLowerCase()).not.toContain("holecards");
    expect(source).not.toContain("communityCards");
  });
});
