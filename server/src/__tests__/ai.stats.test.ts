import { describe, it, expect, beforeEach } from "vitest";
import { recordAiDecision, getAiStats, resetAiStats } from "../ai/stats.js";

describe("ai stats", () => {
  beforeEach(() => {
    resetAiStats();
  });

  it("counts LLM decisions and final actions", () => {
    recordAiDecision({
      username: "AI_XiaoZhi",
      phase: "preflop",
      handNo: 1,
      toCall: 0,
      source: "llm",
      llmRaw: '{"action":"raise","amount":5}',
      finalAction: "raise",
    });
    const s = getAiStats();
    expect(s.decisions).toBe(1);
    expect(s.bySource.llm).toBe(1);
    expect(s.llmFinalActions.raise).toBe(1);
    expect(s.finalActions.raise).toBe(1);
    expect(s.facingBet).toBe(0);
  });

  it("tracks facing-bet folds by source", () => {
    recordAiDecision({
      username: "AI_XiaoZhi",
      phase: "flop",
      handNo: 2,
      toCall: 20,
      source: "fallback",
      failReason: "no_response",
      finalAction: "fold",
    });
    recordAiDecision({
      username: "AI_XiaoZhi",
      phase: "flop",
      handNo: 3,
      toCall: 20,
      source: "llm",
      finalAction: "fold",
    });
    recordAiDecision({
      username: "AI_XiaoZhi",
      phase: "flop",
      handNo: 4,
      toCall: 20,
      source: "llm",
      finalAction: "call",
    });
    const s = getAiStats();
    expect(s.facingBet).toBe(3);
    expect(s.facingBetFolded).toBe(2);
    expect(s.facingBetFoldedByLlm).toBe(1);
    expect(s.facingBetFoldedByFallback).toBe(1);
    expect(s.byFailReason.no_response).toBe(1);
  });

  it("resets all counters", () => {
    recordAiDecision({
      username: "AI_XiaoZhi",
      phase: "preflop",
      handNo: 1,
      toCall: 2,
      source: "watchdog",
      failReason: "no_response",
      finalAction: "fold",
    });
    resetAiStats();
    const s = getAiStats();
    expect(s.decisions).toBe(0);
    expect(s.bySource.watchdog).toBe(0);
    expect(s.finalActions).toEqual({});
  });
});
