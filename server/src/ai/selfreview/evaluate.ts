import { Card, HandRank, StructuredAction } from "../../poker/types.js";
import { evaluateHand } from "../../poker/evaluator.js";
import type { HandRecord } from "../profiling/types.js";

export type BluffOutcome = "success" | "caught";
export type CbetOutcome = "success" | "failed";

export interface HandSelfEvaluation {
  userId: string;
  handNumber: number;
  bluff?: BluffOutcome;
  cbet?: CbetOutcome;
}

const POSTFLOP_STREETS = new Set<StructuredAction["street"]>([
  "flop",
  "turn",
  "river",
]);

function isAggressive(action: StructuredAction["action"]): boolean {
  return action === "raise" || action === "allin";
}

function hasPostflopAggression(
  actions: StructuredAction[],
  userId: string,
): boolean {
  return actions.some(
    (a) =>
      a.userId === userId &&
      POSTFLOP_STREETS.has(a.street) &&
      isAggressive(a.action),
  );
}

// Deterministic self-review of one settled hand from a single AI's point of
// view. Uses only public information (HandRecord) plus the AI's own hole
// cards — never any opponent's hole cards.
//
// A hand counts as a bluff attempt only when the AI showed postflop
// aggression while holding at most one pair (weak enough that winning
// requires folding out opponents). Winning without showdown = success;
// showing down the weak hand and losing = caught. Value hands (two pair+),
// passive weak hands, and folds are excluded from bluff stats.
export function evaluateHandForUser(
  record: HandRecord,
  userId: string,
  holeCards: Card[],
  communityCards: Card[],
): HandSelfEvaluation {
  const out: HandSelfEvaluation = { userId, handNumber: record.handNumber };

  const isWinner = record.winners.some((w) => w.userId === userId);
  const atShowdown = record.showdownParticipantIds.includes(userId);

  // A hand that ended preflop has no flop aggression; require the flop to
  // actually be dealt before evaluating strength.
  if (
    hasPostflopAggression(record.actions, userId) &&
    holeCards.length === 2 &&
    communityCards.length >= 3
  ) {
    const rank = evaluateHand([...holeCards, ...communityCards]).rank;
    if (rank <= HandRank.OnePair) {
      if (isWinner && !atShowdown) out.bluff = "success";
      else if (atShowdown && !isWinner) out.bluff = "caught";
    }
  }

  // Same c-bet definition as profiling's foldToCbet bookkeeping: the first
  // aggressive action on the flop street.
  const firstFlopAggression = record.actions.find(
    (a) => a.street === "flop" && isAggressive(a.action),
  );
  if (firstFlopAggression?.userId === userId) {
    out.cbet = isWinner ? "success" : "failed";
  }

  return out;
}
