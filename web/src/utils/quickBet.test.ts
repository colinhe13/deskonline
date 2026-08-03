import { describe, it, expect } from "vitest";
import { quickTarget, quickCommit, canQuickBet } from "./quickBet";
import type { QuickBetContext } from "./quickBet";

function ctx(partial: Partial<QuickBetContext> = {}): QuickBetContext {
  return {
    pot: 100,
    bigBlind: 2,
    chips: 100,
    playerBet: 0,
    currentBet: 2,
    minRaise: 2,
    ...partial,
  };
}

describe("quickTarget", () => {
  it("rounds down to a big blind multiple", () => {
    expect(quickTarget(100, 2, 1 / 3)).toBe(32); // 33.33 -> 32
    expect(quickTarget(100, 2, 1 / 2)).toBe(50);
  });

  it("returns 0 when big blind is missing or invalid", () => {
    expect(quickTarget(100, 0, 1 / 3)).toBe(0);
    expect(quickTarget(100, -2, 1 / 3)).toBe(0);
  });
});

describe("quickCommit", () => {
  it("commits target minus the player's existing bet", () => {
    // BB has already bet 2; 1/3 pot target is 32 -> commit 30
    expect(quickCommit(ctx({ playerBet: 2 }), 1 / 3)).toBe(30);
  });

  it("never returns a negative commit", () => {
    expect(quickCommit(ctx({ playerBet: 999 }), 1 / 3)).toBe(0);
  });
});

describe("canQuickBet", () => {
  it("offers 1/3 when the target is a legal raise and affordable", () => {
    expect(canQuickBet(ctx(), 1 / 3)).toBe(true);
  });

  it("hides when the player's chips are below the commit amount", () => {
    // pot 300 -> 1/2 target 150, chips 100 cannot afford it
    expect(canQuickBet(ctx({ pot: 300, chips: 100 }), 1 / 2)).toBe(false);
    expect(canQuickBet(ctx({ pot: 300, chips: 150 }), 1 / 2)).toBe(true);
  });

  it("hides when the target is below the minimum legal raise", () => {
    // target 32 < currentBet 40 + minRaise 2
    expect(canQuickBet(ctx({ currentBet: 40 }), 1 / 3)).toBe(false);
  });

  it("hides when the commit would be zero", () => {
    expect(canQuickBet(ctx({ playerBet: 32 }), 1 / 3)).toBe(false);
  });
});
