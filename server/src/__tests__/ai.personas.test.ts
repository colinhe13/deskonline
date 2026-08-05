import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiPersona: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$12$hashedpassword"),
  },
}));

import { prisma } from "../db/client.js";
import {
  PERSONA_SEEDS,
  ensureAiPersonas,
  personaForPoolIndex,
  personaViewBySlug,
  personaOfUser,
  bindUserPersona,
  resetPersonasForTests,
} from "../ai/personas.js";
import { ensureAiAccounts, resetAiStateForTests } from "../ai/accounts.js";

const EXPECTED_SLUGS = [
  "tight-aggressive",
  "loose-aggressive",
  "calling-station",
  "maniac",
  "nit-rock",
  "balanced",
];

describe("PERSONA_SEEDS", () => {
  it("defines the six reviewed personas with unique slugs", () => {
    expect(PERSONA_SEEDS.map((s) => s.slug)).toEqual(EXPECTED_SLUGS);
    expect(new Set(PERSONA_SEEDS.map((s) => s.slug)).size).toBe(6);
  });

  it("keeps temperature and bluffHintRate within sane bounds", () => {
    for (const seed of PERSONA_SEEDS) {
      expect(seed.temperature).toBeGreaterThan(0);
      expect(seed.temperature).toBeLessThanOrEqual(1.2);
      expect(seed.bluffHintRate).toBeGreaterThanOrEqual(0);
      expect(seed.bluffHintRate).toBeLessThanOrEqual(1);
      expect(seed.promptSection.length).toBeGreaterThan(50);
      expect(seed.displayName.length).toBeGreaterThan(0);
      expect(seed.styleLabel.length).toBeGreaterThan(0);
    }
  });

  it("gives aggressive personas strictly more bluff hints than passive ones", () => {
    const bySlug = Object.fromEntries(PERSONA_SEEDS.map((s) => [s.slug, s]));
    expect(bySlug["maniac"].bluffHintRate).toBeGreaterThan(
      bySlug["loose-aggressive"].bluffHintRate,
    );
    expect(bySlug["loose-aggressive"].bluffHintRate).toBeGreaterThan(
      bySlug["balanced"].bluffHintRate,
    );
    expect(bySlug["balanced"].bluffHintRate).toBeGreaterThan(
      bySlug["tight-aggressive"].bluffHintRate,
    );
    expect(bySlug["nit-rock"].bluffHintRate).toBeLessThan(0.05);
    expect(bySlug["calling-station"].bluffHintRate).toBeLessThan(0.1);
  });

  it("cycles seeds when the account pool is larger than six", () => {
    expect(personaForPoolIndex(0).slug).toBe("tight-aggressive");
    expect(personaForPoolIndex(5).slug).toBe("balanced");
    expect(personaForPoolIndex(6).slug).toBe("tight-aggressive");
    expect(personaForPoolIndex(7).slug).toBe("loose-aggressive");
  });
});

describe("ensureAiPersonas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPersonasForTests();
    vi.mocked(prisma.aiPersona.upsert).mockImplementation(
      async (args: { create: Record<string, unknown> }) =>
        ({ id: `p-${args.create.slug}`, ...args.create }) as never,
    );
  });

  it("upserts every seed by slug with overwrite semantics", async () => {
    const map = await ensureAiPersonas();
    expect(prisma.aiPersona.upsert).toHaveBeenCalledTimes(6);
    expect(map.size).toBe(6);
    for (const call of vi.mocked(prisma.aiPersona.upsert).mock.calls) {
      const args = call[0] as {
        where: { slug: string };
        update: Record<string, unknown>;
      };
      // Overwrite review decision: update carries all mutable fields.
      expect(args.update).toHaveProperty("promptSection");
      expect(args.update).toHaveProperty("temperature");
      expect(args.update).toHaveProperty("bluffHintRate");
      expect(personaViewBySlug(args.where.slug)?.id).toBe(
        `p-${args.where.slug}`,
      );
    }
  });
});

describe("personaOfUser", () => {
  beforeEach(() => resetPersonasForTests());

  it("returns null before any binding", () => {
    expect(personaOfUser("nobody")).toBeNull();
  });

  it("returns the bound persona after bindUserPersona", () => {
    const view = {
      id: "p1",
      slug: "maniac",
      displayName: "疯狂型",
      styleLabel: "MANIAC",
      promptSection: "text",
      temperature: 1.0,
      bluffHintRate: 0.4,
    };
    bindUserPersona("u1", view);
    expect(personaOfUser("u1")).toEqual(view);
  });
});

describe("ensureAiAccounts persona binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPersonasForTests();
    resetAiStateForTests();
    vi.mocked(prisma.aiPersona.upsert).mockImplementation(
      async (args: { create: Record<string, unknown> }) =>
        ({ id: `p-${args.create.slug}`, ...args.create }) as never,
    );
  });

  it("assigns personas by pool order when creating accounts", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockImplementation(
      async (args: { data: { username: string; personaId: string | null } }) =>
        ({
          id: `ai-${args.data.username}`,
          username: args.data.username,
        }) as never,
    );
    await ensureAiAccounts();
    const created = vi
      .mocked(prisma.user.create)
      .mock.calls.map(
        (c) => (c[0] as { data: { username: string; personaId: string } }).data,
      );
    expect(created[0]).toMatchObject({
      username: "AI_XiaoZhi",
      personaId: "p-tight-aggressive",
    });
    expect(created[1]).toMatchObject({
      username: "AI_LaoWang",
      personaId: "p-loose-aggressive",
    });
    expect(created[2]).toMatchObject({
      username: "AI_MeiLing",
      personaId: "p-calling-station",
    });
    expect(personaOfUser("ai-AI_XiaoZhi")?.slug).toBe("tight-aggressive");
  });

  it("backfills personaId for existing AI accounts without one", async () => {
    vi.mocked(prisma.user.findUnique).mockImplementation(
      async (args: { where: { username: string } }) =>
        ({
          id: `existing-${args.where.username}`,
          username: args.where.username,
          isAi: true,
          personaId: null,
        }) as never,
    );
    await ensureAiAccounts();
    const updates = vi
      .mocked(prisma.user.update)
      .mock.calls.map((c) => (c[0] as { data: { personaId?: string } }).data);
    expect(updates.length).toBe(3);
    expect(updates[0]).toMatchObject({ personaId: "p-tight-aggressive" });
  });

  it("never overwrites an existing personaId", async () => {
    vi.mocked(prisma.user.findUnique).mockImplementation(
      async (args: { where: { username: string } }) =>
        ({
          id: `existing-${args.where.username}`,
          username: args.where.username,
          isAi: true,
          personaId: "p-custom",
        }) as never,
    );
    await ensureAiAccounts();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
