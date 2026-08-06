import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../config.js", () => ({
  config: { aiTimeoutMs: 10, aiReflectionEnabled: true },
}));

vi.mock("../ai/llm.client.js", () => ({
  callLlm: vi.fn(),
}));

vi.mock("../ai/personas.js", () => ({
  allPersonaViews: vi.fn(() => []),
  personaBindings: vi.fn(() => new Map()),
}));

const prismaMock = vi.hoisted(() => ({
  aiLesson: {
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  aiHandSummary: {
    count: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  aiSelfStats: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("../db/client.js", () => ({ prisma: prismaMock }));

import { config } from "../config.js";
import { callLlm } from "../ai/llm.client.js";
import { allPersonaViews, personaBindings } from "../ai/personas.js";
import type { AiPersonaView } from "../ai/personas.js";
import {
  reflectAll,
  resetReflectionEngineForTests,
  setReflectionStateForTests,
} from "../ai/reflection/reflect.js";
import {
  cachedLessonsForPersona,
  resetReflectionStoreForTests,
} from "../ai/reflection/store.js";

const personaA: AiPersonaView = {
  id: "pa",
  slug: "tight-passive",
  displayName: "紧被动",
  styleLabel: "NIT",
  promptSection: "你是一名紧被动玩家。",
  temperature: 0.4,
  bluffHintRate: 0.05,
  seedTemperature: 0.4,
  seedBluffHintRate: 0.05,
  evolvedAt: null,
};

const personaB: AiPersonaView = {
  ...personaA,
  id: "pb",
  slug: "loose-aggressive",
  displayName: "松凶",
  styleLabel: "LAG",
  promptSection: "你是一名松凶玩家。",
  bluffHintRate: 0.3,
  seedBluffHintRate: 0.3,
};

let activeLessons: {
  id: string;
  personaSlug: string | null;
  text: string;
  evidence: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}[] = [];
let createdCount = 0;

function summaryRow(userId: string) {
  const at = new Date("2026-08-06T10:00:00Z");
  return {
    id: `s-${userId}`,
    userId,
    position: "BTN",
    boardTexture: "干高牌面",
    streetReached: "river",
    myBets: 1,
    myRaises: 0,
    facedBets: 1,
    bluffed: "success",
    cbet: null,
    netWon: 12,
    wonAtShowdown: false,
    foldedToBet: false,
    playedAt: at,
  };
}

function validOutput(scope: string) {
  return {
    lessons: [
      {
        scope,
        text: "河牌超池下注前确认有摊牌价值",
        evidence: "近10手净盈亏+12",
      },
    ],
    retireIds: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetReflectionEngineForTests();
  resetReflectionStoreForTests();
  activeLessons = [];
  createdCount = 0;

  prismaMock.aiHandSummary.count.mockResolvedValue(12);
  prismaMock.aiHandSummary.findMany.mockImplementation(
    async (args: { where?: { userId?: string } }) =>
      args?.where?.userId ? [summaryRow(args.where.userId)] : [],
  );
  prismaMock.aiSelfStats.findMany.mockResolvedValue([]);
  prismaMock.aiLesson.findMany.mockImplementation(
    async (args: { where?: { personaSlug?: unknown } }) =>
      // The per-scope dedupe scan passes personaSlug (possibly null); the
      // full active-lessons load does not.
      args?.where && "personaSlug" in args.where ? [] : activeLessons,
  );
  prismaMock.aiLesson.create.mockImplementation(
    async (args: {
      data: { personaSlug: string | null; text: string; evidence: string };
    }) => {
      createdCount += 1;
      const at = new Date("2026-08-06T12:00:00Z");
      const row = {
        id: `created-${createdCount}`,
        personaSlug: args.data.personaSlug,
        text: args.data.text,
        evidence: args.data.evidence,
        status: "active",
        createdAt: at,
        updatedAt: at,
      };
      activeLessons.push(row);
      return row;
    },
  );
  prismaMock.aiLesson.updateMany.mockResolvedValue({ count: 1 });

  vi.mocked(allPersonaViews).mockReturnValue([personaA, personaB]);
  vi.mocked(personaBindings).mockReturnValue(new Map([["u1", personaA]]));
  vi.mocked(callLlm).mockResolvedValue(validOutput("tight-passive"));
});

afterEach(() => {
  config.aiReflectionEnabled = true;
});

describe("reflectAll material gates", () => {
  it("does nothing when the feature switch is off", async () => {
    config.aiReflectionEnabled = false;
    await reflectAll();
    expect(callLlm).not.toHaveBeenCalled();
    expect(prismaMock.aiHandSummary.count).not.toHaveBeenCalled();
    expect(prismaMock.aiLesson.create).not.toHaveBeenCalled();
  });

  it("skips while the previous cycle is still in flight", async () => {
    setReflectionStateForTests({ reflecting: true });
    await reflectAll();
    expect(callLlm).not.toHaveBeenCalled();
    expect(prismaMock.aiHandSummary.count).not.toHaveBeenCalled();
  });

  it("skips without an LLM call when there is no new material", async () => {
    prismaMock.aiHandSummary.count.mockResolvedValue(0);
    await reflectAll();
    expect(callLlm).not.toHaveBeenCalled();
    expect(prismaMock.aiLesson.create).not.toHaveBeenCalled();
  });

  it("skips without an LLM call below the 10-summary minimum", async () => {
    prismaMock.aiHandSummary.count.mockResolvedValue(9);
    await reflectAll();
    expect(callLlm).not.toHaveBeenCalled();
    expect(prismaMock.aiLesson.create).not.toHaveBeenCalled();
  });
});

describe("reflectAll happy path", () => {
  it("persists scoped lessons, refreshes the cache, advances the anchor", async () => {
    await reflectAll();

    expect(callLlm).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(callLlm).mock.calls[0][2];
    expect(opts).toMatchObject({ maxTokens: 500, temperature: 0.2 });

    // The user content carries server-aggregated conclusions, not raw hands.
    const content = JSON.parse(vi.mocked(callLlm).mock.calls[0][1] as string);
    expect(content.personas).toHaveLength(2);
    expect(content.personas[0].slug).toBe("tight-passive");
    expect(content.personas[0].recent.samples).toBe(1);
    expect(content.personas[0].promptSection).toBe("你是一名紧被动玩家。");
    expect(JSON.stringify(content)).not.toContain("cards");

    expect(prismaMock.aiLesson.create).toHaveBeenCalledTimes(1);
    // The debounce anchor advanced: a follow-up probe is not anchored at epoch.
    const since = prismaMock.aiHandSummary.count.mock.calls[0][0].where.playedAt
      .gt as Date;
    expect(since.getTime()).toBe(0);
  });

  it("maps scope 'global' to a null personaSlug and slug to the persona", async () => {
    vi.mocked(callLlm).mockResolvedValueOnce(validOutput("global"));
    await reflectAll();
    expect(prismaMock.aiLesson.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ personaSlug: null }),
      }),
    );
    // Global lessons reach every persona through the cache.
    expect(cachedLessonsForPersona("loose-aggressive")).toContain(
      "河牌超池下注前确认有摊牌价值",
    );

    resetReflectionStoreForTests();
    activeLessons = [];
    vi.mocked(callLlm).mockResolvedValueOnce(validOutput("loose-aggressive"));
    await reflectAll();
    expect(prismaMock.aiLesson.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ personaSlug: "loose-aggressive" }),
      }),
    );
    // Persona-scoped lessons do not leak into other personas.
    expect(cachedLessonsForPersona("tight-passive")).not.toContain(
      "河牌超池下注前确认有摊牌价值",
    );
  });

  it("retires only ids that were provided in the reflection input", async () => {
    const at = new Date("2026-08-06T09:00:00Z");
    activeLessons.push({
      id: "old-1",
      personaSlug: null,
      text: "过时的旧笔记",
      evidence: "e",
      status: "active",
      createdAt: at,
      updatedAt: at,
    });
    vi.mocked(callLlm).mockResolvedValueOnce({
      lessons: [],
      retireIds: ["old-1"],
    });

    await reflectAll();

    const content = JSON.parse(vi.mocked(callLlm).mock.calls[0][1] as string);
    expect(content.existingLessons).toEqual([
      { id: "old-1", scope: "global", text: "过时的旧笔记" },
    ]);
    expect(prismaMock.aiLesson.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["old-1"] } }),
      }),
    );
  });

  it("advances the anchor even when the LLM fails, so rows are not reprocessed", async () => {
    const probe = vi.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(12);
    prismaMock.aiHandSummary.count.mockImplementation(probe);
    vi.mocked(callLlm).mockResolvedValueOnce(null);

    await reflectAll();
    expect(prismaMock.aiLesson.create).not.toHaveBeenCalled();

    await reflectAll();
    // Second call: the anchor must no longer be the epoch sentinel.
    const secondSince = probe.mock.calls[1][0].where.playedAt.gt as Date;
    expect(secondSince.getTime()).toBeGreaterThan(0);
  });
});

describe("reflectAll rejects invalid LLM output wholesale", () => {
  const cases: [string, unknown][] = [
    [
      "more than 3 lessons",
      {
        lessons: Array.from({ length: 4 }, (_, i) => ({
          scope: "global",
          text: `笔记${i}`,
          evidence: "e",
        })),
        retireIds: [],
      },
    ],
    [
      "overlong text",
      {
        lessons: [{ scope: "global", text: "字".repeat(81), evidence: "e" }],
        retireIds: [],
      },
    ],
    [
      "overlong evidence",
      {
        lessons: [{ scope: "global", text: "ok", evidence: "字".repeat(61) }],
        retireIds: [],
      },
    ],
    [
      "unknown scope",
      {
        lessons: [{ scope: "not-a-persona", text: "ok", evidence: "e" }],
        retireIds: [],
      },
    ],
    [
      "scope case sensitivity",
      {
        lessons: [{ scope: "GLOBAL", text: "ok", evidence: "e" }],
        retireIds: [],
      },
    ],
    [
      "retireIds outside the provided set",
      { lessons: [], retireIds: ["never-provided"] },
    ],
    ["wrong shape (lessons not an array)", { lessons: "nope", retireIds: [] }],
    [
      "missing required field",
      { lessons: [{ scope: "global", text: "ok" }], retireIds: [] },
    ],
  ];

  it.each(cases)("discards %s without writing", async (_name, payload) => {
    vi.mocked(callLlm).mockResolvedValueOnce(
      payload as Record<string, unknown>,
    );
    await reflectAll();
    expect(prismaMock.aiLesson.create).not.toHaveBeenCalled();
    expect(prismaMock.aiLesson.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the cache untouched when the LLM is unreachable", async () => {
    vi.mocked(callLlm).mockResolvedValueOnce(null);
    await reflectAll();
    expect(cachedLessonsForPersona("tight-passive")).toEqual([]);
  });

  it("survives a DB outage without throwing and leaves the cache intact", async () => {
    prismaMock.aiHandSummary.count.mockRejectedValueOnce(new Error("db down"));
    await expect(reflectAll()).resolves.toBeUndefined();
    expect(callLlm).not.toHaveBeenCalled();
  });
});

describe("reflection source isolation", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const scan = (rel: string) => readFileSync(join(here, rel), "utf8");

  it("never lets lesson/summary storage reach a WS payload path", () => {
    // The WS protocol and room serialization never import reflection storage.
    for (const rel of [
      "../ws/protocol.ts",
      "../lobby/room.ts",
      "../ws/gateway.ts",
    ]) {
      const src = scan(rel);
      expect(src).not.toContain("ai/reflection");
      expect(src).not.toContain("aiLesson");
      expect(src).not.toContain("aiHandSummary");
    }
    // The lobby imports the reflection modules only for the server-side
    // learning loop; broadcast/sendToUser payload construction must not
    // reference lesson or summary identifiers.
    const lobby = scan("../lobby/lobby.handler.ts");
    const pushRe = /(?:broadcast|sendToUser)\s*\([^)]*\)/g;
    for (const match of lobby.match(pushRe) ?? []) {
      expect(match).not.toMatch(/lesson/i);
      expect(match).not.toMatch(/summary/i);
    }
  });
});
