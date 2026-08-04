export interface QuickBetContext {
  pot: number;
  bigBlind: number;
  chips: number;
  playerBet: number;
  currentBet: number;
  minRaise: number;
}

// Keep the editable input as text until submission, but only allow safe
// integer amounts into the action payload.
export function parseIntegerAmount(value: string): number | null {
  if (value.trim() === "") return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

// Convert a target total wager into the chips this player must add now.
export function targetCommit(ctx: QuickBetContext, target: number): number {
  return Math.max(0, target - ctx.playerBet);
}

// Preflop sizing is expressed in big blinds rather than the tiny blind pot.
export function bbTarget(bigBlind: number, multiplier: number): number {
  if (
    !Number.isFinite(bigBlind) ||
    bigBlind <= 0 ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0
  ) {
    return 0;
  }
  return Math.floor(bigBlind * multiplier);
}

export function canTargetBet(ctx: QuickBetContext, target: number): boolean {
  if (!Number.isSafeInteger(target)) return false;
  if (target < ctx.currentBet + ctx.minRaise) return false;
  const commit = targetCommit(ctx, target);
  return commit > 0 && ctx.chips >= commit;
}

// Target total wager: floor(pot * fraction / bigBlind) * bigBlind.
export function quickTarget(
  pot: number,
  bigBlind: number,
  fraction: number,
): number {
  if (!bigBlind || bigBlind <= 0) return 0;
  return Math.floor((pot * fraction) / bigBlind) * bigBlind;
}

// Chips the player must actually commit so their total bet equals the target.
export function quickCommit(ctx: QuickBetContext, fraction: number): number {
  return targetCommit(ctx, quickTarget(ctx.pot, ctx.bigBlind, fraction));
}

// A quick bet is offered only when the target is a legal raise and the player
// can afford it.
export function canQuickBet(ctx: QuickBetContext, fraction: number): boolean {
  const target = quickTarget(ctx.pot, ctx.bigBlind, fraction);
  return canTargetBet(ctx, target);
}
