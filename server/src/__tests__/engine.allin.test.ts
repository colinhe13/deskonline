import { describe, it, expect } from "vitest";
import { PokerEngine } from "../poker/engine.js";

function makeEngine(playerCount: number, dealerIndex = 0, chips: number | number[] = 1000) {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    userId: `u${i}`,
    username: `P${i}`,
    seatIndex: i,
    chips: typeof chips === "number" ? chips : chips[i],
  }));
  const broadcasts: { type: string; payload: unknown }[] = [];
  const engine = new PokerEngine(players, 1, 2, dealerIndex, (type, payload) => {
    broadcasts.push({ type, payload });
  });
  return { engine, broadcasts };
}

function currentUserId(engine: PokerEngine): string {
  const s = engine.getState();
  return s.players[s.currentPlayerIndex].userId;
}

function actionTypes(engine: PokerEngine, userId: string): string[] {
  return engine.getAvailableActionsForPlayer(userId).map((a) => a.type);
}

// Deterministic PRNG so the fuzz run is reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("PokerEngine all-in flow", () => {
  it("heads-up: an all-in does not skip the opponent's turn", () => {
    const { engine } = makeEngine(2, 0); // u0 dealer/SB, u1 BB
    engine.startHand();
    expect(engine.handleAction("u0", "allin", 999)).toBe(true);

    let s = engine.getState();
    expect(s.phase).toBe("preflop");
    expect(currentUserId(engine)).toBe("u1");
    // u1 has exactly 998 left and must call 998, so calling IS going all-in
    expect(actionTypes(engine, "u1")).toEqual(["fold", "allin"]);

    // Opponent all-in -> both all-in -> board runs out, hand settles
    expect(engine.handleAction("u1", "allin", 998)).toBe(true);
    s = engine.getState();
    expect(s.communityCards).toHaveLength(5);
    expect(s.phase).toBe("settled");
    const total = s.players.reduce((sum, p) => sum + p.chips, 0);
    expect(total).toBe(2000);
  });

  it("heads-up: all-in short stack vs full call produces a side pot", () => {
    const { engine } = makeEngine(2, 0, [100, 1000]); // u0 only 100 chips
    engine.startHand();
    // u0 (SB) all-in for 99 more
    expect(engine.handleAction("u0", "allin", 99)).toBe(true);
    // u1 has plenty of chips, so call/raise are available; calling covers the bet
    expect(actionTypes(engine, "u1")).toEqual(["fold", "call", "raise", "allin"]);
    expect(engine.handleAction("u1", "call")).toBe(true);
    const s = engine.getState();
    expect(s.phase).toBe("settled");
    const total = s.players.reduce((sum, p) => sum + p.chips, 0);
    expect(total).toBe(1100);
  });

  it("3 players: after an all-in the remaining players still act in order", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    expect(currentUserId(engine)).toBe("u0"); // dealer/UTG
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);

    let s = engine.getState();
    expect(s.phase).toBe("preflop");
    expect(currentUserId(engine)).toBe("u1");
    // u1 (SB) has 999 left, toCall 999 -> call equals all-in
    expect(actionTypes(engine, "u1")).toEqual(["fold", "allin"]);
    expect(engine.handleAction("u1", "allin", 999)).toBe(true);

    s = engine.getState();
    expect(s.phase).toBe("preflop");
    expect(currentUserId(engine)).toBe("u2"); // BB must still act
    expect(actionTypes(engine, "u2")).toEqual(["fold", "allin"]);
    expect(engine.handleAction("u2", "allin", 998)).toBe(true);

    s = engine.getState();
    expect(s.communityCards).toHaveLength(5);
    expect(s.phase).toBe("settled");
    const total = s.players.reduce((sum, p) => sum + p.chips, 0);
    expect(total).toBe(3000);
  });

  it("heads-up: short blind already all-in does not stall the hand", () => {
    const { engine } = makeEngine(2, 0, [1, 1000]); // SB has exactly 1 chip
    engine.startHand();
    let s = engine.getState();
    expect(s.players[0].allIn).toBe(true);
    expect(s.phase).toBe("preflop");
    // BB must still be able to act (check)
    expect(actionTypes(engine, "u1")).toContain("check");
    expect(engine.handleAction("u1", "check")).toBe(true);
    s = engine.getState();
    expect(s.phase).toBe("settled");
    const total = s.players.reduce((sum, p) => sum + p.chips, 0);
    expect(total).toBe(1001);
    // The 1-chip blind's main pot is contested; u1 either wins it or loses it
    expect([1001, 999]).toContain(s.players[1].chips);
  });

  it("fuzz: random play conserves chips, never stalls, and settles", () => {
    const rng = mulberry32(20260803);
    const { engine } = makeEngine(5, 0, 1000);
    engine.startHand();

    let guard = 0;
    while (engine.getState().phase !== "settled" && guard++ < 2000) {
      const s = engine.getState();
      const uid = currentUserId(engine);
      const actions = engine.getAvailableActionsForPlayer(uid);
      expect(actions.length).toBeGreaterThan(0); // never stall
      const pick = actions[Math.floor(rng() * actions.length)];
      const amount =
        pick.type === "raise" ? pick.min ?? pick.amount : pick.amount;
      expect(engine.handleAction(uid, pick.type, amount)).toBe(true);
    }
    expect(engine.getState().phase).toBe("settled");
    expect(guard).toBeLessThan(2000);

    let hands = 0;
    while (engine.nextHand() && hands++ < 50) {
      const s = engine.getState();
      expect(s.phase).toBe("preflop");
      let h = 0;
      while (s.phase !== "settled" && h++ < 2000) {
        const uid = currentUserId(engine);
        const actions = engine.getAvailableActionsForPlayer(uid);
        expect(actions.length).toBeGreaterThan(0);
        const pick = actions[Math.floor(rng() * actions.length)];
        const amount =
          pick.type === "raise" ? pick.min ?? pick.amount : pick.amount;
        expect(engine.handleAction(uid, pick.type, amount)).toBe(true);
      }
    }

    // Chips are only redistributed, never created or destroyed.
    const total = engine.getState().players.reduce((sum, p) => sum + p.chips, 0);
    expect(total).toBe(5000);
  });
});
