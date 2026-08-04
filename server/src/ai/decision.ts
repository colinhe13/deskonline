import { z } from "zod";
import { GameState, ActionOption, PlayerActionType } from "../poker/types.js";
import { buildDecisionContext, GTO_SYSTEM_PROMPT } from "./prompt.js";
import { callLlm } from "./llm.client.js";
import { config } from "../config.js";

export interface AiAction {
  action: PlayerActionType;
  amount?: number;
}

const decisionSchema = z.object({
  action: z.enum(["fold", "check", "call", "raise", "allin"]),
  amount: z.number().int().nonnegative().optional(),
});

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
): Promise<AiAction> {
  const fallback = fallbackAction(availableActions);

  try {
    const context = buildDecisionContext(state, userId);

    let timer: ReturnType<typeof setTimeout> | undefined;
    // Grace margin over the fetch-level abort so the outer race is the
    // last-resort guard, not the primary timeout.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), config.aiTimeoutMs + 500);
    });
    const raw = await Promise.race([
      callLlm(GTO_SYSTEM_PROMPT, JSON.stringify(context)),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    if (!raw) return fallback;

    const parsed = decisionSchema.safeParse(raw);
    if (!parsed.success) return fallback;

    const { action } = parsed.data;
    let { amount } = parsed.data;

    // The engine ignores the allin amount but validation requires one.
    if (action === "allin" && amount === undefined) {
      amount = availableActions.find((a) => a.type === "allin")?.amount;
    }

    if (!isActionAllowed(availableActions, action, amount)) return fallback;

    return { action, amount };
  } catch {
    return fallback;
  }
}
