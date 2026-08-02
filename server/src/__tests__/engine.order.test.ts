import { describe, it, expect } from "vitest";
import { PokerEngine } from "../poker/engine.js";
import { GameState } from "../poker/types.js";

function makeEngine(playerCount: number, dealerIndex = 0) {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    userId: `u${i}`,
    username: `P${i}`,
    seatIndex: i,
    chips: 1000,
  }));
  const broadcasts: { type: string; payload: unknown }[] = [];
  const engine = new PokerEngine(players, 10, 20, dealerIndex, (type, payload) => {
    broadcasts.push({ type, payload });
  });
  return { engine, broadcasts };
}

function currentUserId(state: GameState): string {
  return state.players[state.currentPlayerIndex].userId;
}

function act(engine: PokerEngine, userId: string, action: string, amount?: number) {
  const ok = engine.handleAction(userId, action, amount);
  expect(ok).toBe(true);
}

describe("PokerEngine betting round order", () => {
  it("heads-up: dealer acts first preflop, non-dealer acts first postflop", () => {
    const { engine } = makeEngine(2, 0); // u0 is dealer
    engine.startHand();
    let s = engine.getState();

    // Preflop: dealer (u0, also SB) acts first
    expect(s.players[0].isDealer).toBe(true);
    expect(currentUserId(s)).toBe("u0");

    // Dealer calls the BB
    act(engine, "u0", "call");
    s = engine.getState();
    // BB (u1) must still get the option to act
    expect(s.phase).toBe("preflop");
    expect(currentUserId(s)).toBe("u1");

    // BB checks -> flop
    act(engine, "u1", "check");
    s = engine.getState();
    expect(s.phase).toBe("flop");
    // Postflop: non-dealer (u1) acts first
    expect(currentUserId(s)).toBe("u1");

    // u1 checks, u0 must still act (this is the regression: previously round ended early)
    act(engine, "u1", "check");
    s = engine.getState();
    expect(s.phase).toBe("flop");
    expect(currentUserId(s)).toBe("u0");

    // u0 checks -> turn
    act(engine, "u0", "check");
    s = engine.getState();
    expect(s.phase).toBe("turn");
    expect(currentUserId(s)).toBe("u1");
  });

  it("a check round requires every active player to act before advancing", () => {
    const { engine } = makeEngine(3, 0); // u0 dealer; SB=u1, BB=u2, UTG=u0
    engine.startHand();
    let s = engine.getState();

    // Preflop first to act is left of BB = u0 (dealer/UTG in 3-handed)
    expect(currentUserId(s)).toBe("u0");
    act(engine, "u0", "call");
    act(engine, "u1", "call");
    // BB u2 still gets option
    s = engine.getState();
    expect(s.phase).toBe("preflop");
    expect(currentUserId(s)).toBe("u2");
    act(engine, "u2", "check");

    // Flop: first to act is left of dealer = u1
    s = engine.getState();
    expect(s.phase).toBe("flop");
    expect(currentUserId(s)).toBe("u1");

    act(engine, "u1", "check");
    s = engine.getState();
    expect(s.phase).toBe("flop");
    expect(currentUserId(s)).toBe("u2");

    act(engine, "u2", "check");
    s = engine.getState();
    expect(s.phase).toBe("flop");
    expect(currentUserId(s)).toBe("u0");

    act(engine, "u0", "check");
    s = engine.getState();
    expect(s.phase).toBe("turn");
  });

  it("a raise reopens the round for players who already acted", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    let s = engine.getState();

    // u0 (UTG) raises
    expect(currentUserId(s)).toBe("u0");
    act(engine, "u0", "raise", 60);
    s = engine.getState();
    expect(s.currentBet).toBe(60);
    expect(currentUserId(s)).toBe("u1");

    // u1 calls, u2 calls
    act(engine, "u1", "call");
    act(engine, "u2", "call");
    s = engine.getState();
    // u0 already acted via the raise and no one re-raised, so round completes -> flop
    expect(s.phase).toBe("flop");
  });
});
