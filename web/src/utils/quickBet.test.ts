import { describe, it, expect } from "vitest";
import {
  quickTarget,
  quickCommit,
  canQuickBet,
  targetCommit,
  bbTarget,
  canTargetBet,
  parseIntegerAmount,
} from "./quickBet";
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
    expect(quickTarget(100, 2, 2 / 3)).toBe(66);
    expect(quickTarget(100, 2, 1)).toBe(100);
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

describe("preflop target helpers", () => {
  it("calculates BB targets and subtracts the current-round wager", () => {
    expect(bbTarget(2, 2.5)).toBe(5);
    expect(bbTarget(3, 2.5)).toBe(7);
    expect(targetCommit(ctx({ playerBet: 2 }), 6)).toBe(4);
  });

  it("only exposes a BB target when it is a legal affordable raise", () => {
    expect(canTargetBet(ctx(), 4)).toBe(true);
    expect(canTargetBet(ctx({ currentBet: 4 }), 4)).toBe(false);
    expect(canTargetBet(ctx({ chips: 3 }), 4)).toBe(false);
  });

  it("rejects invalid BB target inputs", () => {
    expect(bbTarget(0, 2.5)).toBe(0);
    expect(bbTarget(2, 0)).toBe(0);
    expect(canTargetBet(ctx(), 4.5)).toBe(false);
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

describe("parseIntegerAmount", () => {
  it("accepts integers and rejects incomplete or unsafe values", () => {
    expect(parseIntegerAmount("42")).toBe(42);
    expect(parseIntegerAmount(" 42 ")).toBe(42);
    expect(parseIntegerAmount("")).toBeNull();
    expect(parseIntegerAmount("12.5")).toBeNull();
    expect(parseIntegerAmount("not-a-number")).toBeNull();
    expect(parseIntegerAmount("Infinity")).toBeNull();
    expect(parseIntegerAmount("9007199254740992")).toBeNull();
  });
});
