import { describe, it, expect, vi } from "vitest";
import { PokerEngine } from "../poker/engine.js";

function makeEngine() {
  const players = [
    { userId: "u1", username: "alice", seatIndex: 0, chips: 200 },
    { userId: "u2", username: "bob", seatIndex: 1, chips: 200 },
    { userId: "u3", username: "carol", seatIndex: 2, chips: 200 },
  ];
  const onBroadcast = vi.fn();
  const engine = new PokerEngine(players, 1, 2, 0, onBroadcast);
  return { engine, onBroadcast };
}

describe("PokerEngine.getHandHistory", () => {
  it("records blinds as preflop blind actions", () => {
    const { engine } = makeEngine();
    engine.startHand();
    const history = engine.getHandHistory();
    expect(history).toEqual([
      { street: "preflop", userId: "u2", action: "blind", amount: 1 },
      { street: "preflop", userId: "u3", action: "blind", amount: 2 },
    ]);
  });

  it("records actions with the street they happened on", () => {
    const { engine } = makeEngine();
    engine.startHand();
    engine.handleAction("u1", "call"); // preflop call 2
    engine.handleAction("u2", "call");
    engine.handleAction("u3", "check");
    // flop: everyone checks
    engine.handleAction("u2", "check");
    engine.handleAction("u3", "check");
    engine.handleAction("u1", "check");

    const history = engine.getHandHistory();
    const alice = history.filter((a) => a.userId === "u1");
    expect(alice[0]).toEqual({
      street: "preflop",
      userId: "u1",
      action: "call",
      amount: 2,
    });
    expect(alice[1]).toEqual({
      street: "flop",
      userId: "u1",
      action: "check",
      amount: 0,
    });
  });

  it("records raises with the chips added this round", () => {
    const { engine } = makeEngine();
    engine.startHand();
    engine.handleAction("u1", "raise", 4);
    const history = engine.getHandHistory();
    expect(history).toContainEqual({
      street: "preflop",
      userId: "u1",
      action: "raise",
      amount: 4,
    });
  });

  it("records a fold", () => {
    const { engine } = makeEngine();
    engine.startHand();
    engine.handleAction("u1", "fold");
    expect(engine.getHandHistory()).toContainEqual({
      street: "preflop",
      userId: "u1",
      action: "fold",
      amount: 0,
    });
  });

  it("records server-side forced folds (foldPlayer)", () => {
    const { engine } = makeEngine();
    engine.startHand();
    expect(engine.foldPlayer("u1")).toBe(true);
    expect(engine.getHandHistory()).toContainEqual({
      street: "preflop",
      userId: "u1",
      action: "fold",
      amount: 0,
    });
  });

  it("resets on the next hand to only the blind posts", () => {
    const { engine } = makeEngine();
    engine.startHand();
    engine.handleAction("u1", "call");
    expect(engine.getHandHistory().length).toBeGreaterThan(2);

    engine.startHand();
    const history = engine.getHandHistory();
    expect(history).toHaveLength(2);
    expect(history.every((a) => a.action === "blind")).toBe(true);
  });

  it("returns a copy, not the internal array", () => {
    const { engine } = makeEngine();
    engine.startHand();
    const snapshot = engine.getHandHistory();
    snapshot.push({ street: "river", userId: "x", action: "fold", amount: 0 });
    expect(engine.getHandHistory()).toHaveLength(2);
  });

  it("contains no private information: no hole cards or card fields", () => {
    const { engine } = makeEngine();
    engine.startHand();
    engine.handleAction("u1", "call");
    engine.handleAction("u2", "call");
    engine.handleAction("u3", "check");
    const serialized = JSON.stringify(engine.getHandHistory());
    expect(serialized).not.toMatch(/[2-9TJQKA][hdcs]\b/);
    expect(serialized).not.toContain("cards");
  });

  function shortStackEngine(chips: number) {
    const players = [
      { userId: "u1", username: "alice", seatIndex: 0, chips },
      { userId: "u2", username: "bob", seatIndex: 1, chips: 200 },
      { userId: "u3", username: "carol", seatIndex: 2, chips: 200 },
    ];
    return new PokerEngine(players, 1, 2, 0, vi.fn());
  }

  it("records a shove that only matches the current bet as an effective call", () => {
    const engine = shortStackEngine(2);
    engine.startHand();
    expect(engine.handleAction("u1", "allin", 2)).toBe(true);
    expect(engine.getHandHistory()).toContainEqual({
      street: "preflop",
      userId: "u1",
      action: "call",
      amount: 2,
    });
  });

  it("records a shove above the current bet as allin", () => {
    const engine = shortStackEngine(10);
    engine.startHand();
    expect(engine.handleAction("u1", "allin", 10)).toBe(true);
    expect(engine.getHandHistory()).toContainEqual({
      street: "preflop",
      userId: "u1",
      action: "allin",
      amount: 10,
    });
  });
});
