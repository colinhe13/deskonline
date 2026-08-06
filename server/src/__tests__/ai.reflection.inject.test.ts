import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { aiTimeoutMs: 10, aiReflectionEnabled: true },
}));

vi.mock("../ai/llm.client.js", () => ({
  callLlm: vi.fn(),
}));

import { decideAiAction } from "../ai/decision.js";
import { buildSystemPrompt } from "../ai/prompt.js";
import { callLlm } from "../ai/llm.client.js";
import { config } from "../config.js";
import { bindUserPersona, resetPersonasForTests } from "../ai/personas.js";
import type { AiPersonaView } from "../ai/personas.js";
import {
  refreshLessonCache,
  resetReflectionStoreForTests,
  LESSON_INJECTION_MAX,
} from "../ai/reflection/store.js";
import type { GameState, ActionOption } from "../poker/types.js";

const persona: AiPersonaView = {
  id: "p1",
  slug: "loose-aggressive",
  displayName: "松凶",
  styleLabel: "LAG",
  promptSection: "你是一名松凶（LAG）玩家。测试人格段落。",
  temperature: 0.9,
  bluffHintRate: 0.3,
  seedTemperature: 0.9,
  seedBluffHintRate: 0.3,
  evolvedAt: null,
};

function lesson(id: string, text: string, personaSlug: string | null) {
  const at = new Date("2026-08-06T12:00:00Z");
  return { id, personaSlug, text, evidence: "e", createdAt: at, updatedAt: at };
}

function state(): GameState {
  const base = {
    seatIndex: 0,
    chips: 100,
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    cards: [],
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
    cardsRevealed: false,
  };
  return {
    phase: "preflop",
    communityCards: [],
    pot: 3,
    sidePots: [],
    players: [
      { ...base, userId: "ai1", username: "AI_XiaoZhi", cards: [] },
      { ...base, userId: "u2", username: "h2", seatIndex: 1 },
    ],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    smallBlind: 1,
    bigBlind: 2,
    currentBet: 0,
    minRaise: 2,
    handNumber: 1,
    actionLog: [],
  };
}

const withCheck: ActionOption[] = [{ type: "check" }, { type: "fold" }];

beforeEach(() => {
  vi.clearAllMocks();
  resetPersonasForTests();
  resetReflectionStoreForTests();
  vi.mocked(callLlm).mockResolvedValue({ action: "check" });
});

afterEach(() => {
  config.aiReflectionEnabled = true;
});

describe("buildSystemPrompt lesson section", () => {
  it("is byte-identical to the old prompt when no lessons are given", () => {
    expect(buildSystemPrompt(persona, undefined)).toBe(
      buildSystemPrompt(persona),
    );
    expect(buildSystemPrompt(persona, [])).toBe(buildSystemPrompt(persona));
    expect(buildSystemPrompt(null, ["ignored"])).toBe(buildSystemPrompt(null));
  });

  it("appends the lesson section after the persona section", () => {
    const prompt = buildSystemPrompt(persona, ["经验一", "经验二"]);
    const lessonIdx = prompt.indexOf("## 你的近期经验教训");
    expect(lessonIdx).toBeGreaterThan(prompt.indexOf("## 你的人格设定"));
    expect(prompt).toContain("- 经验一");
    expect(prompt).toContain("- 经验二");
    // Output contract stays intact.
    expect(prompt).toContain(
      '{"action":"fold|check|call|raise|allin","amount":0}',
    );
  });
});

describe("decideAiAction lesson injection", () => {
  it("injects persona-first merged lessons, capped at the injection max", async () => {
    bindUserPersona("ai1", persona);
    refreshLessonCache([
      lesson("p1", "人格经验A", "loose-aggressive"),
      lesson("p2", "人格经验B", "loose-aggressive"),
      lesson("p3", "人格经验C", "loose-aggressive"),
      lesson("g1", "全局经验1", null),
      lesson("g2", "全局经验2", null),
      lesson("g3", "全局经验3", null),
    ]);

    await decideAiAction(state(), "ai1", withCheck);

    const systemPrompt = vi.mocked(callLlm).mock.calls[0][0] as string;
    expect(systemPrompt).toContain("## 你的近期经验教训");
    // Persona lessons first, then global; total capped at 4.
    const section = systemPrompt.slice(
      systemPrompt.indexOf("## 你的近期经验教训"),
    );
    expect(section).toContain("人格经验A");
    expect(section).toContain("人格经验C");
    expect(section).toContain("全局经验1");
    // Cap of 4: three persona lessons take priority, leaving room for one
    // global lesson; the rest are cut.
    expect(section).not.toContain("全局经验2");
    expect(section).not.toContain("全局经验3");
    const bullets = section
      .split("\n")
      .filter((l) => l.startsWith("- ")).length;
    expect(bullets).toBe(LESSON_INJECTION_MAX);
  });

  it("omits the section entirely when the feature switch is off", async () => {
    bindUserPersona("ai1", persona);
    refreshLessonCache([lesson("g1", "全局经验1", null)]);
    config.aiReflectionEnabled = false;

    await decideAiAction(state(), "ai1", withCheck);

    const systemPrompt = vi.mocked(callLlm).mock.calls[0][0] as string;
    expect(systemPrompt).not.toContain("## 你的近期经验教训");
    expect(systemPrompt).toBe(buildSystemPrompt(persona));
  });

  it("injects nothing for unbound (persona-less) users", async () => {
    refreshLessonCache([lesson("g1", "全局经验1", null)]);
    await decideAiAction(state(), "ai1", withCheck);
    const systemPrompt = vi.mocked(callLlm).mock.calls[0][0] as string;
    expect(systemPrompt).not.toContain("## 你的近期经验教训");
  });
});
