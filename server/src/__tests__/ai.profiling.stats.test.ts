import { describe, it, expect } from "vitest";
import type { StructuredAction } from "../poker/types.js";
import { buildHandRecord } from "../ai/profiling/handRecord.js";
import {
  applyHandToStats,
  computeRates,
  createStats,
} from "../ai/profiling/stats.js";
import type { HandRecord } from "../ai/profiling/types.js";

function action(
  street: StructuredAction["street"],
  userId: string,
  act: StructuredAction["action"],
  amount = 0,
): StructuredAction {
  return { street, userId, action: act, amount };
}

function record(
  actions: StructuredAction[],
  extra?: Partial<HandRecord>,
): HandRecord {
  return {
    actions,
    winners: extra?.winners ?? [{ userId: "u1", amount: 6 }],
    showdownParticipantIds: extra?.showdownParticipantIds ?? [],
    revealedHandNames: extra?.revealedHandNames ?? {},
  };
}

describe("buildHandRecord", () => {
  it("copies history and derives showdown participants from result", () => {
    const history = [action("preflop", "u1", "blind", 1)];
    const rec = buildHandRecord(history, {
      winners: [{ userId: "u2", amount: 10 }],
      refunds: [],
      showdownCards: {
        u1: [{ suit: "hearts", rank: "A" }],
        u2: [{ suit: "clubs", rank: "K" }],
      },
      handNames: { u1: "高牌 A", u2: "一对 K" },
      reason: "showdown",
    });
    expect(rec.actions).toEqual(history);
    expect(rec.actions).not.toBe(history);
    expect(rec.winners).toEqual([{ userId: "u2", amount: 10 }]);
    expect(rec.showdownParticipantIds.sort()).toEqual(["u1", "u2"]);
    expect(rec.revealedHandNames).toEqual({ u1: "高牌 A", u2: "一对 K" });
    // Hand names only; raw card faces never enter the profile record.
    expect(JSON.stringify(rec)).not.toMatch(/[2-9TJQKA][hdcs]\b/);
    expect(JSON.stringify(rec)).not.toMatch(/hearts|clubs|diamonds|spades/);
  });

  it("leaves revealedHandNames empty on a fold win", () => {
    const rec = buildHandRecord([action("preflop", "u1", "blind", 1)], {
      winners: [{ userId: "u1", amount: 3 }],
      refunds: [],
      showdownCards: {},
      handNames: {},
      reason: "fold",
    });
    expect(rec.revealedHandNames).toEqual({});
  });
});

describe("applyHandToStats", () => {
  it("ignores users who did not participate", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([action("preflop", "u1", "blind", 1)]),
      "u9",
    );
    expect(stats.hands).toBe(0);
  });

  it("blinds alone are not VPIP; BB check is not VPIP", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([
        action("preflop", "u1", "blind", 1),
        action("preflop", "u2", "blind", 2),
        action("preflop", "u1", "check"),
      ]),
      "u2",
    );
    expect(stats.hands).toBe(1);
    expect(computeRates(stats).vpip).toBe(0);
  });

  it("counts a preflop call as VPIP but not PFR", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([
        action("preflop", "u2", "blind", 2),
        action("preflop", "u1", "call", 2),
      ]),
      "u1",
    );
    const rates = computeRates(stats);
    expect(rates.vpip).toBe(100);
    expect(rates.pfr).toBe(0);
  });

  it("counts an unopposed preflop raise as PFR but not 3-bet", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([
        action("preflop", "u2", "blind", 2),
        action("preflop", "u1", "raise", 5),
      ]),
      "u1",
    );
    const rates = computeRates(stats);
    expect(rates.pfr).toBe(100);
    expect(rates.threeBet).toBeNull(); // never had a 3-bet opportunity
  });

  it("counts a re-raise facing a raise as 3-bet", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([
        action("preflop", "u1", "raise", 5),
        action("preflop", "u2", "raise", 12),
      ]),
      "u2",
    );
    const rates = computeRates(stats);
    expect(rates.threeBet).toBe(100);
  });

  it("folding to a raise counts foldToRaise; calling does not fold", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([
        action("preflop", "u1", "raise", 5),
        action("preflop", "u2", "fold"),
      ]),
      "u2",
    );
    applyHandToStats(
      stats,
      record([
        action("preflop", "u1", "raise", 5),
        action("preflop", "u2", "call", 5),
      ]),
      "u2",
    );
    expect(computeRates(stats).foldToRaise).toBe(50);
  });

  it("a later check after responding to a raise is not a new fold-to-raise opportunity", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([
        action("preflop", "u1", "raise", 5),
        action("preflop", "u2", "call", 5),
        action("flop", "u2", "check"),
        action("flop", "u1", "check"),
      ]),
      "u2",
    );
    expect(stats.foldToRaiseOpps).toBe(1);
  });

  it("a new raise reopens facing-raise state for players who already responded", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([
        action("preflop", "u1", "raise", 5),
        action("preflop", "u2", "call", 5),
        action("preflop", "u3", "raise", 15),
        action("preflop", "u2", "fold"),
      ]),
      "u2",
    );
    expect(stats.foldToRaiseOpps).toBe(2);
    expect(stats.foldToRaiseFolds).toBe(1);
  });

  it("computes postflop aggression factor; null when never calling postflop", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([
        action("flop", "u1", "raise", 10),
        action("flop", "u2", "call", 10),
        action("turn", "u1", "raise", 20),
        action("turn", "u2", "call", 20),
      ]),
      "u1",
    );
    expect(computeRates(stats).af).toBeNull();

    const stats2 = createStats();
    applyHandToStats(
      stats2,
      record([
        action("flop", "u1", "raise", 10),
        action("flop", "u2", "call", 10),
        action("turn", "u1", "check"),
        action("turn", "u2", "raise", 20),
        action("turn", "u1", "call", 20),
      ]),
      "u1",
    );
    // u1: postflop aggressive=1 (flop raise), calls=1 (turn call) → AF 1
    expect(computeRates(stats2).af).toBe(1);
  });

  it("counts WTSD from showdown participation", () => {
    const stats = createStats();
    applyHandToStats(
      stats,
      record([action("preflop", "u1", "call", 2)], {
        showdownParticipantIds: ["u1", "u2"],
      }),
      "u1",
    );
    applyHandToStats(stats, record([action("preflop", "u1", "fold")]), "u1");
    expect(computeRates(stats).wtsd).toBe(50);
  });
});
