import { describe, it, expect } from "vitest";
import { PokerEngine } from "../poker/engine.js";
import { Card, Rank, Suit } from "../poker/types.js";
import { returnUncalledBets } from "../poker/betting.js";

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function makeEngine(chips: number[]) {
  const players = chips.map((c, i) => ({
    userId: `u${i}`,
    username: `P${i}`,
    seatIndex: i,
    chips: c,
  }));
  const broadcasts: { type: string; payload: unknown }[] = [];
  const engine = new PokerEngine(players, 10, 20, 0, (type, payload) => {
    broadcasts.push({ type, payload });
  });
  return { engine, broadcasts };
}

interface ResultPayload {
  winners: { userId: string; amount: number }[];
  refunds: { userId: string; amount: number }[];
  handNames: Record<string, string>;
  showdownCards: Record<string, Card[]>;
  reason: string;
}

function lastResult(
  broadcasts: { type: string; payload: unknown }[],
): ResultPayload {
  const results = broadcasts.filter((b) => b.type === "poker:hand_result");
  expect(results.length).toBe(1);
  return results[0].payload as ResultPayload;
}

function totalChips(engine: PokerEngine): number {
  return engine.getState().players.reduce((sum, p) => sum + p.chips, 0);
}

// Drives a heads-up overcall all-in: u0 shoves `u0Chips`, short stack u1
// calls all-in, then the hand settles. Hole cards and the runout are fixed so
// the winner is deterministic.
function playOvercallHand(
  u0Chips: number,
  u1Chips: number,
  winner: 0 | 1,
): { engine: PokerEngine; broadcasts: { type: string; payload: unknown }[] } {
  const { engine, broadcasts } = makeEngine([u0Chips, u1Chips]);
  engine.startHand();
  const s = engine.getState();
  const winningHole = [card("A", "hearts"), card("K", "hearts")];
  const losingHole = [card("2", "diamonds"), card("7", "clubs")];
  s.players[0].cards = winner === 0 ? winningHole : losingHole;
  s.players[1].cards = winner === 1 ? winningHole : losingHole;
  // Royal flush runout for the A♥K♥ holder; the other hand stays at pair-less.
  (engine as unknown as { deck: Card[] }).deck = [
    card("Q", "hearts"),
    card("J", "hearts"),
    card("10", "hearts"),
    card("3", "clubs"),
    card("8", "diamonds"),
  ];

  // Heads-up preflop: dealer u0 (SB) acts first.
  expect(engine.handleAction("u0", "allin", u0Chips)).toBe(true);
  // Short-stack calls surface as "allin" instead of "call".
  const respond = engine
    .getAvailableActionsForPlayer("u1")
    .find((a) => a.type === "call" || a.type === "allin");
  expect(respond).toBeDefined();
  expect(engine.handleAction("u1", respond!.type, respond!.amount)).toBe(true);
  expect(engine.getState().phase).toBe("settled");
  return { engine, broadcasts };
}

describe("settlement: uncalled overcall is refunded, not won", () => {
  it("overbettor who also wins: refund and win are reported separately", () => {
    const { engine, broadcasts } = playOvercallHand(1000, 400, 0);
    const result = lastResult(broadcasts);

    expect(result.reason).toBe("showdown");
    expect(result.winners).toEqual([{ userId: "u0", amount: 800 }]);
    expect(result.refunds).toEqual([{ userId: "u0", amount: 600 }]);
    // Both showdown participants get hand names so clients can compare.
    expect(result.handNames.u0).toBe("皇家同花顺");
    expect(typeof result.handNames.u1).toBe("string");
    expect(result.handNames.u1.length).toBeGreaterThan(0);

    const s = engine.getState();
    expect(s.players[0].chips).toBe(1400);
    expect(s.players[1].chips).toBe(0);
    expect(totalChips(engine)).toBe(1400);
  });

  it("short stack wins: overbettor refund is not listed as a winner", () => {
    const { engine, broadcasts } = playOvercallHand(1000, 400, 1);
    const result = lastResult(broadcasts);

    expect(result.winners).toEqual([{ userId: "u1", amount: 800 }]);
    expect(result.refunds).toEqual([{ userId: "u0", amount: 600 }]);
    expect(result.winners.some((w) => w.userId === "u0")).toBe(false);
    expect(result.handNames.u1).toBe("皇家同花顺");

    const s = engine.getState();
    expect(s.players[0].chips).toBe(600);
    expect(s.players[1].chips).toBe(800);
    expect(totalChips(engine)).toBe(1400);
  });

  it("split pot lists both winners and no refunds", () => {
    const { engine, broadcasts } = makeEngine([400, 400]);
    engine.startHand();
    const s = engine.getState();
    s.players[0].cards = [card("2", "diamonds"), card("3", "clubs")];
    s.players[1].cards = [card("4", "diamonds"), card("5", "clubs")];
    // Board plays for both: royal flush on the table.
    (engine as unknown as { deck: Card[] }).deck = [
      card("A", "spades"),
      card("K", "spades"),
      card("Q", "spades"),
      card("J", "spades"),
      card("10", "spades"),
    ];

    expect(engine.handleAction("u0", "allin", 400)).toBe(true);
    const respond = engine
      .getAvailableActionsForPlayer("u1")
      .find((a) => a.type === "call" || a.type === "allin");
    expect(engine.handleAction("u1", respond!.type, respond!.amount)).toBe(
      true,
    );

    const result = lastResult(broadcasts);
    expect(result.refunds).toEqual([]);
    expect(result.winners.map((w) => w.userId).sort()).toEqual(["u0", "u1"]);
    for (const w of result.winners) expect(w.amount).toBe(400);
    expect(totalChips(engine)).toBe(800);
  });
});

describe("settlement: chip conservation edge cases", () => {
  it("pot with no eligible live player is refunded to contributors", () => {
    const { engine, broadcasts } = makeEngine([1000, 1000, 1000, 1000]);
    engine.startHand();
    const s = engine.getState();
    // Two folded overbettors matched each other above every live stack.
    s.players[0].totalBet = 500;
    s.players[0].chips = 500;
    s.players[0].allIn = true;
    s.players[1].totalBet = 200;
    s.players[1].chips = 800;
    s.players[1].allIn = true;
    s.players[2].totalBet = 800;
    s.players[2].chips = 200;
    s.players[2].folded = true;
    s.players[3].totalBet = 800;
    s.players[3].chips = 200;
    s.players[3].folded = true;
    s.players[0].cards = [card("A", "hearts"), card("K", "hearts")];
    s.players[1].cards = [card("2", "diamonds"), card("7", "clubs")];
    // settleHands is invoked directly, so deal the board manually.
    s.communityCards = [
      card("Q", "hearts"),
      card("J", "hearts"),
      card("10", "hearts"),
      card("3", "clubs"),
      card("8", "diamonds"),
    ];
    const before = totalChips(engine);

    (engine as unknown as { settleHands: () => void }).settleHands();

    const result = lastResult(broadcasts);
    // u0 wins the two live pots; the dead 500-800 layer goes back to u2/u3.
    expect(result.winners).toEqual([{ userId: "u0", amount: 1700 }]);
    expect(result.refunds).toEqual([
      { userId: "u2", amount: 300 },
      { userId: "u3", amount: 300 },
    ]);
    const distributed =
      result.winners.reduce((sum, w) => sum + w.amount, 0) +
      result.refunds.reduce((sum, r) => sum + r.amount, 0);
    expect(distributed).toBe(2300);
    expect(totalChips(engine)).toBe(before + 2300);
  });
});

describe("returnUncalledBets", () => {
  function player(
    userId: string,
    totalBet: number,
    folded = false,
  ): {
    userId: string;
    username: string;
    seatIndex: number;
    chips: number;
    bet: number;
    totalBet: number;
    folded: boolean;
    allIn: boolean;
    hasActed: boolean;
    cards: Card[];
    isDealer: boolean;
    isSmallBlind: boolean;
    isBigBlind: boolean;
    cardsRevealed: boolean;
  } {
    return {
      userId,
      username: userId,
      seatIndex: 0,
      chips: 0,
      bet: totalBet,
      totalBet,
      folded,
      allIn: true,
      hasActed: true,
      cards: [],
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
      cardsRevealed: false,
    };
  }

  it("returns the unmatched excess and clamps totalBet", () => {
    const players = [player("a", 1000), player("b", 400)];
    const refunds = returnUncalledBets(players);
    expect(refunds).toEqual([{ userId: "a", amount: 600 }]);
    expect(players[0].totalBet).toBe(400);
    expect(players[0].chips).toBe(600);
  });

  it("also refunds a folded overbettor", () => {
    const players = [player("a", 500), player("b", 800, true)];
    const refunds = returnUncalledBets(players);
    expect(refunds).toEqual([{ userId: "b", amount: 300 }]);
    expect(players[1].totalBet).toBe(500);
  });

  it("does nothing when bets are matched", () => {
    const players = [player("a", 500), player("b", 500)];
    expect(returnUncalledBets(players)).toEqual([]);
    expect(players[0].totalBet).toBe(500);
    expect(players[1].totalBet).toBe(500);
  });
});
