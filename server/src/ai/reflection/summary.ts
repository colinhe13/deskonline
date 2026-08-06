import { Card, GameState, StructuredAction } from "../../poker/types.js";
import type { HandResult } from "../../poker/engine.js";
import type { HandRecord } from "../profiling/types.js";
import type { HandSelfEvaluation } from "../selfreview/evaluate.js";
import type { SummaryDraft } from "./store.js";

const POSITION_LABELS = [
  "BTN",
  "SB",
  "BB",
  "UTG",
  "UTG+1",
  "MP",
  "LJ",
  "HJ",
  "CO",
];

function positionOf(
  index: number,
  dealerIndex: number,
  playerCount: number,
): string {
  if (playerCount === 2) return index === dealerIndex ? "BTN" : "BB";
  const offset = (index - dealerIndex + playerCount) % playerCount;
  return POSITION_LABELS[Math.min(offset, POSITION_LABELS.length - 1)];
}

const RANK_ORDER = "23456789TJQKA";

// Short deterministic board description (≤20 chars) — reflection only needs
// structure, never exact cards.
export function boardTextureOf(community: Card[]): string {
  if (community.length < 3) return "无公共牌";
  const ranks = community.map((c) => RANK_ORDER.indexOf(c.rank));
  const suits = community.map((c) => c.suit);
  const suitCounts = new Map<string, number>();
  for (const s of suits) suitCounts.set(s, (suitCounts.get(s) ?? 0) + 1);
  const maxSuited = Math.max(...suitCounts.values());
  const paired = new Set(ranks).size !== ranks.length;
  const sorted = [...ranks].sort((a, b) => a - b);
  const connected =
    !paired && sorted.every((r, i) => i === 0 || r - sorted[i - 1] <= 2);
  if (maxSuited === community.length) return "单色面";
  const wet = maxSuited >= 4 || connected;
  const parts: string[] = [];
  if (paired) parts.push("有对");
  if (connected) parts.push("连张");
  if (maxSuited >= 4) parts.push("多同花");
  const high = sorted[sorted.length - 1] >= RANK_ORDER.indexOf("Q");
  return `${wet ? "湿" : "干"}${high ? "高" : "低"}牌面${parts.length > 0 ? "：" + parts.join("+") : ""}`;
}

function isAggressive(action: StructuredAction["action"]): boolean {
  return action === "raise" || action === "allin";
}

// Bets = unopposed street-first aggression; raises = aggression answering
// earlier street aggression (by anyone, incl. self re-raises); facedBets =
// streets where opponents were aggressive at all.
function actionCountsOf(
  actions: StructuredAction[],
  userId: string,
): { myBets: number; myRaises: number; facedBets: number } {
  let myBets = 0;
  let myRaises = 0;
  let facedBets = 0;
  const streets = new Set(actions.map((a) => a.street));
  for (const street of streets) {
    const streetActions = actions.filter((a) => a.street === street);
    let priorAggression = false;
    let otherAggression = false;
    for (const a of streetActions) {
      if (!isAggressive(a.action)) continue;
      if (a.userId === userId) {
        if (priorAggression) myRaises += 1;
        else myBets += 1;
        priorAggression = true;
      } else {
        otherAggression = true;
        priorAggression = true;
      }
    }
    if (otherAggression) facedBets += 1;
  }
  return { myBets, myRaises, facedBets };
}

// One settled hand, one AI's own view. Mirrors evaluateHandForUser's
// information boundary: public record + self outcome only — never any hole
// cards, own or opponents'.
export function buildSummaryDraft(
  state: GameState,
  record: HandRecord,
  result: HandResult,
  userId: string,
  evaluation: HandSelfEvaluation,
): SummaryDraft | null {
  const myIndex = state.players.findIndex((p) => p.userId === userId);
  if (myIndex < 0) return null;
  const me = state.players[myIndex];

  const isWinner = record.winners.some((w) => w.userId === userId);
  const atShowdown = record.showdownParticipantIds.includes(userId);
  const winAmount = record.winners
    .filter((w) => w.userId === userId)
    .reduce((sum, w) => sum + w.amount, 0);

  let streetReached: string;
  if (atShowdown) streetReached = "showdown";
  else if (state.communityCards.length >= 5) streetReached = "river";
  else if (state.communityCards.length === 4) streetReached = "turn";
  else if (state.communityCards.length === 3) streetReached = "flop";
  else streetReached = "preflop";

  const counts = actionCountsOf(record.actions, userId);

  return {
    userId,
    position: positionOf(myIndex, state.dealerIndex, state.players.length),
    boardTexture: boardTextureOf(state.communityCards),
    streetReached,
    myBets: counts.myBets,
    myRaises: counts.myRaises,
    facedBets: counts.facedBets,
    bluffed: evaluation.bluff ?? null,
    cbet: evaluation.cbet ?? null,
    // totalBet is already refund-adjusted by returnUncalledBets before
    // settlement broadcasts, so winAmount - totalBet is the true chip delta.
    netWon: winAmount - me.totalBet,
    wonAtShowdown: isWinner && atShowdown,
    foldedToBet: !isWinner && !atShowdown && counts.facedBets > 0,
  };
}
