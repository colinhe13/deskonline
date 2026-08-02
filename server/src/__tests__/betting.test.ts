import { describe, it, expect } from "vitest";
import { calculateSidePots } from "../poker/betting.js";
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
