import { z } from "zod";
import {
  GameState,
  ActionOption,
  GamePhase,
  PlayerActionType,
} from "../poker/types.js";
import { buildDecisionContext, buildSystemPrompt } from "./prompt.js";
import { callLlm } from "./llm.client.js";
import { config } from "../config.js";
import { recordAiDecision, AiFailReason } from "./stats.js";
import { personaOfUser } from "./personas.js";
import type { AiPersonaView } from "./personas.js";
import type { ProfileView, HandRecord } from "./profiling/types.js";
import type { SelfReviewView } from "./selfreview/store.js";

export interface AiAction {
  action: PlayerActionType;
  amount?: number;
}

const decisionSchema = z.object({
  action: z.enum(["fold", "check", "call", "raise", "allin"]),
  amount: z.number().finite().optional(),
});

// The model occasionally emits common synonyms instead of the exact action
// vocabulary; map them instead of rejecting the whole decision.
const ACTION_ALIASES: Record<string, string> = {
  bet: "raise",
  "all-in": "allin",
  all_in: "allin",
};

const HAND_DIRECTIVE_BLUFF =
  "本手牌面允许时，倾向选择诈唬线路：选一条可代表的强牌故事线并贯彻到底。";

// Server-side dice for the per-hand bluff directive. Injectable so tests can
// pin the outcome; defaults to Math.random in production.
let decisionRng: () => number = Math.random;
export function setAiDecisionRngForTests(rng?: () => number): void {
  decisionRng = rng ?? Math.random;
}

// First-cut per-street bluff multipliers; tuned later from table observation.
const PHASE_FACTORS: Partial<Record<GamePhase, number>> = {
  preflop: 0.6,
  flop: 1.0,
  turn: 1.0,
  river: 0.7,
};

function imageFactorOf(selfReview?: SelfReviewView | null): number {
  if (!selfReview) return 1.0;
  const { attempts, successRate } = selfReview.bluffs;
  if (attempts === 0 || successRate === null) return 1.0;
  if (successRate >= 67) return 1.2;
  if (successRate < 34 && attempts >= 2) return 0.5;
  return 1.0;
}

function opponentFactorOf(opponentProfiles?: ProfileView[]): number {
  const ready = (opponentProfiles ?? []).filter((p) => p.ready && p.stats);
  if (ready.length === 0) return 1.0;
  // Never bluff a calling station, even if the table average folds a lot.
  if (ready.some((p) => (p.stats!.wtsd ?? 0) >= 50)) return 0.5;
  const foldRates = ready
    .map((p) => p.stats!.foldToCbet ?? p.stats!.foldToRaise)
    .filter((v): v is number => v !== null);
  if (foldRates.length === 0) return 1.0;
  const avg = foldRates.reduce((a, b) => a + b, 0) / foldRates.length;
  if (avg >= 60) return 1.3;
  if (avg <= 30) return 0.5;
  return 1.0;
}

export interface BluffHintBreakdown {
  rate: number;
  phaseFactor: number;
  imageFactor: number;
  opponentFactor: number;
}

// Dynamic per-decision bluff probability: persona baseline modulated by the
// street, the AI's own recent bluff record (table image), and opponents'
// observed fold tendencies. Clamped so no factor combination runs away.
export function bluffHintBreakdown(
  persona: AiPersonaView | null,
  phase: GamePhase,
  selfReview?: SelfReviewView | null,
  opponentProfiles?: ProfileView[],
): BluffHintBreakdown {
  const phaseFactor = PHASE_FACTORS[phase] ?? 1.0;
  const imageFactor = imageFactorOf(selfReview);
  const opponentFactor = opponentFactorOf(opponentProfiles);
  const base = persona?.bluffHintRate ?? 0;
  const rate = Math.min(
    Math.max(base * phaseFactor * imageFactor * opponentFactor, 0),
    0.6,
  );
  return { rate, phaseFactor, imageFactor, opponentFactor };
}

export function effectiveBluffHintRate(
  persona: AiPersonaView | null,
  phase: GamePhase,
  selfReview?: SelfReviewView | null,
  opponentProfiles?: ProfileView[],
): number {
  return bluffHintBreakdown(persona, phase, selfReview, opponentProfiles).rate;
}

function normalizeRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const action =
    typeof raw.action === "string"
      ? raw.action.trim().toLowerCase()
      : raw.action;
  const mapped =
    typeof action === "string" ? (ACTION_ALIASES[action] ?? action) : action;
  return mapped === raw.action ? raw : { ...raw, action: mapped };
}

// Guaranteed-legal default: check when possible, otherwise fold.
export function fallbackAction(availableActions: ActionOption[]): AiAction {
  if (availableActions.some((a) => a.type === "check"))
    return { action: "check" };
  return { action: "fold" };
}

// Mirrors src/poker/actions.ts isValidAction but works on the option list.
function isActionAllowed(
  availableActions: ActionOption[],
  action: string,
  amount?: number,
): boolean {
  return availableActions.some((a) => {
    if (a.type !== action) return false;
    if (action === "raise" || action === "allin") {
      if (amount === undefined || !Number.isSafeInteger(amount) || amount < 0) {
        return false;
      }
      if (action === "allin" && amount === 0) return false;
      if (a.min !== undefined && amount < a.min) return false;
      if (a.max !== undefined && amount > a.max) return false;
    }
    return true;
  });
}

// LLM-driven decision with a hard fallback: the game must never stall on an
// AI turn, so every failure path returns fallbackAction.
export async function decideAiAction(
  state: GameState,
  userId: string,
  availableActions: ActionOption[],
  opponentProfiles?: ProfileView[],
  selfReview?: SelfReviewView | null,
  recentHands?: HandRecord[],
): Promise<AiAction> {
  const fallback = fallbackAction(availableActions);
  const me = state.players.find((p) => p.userId === userId);
  const persona = personaOfUser(userId);
  // Server-side roll, independent of LLM sampling: with the dynamic
  // (phase/image/opponent-modulated) probability inject a bluff-line
  // directive into this hand's context.
  const bluffHint = bluffHintBreakdown(
    persona,
    state.phase,
    selfReview,
    opponentProfiles,
  );
  const handDirective = persona !== null && decisionRng() < bluffHint.rate;

  const meta = {
    username: me?.username ?? userId,
    phase: state.phase,
    handNo: state.handNumber,
    toCall: me ? Math.max(0, state.currentBet - me.bet) : 0,
    personaSlug: persona?.slug,
    handDirective,
    bluffRate: persona ? Number(bluffHint.rate.toFixed(2)) : undefined,
    phaseFactor: persona ? bluffHint.phaseFactor : undefined,
    imageFactor: persona ? bluffHint.imageFactor : undefined,
    opponentFactor: persona ? bluffHint.opponentFactor : undefined,
  };
  const finish = (
    result: AiAction,
    source: "llm" | "fallback",
    failReason?: AiFailReason,
    llmRaw?: string,
  ): AiAction => {
    recordAiDecision({
      ...meta,
      source,
      failReason,
      llmRaw,
      finalAction: result.action,
    });
    return result;
  };

  try {
    const context = buildDecisionContext(
      state,
      userId,
      opponentProfiles,
      selfReview,
      recentHands,
    );
    if (handDirective) context.handDirective = HAND_DIRECTIVE_BLUFF;

    let timer: ReturnType<typeof setTimeout> | undefined;
    // Grace margin over the fetch-level abort so the outer race is the
    // last-resort guard, not the primary timeout.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), config.aiTimeoutMs + 500);
    });
    const raw = await Promise.race([
      callLlm(buildSystemPrompt(persona), JSON.stringify(context), {
        temperature: persona?.temperature,
      }),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    if (!raw) return finish(fallback, "fallback", "no_response");

    const rawStr = JSON.stringify(raw);
    const parsed = decisionSchema.safeParse(normalizeRaw(raw));
    if (!parsed.success) return finish(fallback, "fallback", "schema", rawStr);

    const { action } = parsed.data;
    let { amount } = parsed.data;

    if (action === "raise") {
      // Clamp an off-target amount into the legal window instead of
      // discarding the model's aggressive intent into a fold.
      const opt = availableActions.find((a) => a.type === "raise");
      if (!opt) return finish(fallback, "fallback", "illegal", rawStr);
      const lo = opt.min ?? 0;
      const hi = opt.max ?? lo;
      amount =
        amount === undefined || !Number.isFinite(amount)
          ? lo
          : Math.min(Math.max(Math.round(amount), lo), hi);
    }

    // Allin never validates the model's amount; the engine uses the full stack.
    if (action === "allin") {
      amount = availableActions.find((a) => a.type === "allin")?.amount;
    }

    if (!isActionAllowed(availableActions, action, amount))
      return finish(fallback, "fallback", "illegal", rawStr);

    return finish({ action, amount }, "llm", undefined, rawStr);
  } catch {
    return finish(fallback, "fallback", "error");
  }
}
