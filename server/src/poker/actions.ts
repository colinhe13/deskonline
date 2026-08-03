import { GameState, ActionOption } from "./types.js";

export function getAvailableActions(
  state: GameState,
  userId: string,
): ActionOption[] {
  // No actions once the hand has ended (showdown/settled).
  if (state.phase === "showdown" || state.phase === "settled") return [];

  const player = state.players.find((p) => p.userId === userId);
  if (!player) return [];

  const currentIndex = state.players[state.currentPlayerIndex];
  if (!currentIndex || currentIndex.userId !== userId) return [];
  if (player.folded || player.allIn) return [];

  const actions: ActionOption[] = [];
  const toCall = state.currentBet - player.bet;

  if (toCall > 0) {
    actions.push({ type: "fold" });
    if (player.chips <= toCall) {
      actions.push({ type: "allin", amount: player.chips });
    } else {
      actions.push({ type: "call", amount: toCall });
      const minRaiseTotal = state.currentBet + state.minRaise;
      const raiseAmount = minRaiseTotal - player.bet;
      actions.push({
        type: "raise",
        min: Math.min(raiseAmount, player.chips),
        max: player.chips,
      });
      actions.push({ type: "allin", amount: player.chips });
    }
  } else {
    actions.push({ type: "check" });
    actions.push({ type: "fold" });
    if (player.chips > 0) {
      actions.push({
        type: "raise",
        min: Math.min(state.bigBlind, player.chips),
        max: player.chips,
      });
      actions.push({ type: "allin", amount: player.chips });
    }
  }

  return actions;
}

export function isValidAction(
  state: GameState,
  userId: string,
  action: string,
  amount?: number,
): boolean {
  const available = getAvailableActions(state, userId);
  return available.some((a) => {
    if (a.type !== action) return false;
    if (action === "raise" || action === "allin") {
      if (amount === undefined) return false;
      if (a.min !== undefined && amount < a.min) return false;
      if (a.max !== undefined && amount > a.max) return false;
    }
    return true;
  });
}
