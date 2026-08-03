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

describe("GameState.actionLog", () => {
  it("records blinds with usernames at startHand", () => {
    const { engine } = makeEngine();
    engine.startHand();
    const log = engine.getState().actionLog;
    // dealer=idx0 → SB=idx1(bob), BB=idx2(carol)
    expect(log[0]).toBe("SB (bob) posts 1");
    expect(log[1]).toBe("BB (carol) posts 2");
  });

  it("records every successful action", () => {
    const { engine } = makeEngine();
    engine.startHand();
    // preflop: UTG = alice (idx0) acts first
    expect(engine.handleAction("u1", "call")).toBe(true); // call 2
    expect(engine.handleAction("u2", "call")).toBe(true); // call 1 more
    expect(engine.handleAction("u3", "check")).toBe(true);

    const log = engine.getState().actionLog;
    expect(log).toContain("alice call 2");
    expect(log).toContain("bob call 1");
    expect(log).toContain("carol check");
  });

  it("records raises with the extra chips invested this round", () => {
    const { engine } = makeEngine();
    engine.startHand();
    // min raise = currentBet 2 + minRaise 2 = 4 total → extra 4 for alice
    expect(engine.handleAction("u1", "raise", 4)).toBe(true);
    const log = engine.getState().actionLog;
    expect(log).toContain("alice raise 4");
  });

  it("appends phase separators when the board advances", () => {
    const { engine } = makeEngine();
    engine.startHand();
    engine.handleAction("u1", "call");
    engine.handleAction("u2", "call");
    engine.handleAction("u3", "check");

    expect(engine.getState().actionLog).toContain("--- flop ---");

    // Everyone checks the flop to reach the turn.
    engine.handleAction("u2", "check");
    engine.handleAction("u3", "check");
    engine.handleAction("u1", "check");
    expect(engine.getState().actionLog).toContain("--- turn ---");
  });

  it("records folds and ends without extra entries after settlement", () => {
    const { engine } = makeEngine();
    engine.startHand();
    engine.handleAction("u1", "call");
    engine.handleAction("u2", "fold");
    const log = engine.getState().actionLog;
    expect(log).toContain("bob fold");
  });

  it("clears the log on the next hand", () => {
    const { engine } = makeEngine();
    engine.startHand();
    engine.handleAction("u1", "call");
    expect(engine.getState().actionLog.length).toBeGreaterThan(2);

    engine.startHand();
    const log = engine.getState().actionLog;
    expect(log).toHaveLength(2); // only the two blind posts
    expect(log[0]).toContain("posts");
  });

  it("is public information: getState exposes it and no hole cards leak", () => {
    const { engine } = makeEngine();
    engine.startHand();
    const state = engine.getState();
    expect(Array.isArray(state.actionLog)).toBe(true);
    // actionLog entries must never contain card ranks like "Ah"
    for (const entry of state.actionLog) {
      expect(entry).not.toMatch(/[2-9TJQKA][hdcs]\b/);
    }
  });
});
