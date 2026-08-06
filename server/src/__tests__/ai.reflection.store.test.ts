import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  prisma: {
    aiLesson: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    aiHandSummary: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "../db/client.js";
import {
  insertLessons,
  retireLessons,
  loadActiveLessons,
  accumulateSummary,
  flushSummaries,
  clearSummariesRoom,
  cachedLessonsForPersona,
  refreshLessonCache,
  resetReflectionStoreForTests,
  LESSON_CAP_PER_SCOPE,
  type SummaryDraft,
} from "../ai/reflection/store.js";

function lessonRow(
  id: string,
  text: string,
  personaSlug: string | null = null,
  updatedAt = new Date("2026-08-06T12:00:00Z"),
) {
  return {
    id,
    personaSlug,
    text,
    evidence: "e",
    status: "active",
    createdAt: updatedAt,
    updatedAt,
    retiredAt: null,
  };
}

function summaryDraft(userId: string, netWon = 0): SummaryDraft {
  return {
    userId,
    position: "BTN",
    boardTexture: "干高牌面",
    streetReached: "flop",
    myBets: 1,
    myRaises: 0,
    facedBets: 0,
    bluffed: null,
    cbet: null,
    netWon,
    wonAtShowdown: false,
    foldedToBet: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetReflectionStoreForTests();
});

describe("insertLessons", () => {
  it("creates lessons, trimming text/evidence to caps", async () => {
    vi.mocked(prisma.aiLesson.findMany).mockResolvedValue([]);
    vi.mocked(prisma.aiLesson.create).mockImplementation(async (args) =>
      lessonRow("id1", (args as { data: { text: string } }).data.text),
    );
    const long = "x".repeat(200);
    const inserted = await insertLessons([
      { personaSlug: null, text: ` ${long} `, evidence: long },
    ]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].text).toHaveLength(80);
    expect(prisma.aiLesson.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evidence: "x".repeat(60),
        }),
      }),
    );
  });

  it("skips normalized-text duplicates within the same scope only", async () => {
    vi.mocked(prisma.aiLesson.findMany).mockImplementation(async (args) => {
      const where = (args as { where: { personaSlug: string | null } }).where;
      if (where.personaSlug === null)
        return [lessonRow("g1", "对跟注站不要薄价值下注")];
      return [];
    });
    const out = await insertLessons([
      // Same wording modulo punctuation/space: deduped in the global scope.
      { personaSlug: null, text: "对跟注站，不要薄价值 下注！", evidence: "e" },
      // Same text but persona scope: allowed.
      { personaSlug: "maniac", text: "对跟注站不要薄价值下注", evidence: "e" },
    ]);
    expect(out).toHaveLength(1);
    expect(prisma.aiLesson.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ personaSlug: "maniac" }),
      }),
    );
  });

  it("retires the oldest overflow beyond the per-scope cap", async () => {
    const existing = Array.from({ length: LESSON_CAP_PER_SCOPE }, (_, i) =>
      lessonRow(`l${i}`, `note ${i}`, null, new Date(2026, 0, i + 1)),
    );
    vi.mocked(prisma.aiLesson.findMany).mockResolvedValue(existing);
    vi.mocked(prisma.aiLesson.create).mockImplementation(async (args) =>
      lessonRow("new", (args as { data: { text: string } }).data.text),
    );
    vi.mocked(prisma.aiLesson.updateMany).mockResolvedValue({ count: 1 });
    const inserted = await insertLessons([
      { personaSlug: null, text: "fresh note", evidence: "e" },
    ]);
    expect(inserted).toHaveLength(1);
    expect(prisma.aiLesson.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["l0"] }, status: "active" },
        data: expect.objectContaining({ status: "retired" }),
      }),
    );
  });

  it("counts caps per scope independently", async () => {
    // Global scope full; persona scope empty -> persona insert prunes nothing.
    vi.mocked(prisma.aiLesson.findMany).mockImplementation(async (args) => {
      const where = (args as { where: { personaSlug: string | null } }).where;
      if (where.personaSlug === null)
        return Array.from({ length: LESSON_CAP_PER_SCOPE }, (_, i) =>
          lessonRow(`g${i}`, `global ${i}`),
        );
      return [];
    });
    vi.mocked(prisma.aiLesson.create).mockImplementation(async (args) =>
      lessonRow("p1", (args as { data: { text: string } }).data.text),
    );
    await insertLessons([
      { personaSlug: "nit-rock", text: "persona note", evidence: "e" },
    ]);
    expect(prisma.aiLesson.updateMany).not.toHaveBeenCalled();
  });

  it("skips empty texts", async () => {
    const out = await insertLessons([
      { personaSlug: null, text: "   ", evidence: "e" },
    ]);
    expect(out).toHaveLength(0);
    expect(prisma.aiLesson.create).not.toHaveBeenCalled();
  });
});

describe("retireLessons", () => {
  it("retires only active rows and reports the count", async () => {
    vi.mocked(prisma.aiLesson.updateMany).mockResolvedValue({ count: 2 });
    await expect(retireLessons(["a", "b", "c"])).resolves.toBe(2);
    expect(prisma.aiLesson.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["a", "b", "c"] }, status: "active" },
      }),
    );
  });

  it("no-ops on empty input", async () => {
    await expect(retireLessons([])).resolves.toBe(0);
    expect(prisma.aiLesson.updateMany).not.toHaveBeenCalled();
  });
});

describe("loadActiveLessons", () => {
  it("maps rows newest-first", async () => {
    vi.mocked(prisma.aiLesson.findMany).mockResolvedValue([
      lessonRow("a", "one"),
      lessonRow("b", "two", "maniac"),
    ]);
    const lessons = await loadActiveLessons();
    expect(lessons.map((l) => l.id)).toEqual(["a", "b"]);
    expect(lessons[1].personaSlug).toBe("maniac");
  });
});

describe("summary buffer flush", () => {
  it("writes the snapshot, keeps in-flight rows, and prunes the window", async () => {
    accumulateSummary("room1", summaryDraft("u1", 100));
    accumulateSummary("room1", summaryDraft("u1", -50));
    // Simulate a row accumulating while the write is in flight.
    vi.mocked(prisma.aiHandSummary.createMany).mockImplementation(async () => {
      accumulateSummary("room1", summaryDraft("u1", 10));
      return { count: 2 };
    });
    // 52 rows exist for u1 -> two must be pruned.
    vi.mocked(prisma.aiHandSummary.findMany).mockResolvedValue(
      Array.from({ length: 52 }, (_, i) => ({ id: `r${i}` })),
    );
    vi.mocked(prisma.aiHandSummary.deleteMany).mockResolvedValue({ count: 2 });

    await flushSummaries("room1");

    expect(prisma.aiHandSummary.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ netWon: 100 }),
        expect.objectContaining({ netWon: -50 }),
      ]),
    });
    expect(prisma.aiHandSummary.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["r50", "r51"] } },
    });

    // The in-flight row stays buffered for the next flush.
    vi.mocked(prisma.aiHandSummary.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.aiHandSummary.findMany).mockResolvedValue([]);
    await flushSummaries("room1");
    expect(prisma.aiHandSummary.createMany).toHaveBeenLastCalledWith({
      data: [expect.objectContaining({ netWon: 10 })],
    });
  });

  it("keeps the buffer intact when the write fails", async () => {
    accumulateSummary("room1", summaryDraft("u1"));
    vi.mocked(prisma.aiHandSummary.createMany).mockRejectedValue(
      new Error("db down"),
    );
    await expect(flushSummaries("room1")).rejects.toThrow("db down");
    // Retry flushes the same row once the DB recovers.
    vi.mocked(prisma.aiHandSummary.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.aiHandSummary.findMany).mockResolvedValue([]);
    await flushSummaries("room1");
    expect(prisma.aiHandSummary.createMany).toHaveBeenCalledTimes(2);
  });

  it("clearSummariesRoom drops the room buffer", async () => {
    accumulateSummary("room1", summaryDraft("u1"));
    clearSummariesRoom("room1");
    await flushSummaries("room1");
    expect(prisma.aiHandSummary.createMany).not.toHaveBeenCalled();
  });
});

describe("lesson cache", () => {
  it("merges persona lessons first, then global, in load order", () => {
    refreshLessonCache([
      lessonRow("p1", "persona newer", "maniac"),
      lessonRow("p2", "persona older", "maniac"),
      lessonRow("g1", "global newer", null),
      lessonRow("g2", "global older", null),
    ]);
    expect(cachedLessonsForPersona("maniac")).toEqual([
      "persona newer",
      "persona older",
      "global newer",
      "global older",
    ]);
    expect(cachedLessonsForPersona("nit-rock")).toEqual([
      "global newer",
      "global older",
    ]);
  });

  it("refresh replaces the previous cache", () => {
    refreshLessonCache([lessonRow("g1", "old", null)]);
    refreshLessonCache([lessonRow("g2", "new", null)]);
    expect(cachedLessonsForPersona("balanced")).toEqual(["new"]);
  });
});
