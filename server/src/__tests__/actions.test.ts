import { describe, it, expect } from "vitest";
import { PokerEngine } from "../poker/engine.js";

function makeEngine(
  playerCount: number,
  dealerIndex = 0,
  chips: number | number[] = 1000,
) {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    userId: `u${i}`,
    username: `P${i}`,
    seatIndex: i,
    chips: typeof chips === "number" ? chips : (chips[i] ?? 1000),
  }));
  const broadcasts: { type: string; payload: unknown }[] = [];
  const engine = new PokerEngine(
    players,
    1,
    2,
    dealerIndex,
    (type, payload) => {
      broadcasts.push({ type, payload });
    },
  );
  return { engine, broadcasts };
}

describe("getAvailableActions", () => {
  it("toCall > 0 and chips > toCall: fold/call/raise/allin in order", () => {
    const { engine } = makeEngine(3, 0, 1000);
    engine.startHand();
    expect(engine.getState().pot).toBe(3);
    // Preflop UTG = u0 (dealer in 3-handed), toCall = big blind 2
    const actions = engine.getAvailableActionsForPlayer("u0");
    expect(actions.map((a) => a.type)).toEqual([
      "fold",
      "call",
      "raise",
      "allin",
    ]);
    expect(actions.find((a) => a.type === "call")!.amount).toBe(2);
    const raise = actions.find((a) => a.type === "raise")!;
    expect(raise.min).toBe(4);
    expect(raise.max).toBe(1000);
    expect(actions.find((a) => a.type === "allin")!.amount).toBe(1000);
  });

  it("toCall > 0 and chips <= toCall: only fold/allin, allin equals chips", () => {
    const { engine } = makeEngine(3, 0, [1, 1000, 1000]);
    engine.startHand();
    const actions = engine.getAvailableActionsForPlayer("u0");
    expect(actions.map((a) => a.type)).toEqual(["fold", "allin"]);
    expect(actions.find((a) => a.type === "allin")!.amount).toBe(1);
  });

  it("toCall == 0: check/fold/raise/allin, allin equals chips", () => {
    const { engine } = makeEngine(2, 0, 1000);
    engine.startHand();
    // Heads-up: dealer u0 is also SB, calls the big blind
    expect(engine.handleAction("u0", "call")).toBe(true);
    const actions = engine.getAvailableActionsForPlayer("u1");
    expect(actions.map((a) => a.type)).toEqual([
      "check",
      "fold",
      "raise",
      "allin",
    ]);
    expect(actions.find((a) => a.type === "allin")!.amount).toBe(998);
    const raise = actions.find((a) => a.type === "raise")!;
    expect(raise.min).toBe(2);
    expect(raise.max).toBe(998);
  });

  it("fold is valid even when a check is available", () => {
    const { engine } = makeEngine(2, 0, 1000);
    engine.startHand();
    expect(engine.handleAction("u0", "call")).toBe(true);
    expect(engine.handleAction("u1", "fold")).toBe(true);
  });

  it("isValidAction rejects raise below min and out-of-turn allin", () => {
    const { engine } = makeEngine(3, 0, 1000);
    engine.startHand();
    expect(engine.handleAction("u0", "raise", 3)).toBe(false); // below min raise 4
    expect(engine.handleAction("u1", "allin", 1000)).toBe(false); // not u1's turn
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
  });

  it("rejects malformed raise amounts without changing the hand", () => {
    const { engine } = makeEngine(3, 0, 1000);
    engine.startHand();
    const before = structuredClone(engine.getState());

    expect(engine.handleAction("u0", "raise", 4.5)).toBe(false);
    expect(engine.handleAction("u0", "raise", Number.NaN)).toBe(false);
    expect(engine.handleAction("u0", "raise", Number.POSITIVE_INFINITY)).toBe(
      false,
    );
    expect(engine.handleAction("u0", "raise", -4)).toBe(false);
    expect(engine.handleAction("u0", "raise", "4" as unknown as number)).toBe(
      false,
    );
    expect(engine.getState()).toEqual(before);
  });

  it("rejects zero all-in amounts while accepting the real stack amount", () => {
    const { engine } = makeEngine(3, 0, 1000);
    engine.startHand();

    expect(engine.handleAction("u0", "allin", 0)).toBe(false);
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
  });
});
