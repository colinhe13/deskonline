import { PlayerActionType } from "../poker/types.js";

// no_response covers timeout, network, HTTP errors and unparseable output —
// the adjacent "[ai] LLM call ..." log lines carry the specific reason.
export type AiFailReason = "no_response" | "schema" | "illegal" | "error";

export interface AiDecisionRecord {
  username: string;
  phase: string;
  handNo: number;
  toCall: number;
  source: "llm" | "fallback" | "watchdog";
  failReason?: AiFailReason;
  llmRaw?: string;
  finalAction: PlayerActionType;
  personaSlug?: string;
  handDirective?: boolean;
  // Effective bluff-hint probability actually rolled against, with the three
  // modulation factors, so dynamic tuning is observable in the logs.
  bluffRate?: number;
  phaseFactor?: number;
  imageFactor?: number;
  opponentFactor?: number;
}

export interface AiStats {
  decisions: number;
  bySource: Record<"llm" | "fallback" | "watchdog", number>;
  byFailReason: Record<AiFailReason, number>;
  finalActions: Partial<Record<PlayerActionType, number>>;
  llmFinalActions: Partial<Record<PlayerActionType, number>>;
  facingBet: number;
  facingBetFolded: number;
  facingBetFoldedByLlm: number;
  facingBetFoldedByFallback: number;
}

const stats: AiStats = {
  decisions: 0,
  bySource: { llm: 0, fallback: 0, watchdog: 0 },
  byFailReason: { no_response: 0, schema: 0, illegal: 0, error: 0 },
  finalActions: {},
  llmFinalActions: {},
  facingBet: 0,
  facingBetFolded: 0,
  facingBetFoldedByLlm: 0,
  facingBetFoldedByFallback: 0,
};

function bump(
  map: Partial<Record<PlayerActionType, number>>,
  key: PlayerActionType,
) {
  map[key] = (map[key] ?? 0) + 1;
}

function fmtActions(map: Partial<Record<PlayerActionType, number>>): string {
  const order: PlayerActionType[] = ["fold", "check", "call", "raise", "allin"];
  return order
    .filter((a) => map[a])
    .map((a) => `${a}=${map[a]}`)
    .join(" ");
}

export function recordAiDecision(rec: AiDecisionRecord): void {
  stats.decisions += 1;
  stats.bySource[rec.source] += 1;
  if (rec.failReason) stats.byFailReason[rec.failReason] += 1;
  bump(stats.finalActions, rec.finalAction);
  if (rec.source === "llm") bump(stats.llmFinalActions, rec.finalAction);

  const facingBet = rec.toCall > 0;
  if (facingBet) {
    stats.facingBet += 1;
    if (rec.finalAction === "fold") {
      stats.facingBetFolded += 1;
      if (rec.source === "llm") stats.facingBetFoldedByLlm += 1;
      else stats.facingBetFoldedByFallback += 1;
    }
  }

  const raw = rec.llmRaw ? ` raw=${rec.llmRaw}` : "";
  const reason = rec.failReason ? ` reason=${rec.failReason}` : "";
  const persona = rec.personaSlug ? ` persona=${rec.personaSlug}` : "";
  const hint = rec.handDirective ? " bluffHint" : "";
  const bluff =
    rec.bluffRate !== undefined
      ? ` bluffRate=${rec.bluffRate}(pf=${rec.phaseFactor},if=${rec.imageFactor},of=${rec.opponentFactor})`
      : "";
  console.info(
    `[ai][decision] ${rec.username} hand=${rec.handNo} phase=${rec.phase} toCall=${rec.toCall}${persona}${hint}${bluff} src=${rec.source}${reason}${raw} -> ${rec.finalAction}`,
  );

  const s = stats;
  const fail = Object.entries(s.byFailReason)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.info(
    `[ai][stats] decisions=${s.decisions} src(llm=${s.bySource.llm} fallback=${s.bySource.fallback} watchdog=${s.bySource.watchdog})` +
      (fail ? ` fails(${fail})` : "") +
      ` final[${fmtActions(s.finalActions) || "none"}] llmOnly[${fmtActions(s.llmFinalActions) || "none"}]` +
      ` facingBet=${s.facingBet} folded=${s.facingBetFolded}(llm=${s.facingBetFoldedByLlm} fb/wd=${s.facingBetFoldedByFallback})`,
  );
}

export function getAiStats(): AiStats {
  return stats;
}

export function resetAiStats(): void {
  stats.decisions = 0;
  stats.bySource = { llm: 0, fallback: 0, watchdog: 0 };
  stats.byFailReason = { no_response: 0, schema: 0, illegal: 0, error: 0 };
  stats.finalActions = {};
  stats.llmFinalActions = {};
  stats.facingBet = 0;
  stats.facingBetFolded = 0;
  stats.facingBetFoldedByLlm = 0;
  stats.facingBetFoldedByFallback = 0;
}
