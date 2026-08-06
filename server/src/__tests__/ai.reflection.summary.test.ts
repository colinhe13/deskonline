import { describe, it, expect } from "vitest";

import { buildSummaryDraft, boardTextureOf } from "../ai/reflection/summary.js";
import { PokerEngine } from "../poker/engine.js";
import type { Card, GameState, StructuredAction } from "../poker/types.js";
import type { HandResult } from "../poker/engine.js";
import type { HandRecord } from "../ai/profiling/types.js";
import type { HandSelfEvaluation } from "../ai/selfreview/evaluate.js";

const card = (rank: string, suit: string): Card => ({ rank, suit }) as Card;

function baseState(community: Card[] = []): GameState {
  const base = {
    seatIndex: 0,
    chips: 100,
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    cards: [],
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
    cardsRevealed: false,
  };
  return {
    phase: "settled",
    communityCards: community,
    pot: 10,
    sidePots: [],
    players: [
      { ...base, userId: "ai1", username: "AI_A", seatIndex: 0, totalBet: 12 },
      { ...base, userId: "h2", username: "h2", seatIndex: 1, totalBet: 8 },
      { ...base, userId: "h3", username: "h3", seatIndex: 2, totalBet: 0 },
    ],
    currentPlayerIndex: 0,
    dealerIndex: 2,
    smallBlind: 1,
    bigBlind: 2,
    currentBet: 0,
    minRaise: 2,
    handNumber: 1,
    actionLog: [],
  };
}

function record(
  actions: StructuredAction[],
  winners: { userId: string; amount: number }[],
  showdownParticipantIds: string[] = [],
): HandRecord {
  return {
    actions,
    winners,
    showdownParticipantIds,
    revealedHandNames: {},
    handNumber: 1,
  };
}

const emptyResult: HandResult = {
  winners: [],
  refunds: [],
  showdownCards: {},
  handNames: {},
  reason: "fold",
};

const noEval: HandSelfEvaluation = { userId: "ai1", handNumber: 1 };

describe("boardTextureOf", () => {
  it("labels monotone boards", () => {
    expect(
      boardTextureOf([
        card("2", "hearts"),
        card("7", "hearts"),
        card("K", "hearts"),
        card("4", "hearts"),
        card("9", "hearts"),
      ]),
    ).toBe("单色面");
  });

  it("labels dry high boards", () => {
    expect(
      boardTextureOf([
        card("K", "hearts"),
        card("7", "diamonds"),
        card("2", "clubs"),
      ]),
    ).toBe("干高牌面");
  });

  it("labels connected wet boards with descriptors", () => {
    const texture = boardTextureOf([
      card("J", "hearts"),
      card("T", "diamonds"),
      card("9", "clubs"),
    ]);
    expect(texture).toContain("湿");
    expect(texture).toContain("连张");
  });

  it("labels paired boards", () => {
    const texture = boardTextureOf([
      card("5", "hearts"),
      card("5", "diamonds"),
      card("K", "clubs"),
    ]);
    expect(texture).toContain("有对");
  });

  it("handles missing boards", () => {
    expect(boardTextureOf([])).toBe("无公共牌");
  });
});

describe("buildSummaryDraft", () => {
  it("captures position, street, counts, net and flags for a bluff line", () => {
    const state = baseState([
      card("K", "hearts"),
      card("7", "diamonds"),
      card("2", "clubs"),
    ]);
    // returnUncalledBets has already decremented totalBet by the 3-chip
    // uncalled excess before the settlement broadcast, so the draft must not
    // add the refund again.
    state.players[0].totalBet = 9;
    // ai1 (dealerIndex 2 -> ai1 at index 0 is SB in 3-handed) opens preflop,
    // faces a 3-bet from h2, then c-bets the flop unopposed.
    const actions: StructuredAction[] = [
      { street: "preflop", userId: "ai1", action: "raise", amount: 5 },
      { street: "preflop", userId: "h2", action: "raise", amount: 15 },
      { street: "preflop", userId: "ai1", action: "call", amount: 10 },
      { street: "flop", userId: "ai1", action: "raise", amount: 10 },
      { street: "flop", userId: "h2", action: "fold", amount: 0 },
    ];
    const rec = record(actions, [{ userId: "ai1", amount: 40 }]);
    const result: HandResult = {
      ...emptyResult,
      winners: [{ userId: "ai1", amount: 40 }],
      refunds: [{ userId: "ai1", amount: 3 }],
    };
    const evaluation: HandSelfEvaluation = {
      userId: "ai1",
      handNumber: 1,
      bluff: "success",
      cbet: "success",
    };

    const draft = buildSummaryDraft(state, rec, result, "ai1", evaluation);
    expect(draft).not.toBeNull();
    expect(draft!.position).toBe("SB");
    expect(draft!.streetReached).toBe("flop");
    // Preflop raise unopposed = bet; facing h2's 3-bet does not add self
    // aggression; flop c-bet unopposed = bet.
    expect(draft!.myBets).toBe(2);
    expect(draft!.myRaises).toBe(0);
    expect(draft!.facedBets).toBe(1);
    expect(draft!.bluffed).toBe("success");
    expect(draft!.cbet).toBe("success");
    // 40 won − 9 invested (totalBet already refund-adjusted).
    expect(draft!.netWon).toBe(31);
    expect(draft!.wonAtShowdown).toBe(false);
    expect(draft!.foldedToBet).toBe(false);
  });

  it("counts re-raises as raises and flags fold-to-bet losses", () => {
    const state = baseState();
    const actions: StructuredAction[] = [
      { street: "preflop", userId: "h2", action: "raise", amount: 5 },
      { street: "preflop", userId: "ai1", action: "raise", amount: 15 },
      { street: "preflop", userId: "h2", action: "allin", amount: 100 },
      { street: "preflop", userId: "ai1", action: "fold", amount: 0 },
    ];
    const rec = record(actions, [{ userId: "h2", amount: 30 }]);
    const draft = buildSummaryDraft(state, rec, emptyResult, "ai1", noEval);
    expect(draft!.streetReached).toBe("preflop");
    expect(draft!.myBets).toBe(0);
    expect(draft!.myRaises).toBe(1);
    expect(draft!.facedBets).toBe(1);
    expect(draft!.netWon).toBe(-12);
    expect(draft!.foldedToBet).toBe(true);
  });

  it("marks showdown wins and showdown street", () => {
    const state = baseState([
      card("A", "hearts"),
      card("K", "diamonds"),
      card("Q", "clubs"),
      card("J", "spades"),
      card("2", "hearts"),
    ]);
    const rec = record(
      [{ street: "preflop", userId: "ai1", action: "call", amount: 2 }],
      [{ userId: "ai1", amount: 20 }],
      ["ai1", "h2"],
    );
    const result: HandResult = {
      ...emptyResult,
      winners: [{ userId: "ai1", amount: 20 }],
      reason: "showdown",
    };
    const draft = buildSummaryDraft(state, rec, result, "ai1", noEval);
    expect(draft!.streetReached).toBe("showdown");
    expect(draft!.wonAtShowdown).toBe(true);
    expect(draft!.netWon).toBe(8);
  });

  it("returns null for users not in the state", () => {
    const state = baseState();
    expect(
      buildSummaryDraft(state, record([], []), emptyResult, "ghost", noEval),
    ).toBeNull();
  });
});

describe("netWon reconciliation against real engine settlement", () => {
  it("equals the chip delta when an uncalled excess is refunded", () => {
    // u0 shoves 1000 into u1's 100; u1 wins at showdown and u0 gets the 900
    // uncalled excess back. returnUncalledBets mutates totalBet before the
    // settlement broadcast, so netWon must come out as the pure chip delta.
    const players = [
      { userId: "u0", username: "P0", seatIndex: 0, chips: 1000 },
      { userId: "u1", username: "P1", seatIndex: 1, chips: 100 },
    ];
    const broadcasts: { type: string; payload: unknown }[] = [];
    const engine = new PokerEngine(players, 10, 20, 0, (type, payload) => {
      broadcasts.push({ type, payload });
    });
    engine.startHand();
    const s = engine.getState();
    s.players[0].cards = [card("2", "diamonds"), card("7", "clubs")];
    s.players[1].cards = [card("A", "hearts"), card("K", "hearts")];
    (engine as unknown as { deck: Card[] }).deck = [
      card("Q", "hearts"),
      card("J", "hearts"),
      card("10", "hearts"),
      card("3", "clubs"),
      card("8", "diamonds"),
    ];

    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    const respond = engine
      .getAvailableActionsForPlayer("u1")
      .find((a) => a.type === "call" || a.type === "allin");
    expect(respond).toBeDefined();
    expect(engine.handleAction("u1", respond!.type, respond!.amount)).toBe(
      true,
    );
    expect(engine.getState().phase).toBe("settled");

    const state = engine.getState();
    const result = broadcasts.find((b) => b.type === "poker:hand_result")!
      .payload as HandResult;
    expect(result.refunds).toEqual([{ userId: "u0", amount: 900 }]);

    const rec = record(
      [],
      result.winners,
      state.players.map((p) => p.userId),
    );
    const before: Record<string, number> = { u0: 1000, u1: 100 };
    for (const userId of ["u0", "u1"]) {
      const draft = buildSummaryDraft(state, rec, result, userId, {
        userId,
        handNumber: state.handNumber,
      });
      const me = state.players.find((p) => p.userId === userId)!;
      expect(draft!.netWon).toBe(me.chips - before[userId]);
    }
    // The loser's refund must not read as profit: u0 lost exactly 100.
    const loser = buildSummaryDraft(state, rec, result, "u0", {
      userId: "u0",
      handNumber: state.handNumber,
    });
    expect(loser!.netWon).toBe(-100);
  });
});
