import type { StructuredAction } from "../../poker/types.js";
import type { HandRecord, PlayerStats, StatsDto } from "./types.js";

export function createStats(): PlayerStats {
  return {
    hands: 0,
    vpipHands: 0,
    pfrHands: 0,
    threeBetHands: 0,
    threeBetOpps: 0,
    postflopAggr: 0,
    postflopCalls: 0,
    foldToRaiseOpps: 0,
    foldToRaiseFolds: 0,
    showdownHands: 0,
  };
}

const AGGRESSIVE = new Set(["raise", "allin"]);

export function applyHandToStats(
  stats: PlayerStats,
  record: HandRecord,
  userId: string,
): void {
  const myActions = record.actions.filter((a) => a.userId === userId);
  if (myActions.length === 0) return;

  stats.hands += 1;

  let vpip = false;
  let pfr = false;
  let threeBet = false;
  let threeBetOpp = false;

  // "Facing a raise" bookkeeping: a pending raiser per street, reopened by
  // every new aggressive action, consumed per user once they respond.
  let pendingRaiser: string | null = null;
  const responded = new Set<string>();
  let street: StructuredAction["street"] = "preflop";

  for (const a of record.actions) {
    if (a.street !== street) {
      street = a.street;
      pendingRaiser = null;
      responded.clear();
    }

    if (a.userId === userId) {
      const facingRaise = pendingRaiser !== null && pendingRaiser !== userId && !responded.has(userId);

      if (a.street === "preflop" && a.action !== "blind") {
        if (a.action === "call" || AGGRESSIVE.has(a.action)) vpip = true;
        if (AGGRESSIVE.has(a.action)) pfr = true;
        if (facingRaise) {
          threeBetOpp = true;
          if (AGGRESSIVE.has(a.action)) threeBet = true;
        }
      }

      if (a.street !== "preflop") {
        if (AGGRESSIVE.has(a.action)) stats.postflopAggr += 1;
        else if (a.action === "call") stats.postflopCalls += 1;
      }

      if (facingRaise) {
        stats.foldToRaiseOpps += 1;
        if (a.action === "fold") stats.foldToRaiseFolds += 1;
      }

      responded.add(userId);
    } else if (AGGRESSIVE.has(a.action)) {
      pendingRaiser = a.userId;
      responded.clear();
    }
  }

  if (vpip) stats.vpipHands += 1;
  if (pfr) stats.pfrHands += 1;
  if (threeBetOpp) stats.threeBetOpps += 1;
  if (threeBet) stats.threeBetHands += 1;
  if (record.showdownParticipantIds.includes(userId)) {
    stats.showdownHands += 1;
  }
}

function pct(part: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

export function computeRates(stats: PlayerStats): StatsDto {
  return {
    hands: stats.hands,
    vpip: pct(stats.vpipHands, stats.hands),
    pfr: pct(stats.pfrHands, stats.hands),
    threeBet: pct(stats.threeBetHands, stats.threeBetOpps),
    af:
      stats.postflopCalls === 0
        ? null
        : Math.round((stats.postflopAggr / stats.postflopCalls) * 100) / 100,
    foldToRaise: pct(stats.foldToRaiseFolds, stats.foldToRaiseOpps),
    wtsd: pct(stats.showdownHands, stats.hands),
  };
}
