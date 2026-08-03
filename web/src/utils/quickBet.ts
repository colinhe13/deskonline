export interface QuickBetContext {
  pot: number;
  bigBlind: number;
  chips: number;
  playerBet: number;
  currentBet: number;
  minRaise: number;
}

// Target total wager: floor(pot * fraction / bigBlind) * bigBlind.
export function quickTarget(pot: number, bigBlind: number, fraction: number): number {
  if (!bigBlind || bigBlind <= 0) return 0;
  return Math.floor((pot * fraction) / bigBlind) * bigBlind;
}

// Chips the player must actually commit so their total bet equals the target.
export function quickCommit(ctx: QuickBetContext, fraction: number): number {
  return Math.max(0, quickTarget(ctx.pot, ctx.bigBlind, fraction) - ctx.playerBet);
}

// A quick bet is offered only when the target is a legal raise and the player
// can afford it.
export function canQuickBet(ctx: QuickBetContext, fraction: number): boolean {
  const target = quickTarget(ctx.pot, ctx.bigBlind, fraction);
  if (target < ctx.currentBet + ctx.minRaise) return false;
  const commit = target - ctx.playerBet;
  return commit > 0 && ctx.chips >= commit;
}
