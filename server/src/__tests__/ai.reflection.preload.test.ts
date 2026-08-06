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
      update: vi.fn(),
    },
    aiLesson: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$12$hashedpassword"),
    compare: vi.fn(),
  },
}));

import { prisma } from "../db/client.js";
import { ensureAiAccounts, resetAiStateForTests } from "../ai/accounts.js";
import { resetPersonasForTests } from "../ai/personas.js";
import {
  cachedLessonsForPersona,
  resetReflectionStoreForTests,
} from "../ai/reflection/store.js";

const at = new Date("2026-08-06T08:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  resetAiStateForTests();
  resetPersonasForTests();
  resetReflectionStoreForTests();

  vi.mocked(prisma.aiPersona.upsert).mockImplementation(
    async (args: {
      where: { slug: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) =>
      ({
        id: `persona-${args.where.slug}`,
        evolvedBluffHintRate: null,
        evolvedTemperature: null,
        evolvedAt: null,
        ...args.create,
        ...args.update,
      }) as never,
  );
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.user.create).mockImplementation(
    async (args: { data: { username: string } }) =>
      ({
        id: `ai-${args.data.username}`,
        username: args.data.username,
        password: "x",
        points: 10000,
        isAi: true,
        createdAt: new Date(),
      }) as never,
  );
});

describe("startup lesson preload (Q4)", () => {
  it("makes persisted lessons injectable immediately after startup", async () => {
    vi.mocked(prisma.aiLesson.findMany).mockResolvedValue([
      {
        id: "g1",
        personaSlug: null,
        text: "全局预热笔记",
        evidence: "e",
        status: "active",
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "p1",
        personaSlug: "tight-aggressive",
        text: "人格预热笔记",
        evidence: "e",
        status: "active",
        createdAt: at,
        updatedAt: at,
      },
    ] as never);

    await ensureAiAccounts();

    // AI_XiaoZhi binds to tight-aggressive; both scopes must be visible
    // before any reflection cycle has run.
    expect(cachedLessonsForPersona("tight-aggressive")).toEqual([
      "人格预热笔记",
      "全局预热笔记",
    ]);
    // Other personas see only the global lesson.
    expect(cachedLessonsForPersona("maniac")).toEqual(["全局预热笔记"]);
  });

  it("degrades to lesson-less prompts when the DB is unreachable", async () => {
    vi.mocked(prisma.aiLesson.findMany).mockRejectedValue(new Error("db down"));
    await expect(ensureAiAccounts()).resolves.toBeUndefined();
    expect(cachedLessonsForPersona("tight-aggressive")).toEqual([]);
  });
});
