import { describe, it, expect } from "vitest";
import { evaluateHandForUser } from "../ai/selfreview/evaluate.js";
import { SelfReviewStore } from "../ai/selfreview/store.js";
import { effectiveBluffHintRate, bluffHintBreakdown } from "../ai/decision.js";
import { buildDecisionContext } from "../ai/prompt.js";
import { config } from "../config.js";
import type { HandRecord, ProfileView } from "../ai/profiling/types.js";
import type { SelfReviewView } from "../ai/selfreview/store.js";
import type { AiPersonaView } from "../ai/personas.js";
import type { Card, GameState, PlayerState } from "../poker/types.js";

function card(rank: string, suit: Card["suit"]): Card {
  return { rank: rank as Card["rank"], suit };
}

// Board plays for everyone unless a hole card pairs/completes something.
const HIGH_BOARD: Card[] = [
  card("A", "spades"),
  card("K", "hearts"),
  card("Q", "diamonds"),
  card("J", "clubs"),
  card("9", "spades"),
];

function record(overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    actions: [],
    winners: [],
    showdownParticipantIds: [],
    revealedHandNames: {},
    handNumber: 1,
    ...overrides,
  };
}

const HERO = "AI_XiaoZhi";
const OPP = "h1";

describe("evaluateHandForUser bluff classification", () => {
  const weakHole = [card("7", "diamonds"), card("2", "clubs")];

  it("marks a winning no-showdown weak hand with postflop aggression as bluff success", () => {
    const rec = record({
      actions: [
        { street: "flop", userId: HERO, action: "raise", amount: 20 },
        { street: "flop", userId: OPP, action: "call", amount: 20 },
        { street: "turn", userId: HERO, action: "raise", amount: 50 },
        { street: "turn", userId: OPP, action: "fold", amount: 0 },
      ],
      winners: [{ userId: HERO, amount: 90 }],
    });
    const out = evaluateHandForUser(rec, HERO, weakHole, HIGH_BOARD);
    expect(out.bluff).toBe("success");
    expect(out.handNumber).toBe(1);
  });

  it("marks a showdown loss with a revealed weak hand as bluff caught", () => {
    const rec = record({
      actions: [
        { street: "flop", userId: HERO, action: "raise", amount: 20 },
        { street: "river", userId: HERO, action: "allin", amount: 100 },
        { street: "river", userId: OPP, action: "call", amount: 100 },
      ],
      winners: [{ userId: OPP, amount: 250 }],
      showdownParticipantIds: [HERO, OPP],
    });
    const out = evaluateHandForUser(rec, HERO, weakHole, HIGH_BOARD);
    expect(out.bluff).toBe("caught");
  });

  it("does not count value hands (two pair or better) as bluffs", () => {
    // Hero holds pocket aces on an ace-high board: three of a kind.
    const valueHole = [card("A", "hearts"), card("A", "diamonds")];
    const board = [
      card("A", "clubs"),
      card("7", "diamonds"),
      card("2", "clubs"),
      card("K", "spades"),
      card("9", "spades"),
    ];
    const wonWithoutShowdown = record({
      actions: [
        { street: "flop", userId: HERO, action: "raise", amount: 30 },
        { street: "turn", userId: OPP, action: "fold", amount: 0 },
      ],
      winners: [{ userId: HERO, amount: 80 }],
    });
    expect(
      evaluateHandForUser(wonWithoutShowdown, HERO, valueHole, board).bluff,
    ).toBeUndefined();

    const lostAtShowdown = record({
      actions: [{ street: "river", userId: HERO, action: "allin", amount: 90 }],
      winners: [{ userId: OPP, amount: 200 }],
      showdownParticipantIds: [HERO, OPP],
    });
    expect(
      evaluateHandForUser(lostAtShowdown, HERO, valueHole, board).bluff,
    ).toBeUndefined();
  });

  it("counts one pair as weak enough to bluff with", () => {
    const pairHole = [card("8", "diamonds"), card("7", "clubs")];
    const board = [
      card("A", "hearts"),
      card("8", "spades"),
      card("K", "diamonds"),
      card("2", "clubs"),
      card("9", "spades"),
    ];
    const rec = record({
      actions: [{ street: "turn", userId: HERO, action: "raise", amount: 40 }],
      winners: [{ userId: HERO, amount: 70 }],
    });
    expect(evaluateHandForUser(rec, HERO, pairHole, board).bluff).toBe(
      "success",
    );
  });

  it("excludes weak hands that never attacked and hands folded mid-way", () => {
    const passive = record({
      actions: [{ street: "flop", userId: OPP, action: "raise", amount: 15 }],
      winners: [{ userId: OPP, amount: 40 }],
    });
    expect(evaluateHandForUser(passive, HERO, weakHole, HIGH_BOARD).bluff).toBe(
      undefined,
    );

    const foldedAfterAttacking = record({
      actions: [
        { street: "flop", userId: HERO, action: "raise", amount: 20 },
        { street: "turn", userId: OPP, action: "raise", amount: 60 },
        { street: "turn", userId: HERO, action: "fold", amount: 0 },
      ],
      winners: [{ userId: OPP, amount: 100 }],
    });
    expect(
      evaluateHandForUser(foldedAfterAttacking, HERO, weakHole, HIGH_BOARD)
        .bluff,
    ).toBeUndefined();
  });

  it("does not classify preflop-only aggression as a bluff attempt", () => {
    const rec = record({
      actions: [
        { street: "preflop", userId: HERO, action: "raise", amount: 6 },
      ],
      winners: [{ userId: HERO, amount: 12 }],
    });
    // No community cards at all: a hand that ended preflop.
    expect(evaluateHandForUser(rec, HERO, weakHole, []).bluff).toBeUndefined();
  });
});

describe("evaluateHandForUser c-bet classification", () => {
  const hole = [card("7", "diamonds"), card("2", "clubs")];

  it("records success when the hero's flop c-bet hand ends in a win", () => {
    const rec = record({
      actions: [
        { street: "flop", userId: HERO, action: "raise", amount: 10 },
        { street: "flop", userId: OPP, action: "fold", amount: 0 },
      ],
      winners: [{ userId: HERO, amount: 30 }],
    });
    expect(evaluateHandForUser(rec, HERO, hole, HIGH_BOARD).cbet).toBe(
      "success",
    );
  });

  it("records failure when someone else wins the hand", () => {
    const rec = record({
      actions: [
        { street: "flop", userId: HERO, action: "raise", amount: 10 },
        { street: "flop", userId: OPP, action: "call", amount: 10 },
        { street: "river", userId: HERO, action: "fold", amount: 0 },
      ],
      winners: [{ userId: OPP, amount: 50 }],
    });
    expect(evaluateHandForUser(rec, HERO, hole, HIGH_BOARD).cbet).toBe(
      "failed",
    );
  });

  it("attributes the c-bet to the first flop aggressor only", () => {
    const rec = record({
      actions: [
        { street: "flop", userId: OPP, action: "raise", amount: 12 },
        { street: "flop", userId: HERO, action: "call", amount: 12 },
      ],
      winners: [{ userId: HERO, amount: 40 }],
    });
    expect(evaluateHandForUser(rec, HERO, hole, HIGH_BOARD).cbet).toBe(
      undefined,
    );
  });
});

describe("SelfReviewStore rolling windows", () => {
  it("caps recentHands at aiRecentHandsWindow and drops the oldest", () => {
    const store = new SelfReviewStore();
    const original = config.aiRecentHandsWindow;
    config.aiRecentHandsWindow = 3;
    try {
      for (let i = 1; i <= 4; i++) {
        store.recordHand("room", record({ handNumber: i }));
      }
      const kept = store.getRecentHands("room").map((r) => r.handNumber);
      expect(kept).toEqual([2, 3, 4]);
    } finally {
      config.aiRecentHandsWindow = original;
    }
  });

  it("caps outcome queues at aiSelfStatsWindow without drift", () => {
    const store = new SelfReviewStore();
    const original = config.aiSelfStatsWindow;
    config.aiSelfStatsWindow = 3;
    try {
      // 3 caught, then 3 successes: the caught events must be evicted.
      for (let i = 0; i < 3; i++)
        store.recordEvaluation("room", HERO, {
          userId: HERO,
          handNumber: i + 1,
          bluff: "caught",
        });
      for (let i = 0; i < 3; i++)
        store.recordEvaluation("room", HERO, {
          userId: HERO,
          handNumber: i + 4,
          bluff: "success",
        });
      const view = store.getSelfReview("room", HERO)!;
      expect(view.bluffs.attempts).toBe(3);
      expect(view.bluffs.successRate).toBe(100);
    } finally {
      config.aiSelfStatsWindow = original;
    }
  });
});

describe("SelfReviewStore.getSelfReview", () => {
  it("returns null before any evaluation and after clearRoom", () => {
    const store = new SelfReviewStore();
    expect(store.getSelfReview("room", HERO)).toBeNull();
    store.recordEvaluation("room", HERO, {
      userId: HERO,
      handNumber: 1,
      cbet: "success",
    });
    expect(store.getSelfReview("room", HERO)).not.toBeNull();
    store.clearRoom("room");
    expect(store.getSelfReview("room", HERO)).toBeNull();
    expect(store.getRecentHands("room")).toEqual([]);
  });

  it("returns null successRate with zero bluff attempts", () => {
    const store = new SelfReviewStore();
    store.recordEvaluation("room", HERO, {
      userId: HERO,
      handNumber: 1,
      cbet: "failed",
    });
    const view = store.getSelfReview("room", HERO)!;
    expect(view.bluffs).toEqual({ attempts: 0, successRate: null });
    expect(view.cbets).toEqual({ attempts: 1, successRate: 0 });
    expect(view.tableImage).toBeNull();
  });

  it("derives the three tableImage states", () => {
    const store = new SelfReviewStore();
    const bluff = (roomId: string, outcomes: ("success" | "caught")[]) => {
      outcomes.forEach((outcome, i) =>
        store.recordEvaluation(roomId, HERO, {
          userId: HERO,
          handNumber: i + 1,
          bluff: outcome,
        }),
      );
    };

    // 0/3 successes → busted label.
    bluff("r-busted", ["caught", "caught", "caught"]);
    expect(store.getSelfReview("r-busted", HERO)!.tableImage).toBe(
      "多次诈唬被识破，形象偏松",
    );

    // 2/3 = 66.7% sits under the 67% threshold → no label.
    bluff("r-middle", ["caught", "success", "success"]);
    const middle = store.getSelfReview("r-middle", HERO)!;
    expect(middle.bluffs.successRate).toBeCloseTo(66.7, 1);
    expect(middle.tableImage).toBeNull();

    // 3/3 successes → trusted label.
    bluff("r-trusted", ["success", "success", "success"]);
    expect(store.getSelfReview("r-trusted", HERO)!.tableImage).toBe(
      "近期诈唬屡屡得手",
    );
  });

  it("does not label on fewer than three attempts", () => {
    const store = new SelfReviewStore();
    for (let i = 0; i < 2; i++)
      store.recordEvaluation("room", HERO, {
        userId: HERO,
        handNumber: i + 1,
        bluff: "caught",
      });
    expect(store.getSelfReview("room", HERO)!.tableImage).toBeNull();
  });

  it("prunes users who are no longer seated", () => {
    const store = new SelfReviewStore();
    store.recordEvaluation("room", HERO, {
      userId: HERO,
      handNumber: 1,
      cbet: "success",
    });
    store.recordEvaluation("room", OPP, {
      userId: OPP,
      handNumber: 1,
      cbet: "failed",
    });
    store.pruneTo("room", new Set([HERO]));
    expect(store.getSelfReview("room", OPP)).toBeNull();
    expect(store.getSelfReview("room", HERO)).not.toBeNull();
  });
});

describe("effectiveBluffHintRate", () => {
  const persona: AiPersonaView = {
    id: "p1",
    slug: "loose-aggressive",
    displayName: "松凶",
    styleLabel: "LAG",
    promptSection: "测试人格",
    temperature: 0.9,
    bluffHintRate: 0.4,
    seedTemperature: 0.9,
    seedBluffHintRate: 0.4,
    evolvedAt: null,
  };

  const profileWith = (
    stats: Partial<NonNullable<ProfileView["stats"]>>,
  ): ProfileView => ({
    userId: "h1",
    username: "human1",
    isAi: false,
    hands: 20,
    ready: true,
    stats: {
      hands: 20,
      vpip: 30,
      pfr: 20,
      threeBet: 8,
      af: 2,
      foldToRaise: null,
      foldToCbet: null,
      wtsd: null,
      ...stats,
    },
    note: null,
  });

  const reviewWith = (
    attempts: number,
    successRate: number | null,
  ): SelfReviewView => ({
    tableImage: null,
    bluffs: { attempts, successRate },
    cbets: { attempts: 0, successRate: null },
  });

  it("returns 0 without a persona", () => {
    expect(effectiveBluffHintRate(null, "flop")).toBe(0);
  });

  it("applies the phase factors", () => {
    expect(effectiveBluffHintRate(persona, "preflop")).toBeCloseTo(0.24, 5);
    expect(effectiveBluffHintRate(persona, "flop")).toBeCloseTo(0.4, 5);
    expect(effectiveBluffHintRate(persona, "turn")).toBeCloseTo(0.4, 5);
    expect(effectiveBluffHintRate(persona, "river")).toBeCloseTo(0.28, 5);
  });

  it("applies the table-image factor", () => {
    const trusted = reviewWith(3, 100);
    expect(effectiveBluffHintRate(persona, "flop", trusted)).toBeCloseTo(
      0.48,
      5,
    );
    const busted = reviewWith(2, 0);
    expect(effectiveBluffHintRate(persona, "flop", busted)).toBeCloseTo(0.2, 5);
    // Middle success rate and zero attempts both keep the baseline.
    expect(
      effectiveBluffHintRate(persona, "flop", reviewWith(4, 50)),
    ).toBeCloseTo(0.4, 5);
    expect(
      effectiveBluffHintRate(persona, "flop", reviewWith(0, null)),
    ).toBeCloseTo(0.4, 5);
    // One caught bluff is not yet a pattern (needs attempts >= 2).
    expect(
      effectiveBluffHintRate(persona, "flop", reviewWith(1, 0)),
    ).toBeCloseTo(0.4, 5);
  });

  it("applies the opponent fold-tendency factor", () => {
    const folders = [profileWith({ foldToCbet: 70 })];
    expect(effectiveBluffHintRate(persona, "flop", null, folders)).toBeCloseTo(
      0.52,
      5,
    );

    const stations = [profileWith({ foldToCbet: 20 })];
    expect(effectiveBluffHintRate(persona, "flop", null, stations)).toBeCloseTo(
      0.2,
      5,
    );

    // Falls back to foldToRaise when foldToCbet has no sample.
    const fallback = [profileWith({ foldToRaise: 70 })];
    expect(effectiveBluffHintRate(persona, "flop", null, fallback)).toBeCloseTo(
      0.52,
      5,
    );
  });

  it("never bluffs into a calling station regardless of fold averages", () => {
    const mixed = [
      profileWith({ foldToCbet: 90 }),
      profileWith({ foldToCbet: 40, wtsd: 60 }),
    ];
    expect(effectiveBluffHintRate(persona, "flop", null, mixed)).toBeCloseTo(
      0.2,
      5,
    );
  });

  it("ignores not-ready profiles", () => {
    const cold: ProfileView = { ...profileWith({ foldToCbet: 90 }) };
    cold.ready = false;
    cold.stats = null;
    expect(effectiveBluffHintRate(persona, "flop", null, [cold])).toBeCloseTo(
      0.4,
      5,
    );
  });

  it("clamps the effective rate into [0, 0.6]", () => {
    const hot = [profileWith({ foldToCbet: 80 })];
    const trusted = reviewWith(5, 100);
    const breakdown = bluffHintBreakdown(persona, "flop", trusted, hot);
    // 0.4 * 1.0 * 1.2 * 1.3 = 0.624 → clamped to 0.6.
    expect(breakdown.rate).toBe(0.6);
    expect(breakdown.phaseFactor).toBe(1.0);
    expect(breakdown.imageFactor).toBe(1.2);
    expect(breakdown.opponentFactor).toBe(1.3);
    expect(effectiveBluffHintRate(persona, "flop", trusted, hot)).toBe(0.6);
  });
});

describe("buildDecisionContext self-review injection", () => {
  function player(overrides: Partial<PlayerState>): PlayerState {
    return {
      userId: "u1",
      username: "human1",
      seatIndex: 0,
      chips: 148,
      bet: 0,
      totalBet: 2,
      folded: false,
      allIn: false,
      hasActed: false,
      cards: [],
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
      cardsRevealed: false,
      ...overrides,
    };
  }

  function state(): GameState {
    return {
      phase: "flop",
      communityCards: [
        card("Q", "spades"),
        card("7", "diamonds"),
        card("2", "clubs"),
      ],
      pot: 9,
      sidePots: [],
      players: [
        player({
          userId: "ai1",
          username: "AI_XiaoZhi",
          seatIndex: 2,
          cards: [card("A", "hearts"), card("K", "diamonds")],
        }),
        player({
          userId: "u2",
          username: "human2",
          seatIndex: 0,
          cards: [card("9", "hearts"), card("9", "clubs")],
        }),
      ],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      smallBlind: 1,
      bigBlind: 2,
      currentBet: 4,
      minRaise: 4,
      handNumber: 3,
      actionLog: [],
    };
  }

  const review: SelfReviewView = {
    tableImage: "近期诈唬屡屡得手",
    bluffs: { attempts: 4, successRate: 75 },
    cbets: { attempts: 2, successRate: 50 },
  };

  const recent: HandRecord[] = [
    record({
      handNumber: 1,
      actions: [
        { street: "flop", userId: "ai1", action: "raise", amount: 12 },
        { street: "flop", userId: "u2", action: "fold", amount: 0 },
      ],
      winners: [{ userId: "ai1", amount: 24 }],
    }),
    record({
      handNumber: 2,
      actions: [{ street: "river", userId: "u2", action: "raise", amount: 60 }],
      winners: [{ userId: "u2", amount: 140 }],
      showdownParticipantIds: ["ai1", "u2"],
      revealedHandNames: { u2: "两对 K 和 9" },
    }),
  ];

  it("omits self-review fields when no data exists", () => {
    const ctx = buildDecisionContext(state(), "ai1");
    expect(ctx).not.toHaveProperty("selfReview");
    expect(ctx).not.toHaveProperty("recentHandsSummary");
  });

  it("appends selfReview and recentHandsSummary after the history", () => {
    const ctx = buildDecisionContext(state(), "ai1", [], review, recent);
    const keys = Object.keys(ctx);
    const historyIdx = keys.indexOf("history");
    expect(keys.indexOf("recentHandsSummary")).toBeGreaterThan(historyIdx);
    expect(keys.indexOf("selfReview")).toBeGreaterThan(historyIdx);

    expect(ctx.selfReview).toEqual({
      bluff: { attempts: 4, successRate: 75 },
      cbets: { attempts: 2, successRate: 50 },
      tableImage: "近期诈唬屡屡得手",
    });
  });

  it("respects aiRecentHandsInContext and compresses like the summarizer", () => {
    const original = config.aiRecentHandsInContext;
    config.aiRecentHandsInContext = 1;
    try {
      const ctx = buildDecisionContext(state(), "ai1", [], null, recent) as {
        recentHandsSummary: string[];
      };
      expect(ctx.recentHandsSummary).toHaveLength(1);
      // Only the newest hand survives; hero is labeled from the AI's POV.
      expect(ctx.recentHandsSummary[0]).toContain("river:u2:raise60");
      expect(ctx.recentHandsSummary[0]).toContain("showdown lost");
    } finally {
      config.aiRecentHandsInContext = original;
    }

    const ctx = buildDecisionContext(state(), "ai1", [], null, recent) as {
      recentHandsSummary: string[];
    };
    expect(ctx.recentHandsSummary).toHaveLength(2);
    expect(ctx.recentHandsSummary[0]).toContain("flop:hero:raise12");
    expect(ctx.recentHandsSummary[0]).toContain("won 24");
    expect(ctx.recentHandsSummary[1]).toContain("showdown lost");
  });

  it("drops tableImage from the context when the store derives none", () => {
    const noImage: SelfReviewView = { ...review, tableImage: null };
    const ctx = buildDecisionContext(state(), "ai1", [], noImage) as {
      selfReview: Record<string, unknown>;
    };
    expect(ctx.selfReview).not.toHaveProperty("tableImage");
  });

  it("never leaks opponents' hole cards through the new fields (对抗性检验)", () => {
    const ctx = buildDecisionContext(state(), "ai1", [], review, recent);
    const serialized = JSON.stringify(ctx);
    // Opponent pocket pair from the fixture state.
    expect(serialized).not.toContain('"9h"');
    expect(serialized).not.toContain('"9c"');
    expect(serialized).not.toContain("9h,");
    expect(serialized).not.toContain("9c,");
    // Hero's own cards are still visible.
    expect(serialized).toContain("Ah");
  });
});
