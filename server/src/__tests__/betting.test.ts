import { describe, it, expect } from "vitest";
import { calculateSidePots, isBettingRoundComplete } from "../poker/betting.js";
import { PlayerState } from "../poker/types.js";

function makePlayer(userId: string, totalBet: number, folded: boolean, allIn: boolean): PlayerState {
  return {
    userId,
    username: userId,
    seatIndex: 0,
    chips: 0,
    bet: 0,
    totalBet,
    folded,
    allIn,
    cards: [],
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
  };
}

describe("calculateSidePots", () => {
  it("single pot when no all-in", () => {
    const players = [
      makePlayer("a", 100, false, false),
      makePlayer("b", 100, false, false),
      makePlayer("c", 100, false, false),
    ];
    const pots = calculateSidePots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligible).toEqual(["a", "b", "c"]);
  });

  it("two players with unequal all-in", () => {
    const players = [
      makePlayer("a", 50, false, true),
      makePlayer("b", 100, false, false),
    ];
    const pots = calculateSidePots(players);
    expect(pots).toHaveLength(2);
    expect(pots[0].amount).toBe(100);
    expect(pots[0].eligible).toEqual(["a", "b"]);
    expect(pots[1].amount).toBe(50);
    expect(pots[1].eligible).toEqual(["b"]);
  });

  it("three players multi-level all-in", () => {
    const players = [
      makePlayer("a", 30, false, true),
      makePlayer("b", 60, false, true),
      makePlayer("c", 100, false, false),
    ];
    const pots = calculateSidePots(players);
    expect(pots).toHaveLength(3);
    expect(pots[0].amount).toBe(90);
    expect(pots[0].eligible).toEqual(["a", "b", "c"]);
    expect(pots[1].amount).toBe(60);
    expect(pots[1].eligible).toEqual(["b", "c"]);
    expect(pots[2].amount).toBe(40);
    expect(pots[2].eligible).toEqual(["c"]);
  });

  it("folded player contributes but not eligible", () => {
    const players = [
      makePlayer("a", 50, true, false),
      makePlayer("b", 50, false, true),
      makePlayer("c", 100, false, false),
    ];
    const pots = calculateSidePots(players);
    const mainPot = pots[0];
    expect(mainPot.eligible).not.toContain("a");
    expect(mainPot.eligible).toContain("b");
    expect(mainPot.eligible).toContain("c");
  });
});

describe("isBettingRoundComplete", () => {
  const active = (bet: number, hasActed = false, allIn = false, folded = false): PlayerState => ({
    ...makePlayer(`p${Math.random()}`, bet, folded, allIn),
    bet,
    hasActed,
  });

  it("round is NOT complete while exactly one actionable player remains", () => {
    const players = [
      { ...active(100, true), allIn: true },
      active(2, false), // BB has not acted yet
    ];
    expect(isBettingRoundComplete(players, 100)).toBe(false);
  });

  it("round is complete when nobody can act (all all-in)", () => {
    const players = [active(100, true, true), active(100, false, true)];
    expect(isBettingRoundComplete(players, 100)).toBe(true);
  });

  it("round is complete when every actionable player acted with matching bet", () => {
    const players = [active(50, true), active(50, true)];
    expect(isBettingRoundComplete(players, 50)).toBe(true);
  });

  it("folded and all-in players are excluded from the actionable set", () => {
    const players = [
      active(20, false, false, true), // folded
      active(50, true, true), // all-in
      active(50, true), // acted and matched
    ];
    expect(isBettingRoundComplete(players, 50)).toBe(true);
  });
});
