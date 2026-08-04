import { PlayerState, SidePot } from "./types.js";

export function calculateSidePots(players: PlayerState[]): SidePot[] {
  const activePlayers = players.filter((p) => !p.folded);
  const allInAmounts = [
    ...new Set(activePlayers.filter((p) => p.allIn).map((p) => p.totalBet)),
  ].sort((a, b) => a - b);

  if (allInAmounts.length === 0) {
    const contributions: Record<string, number> = {};
    let total = 0;
    for (const p of players) {
      if (p.totalBet > 0) contributions[p.userId] = p.totalBet;
      total += p.totalBet;
    }
    return [
      {
        amount: total,
        eligible: activePlayers.map((p) => p.userId),
        contributions,
      },
    ];
  }

  const pots: SidePot[] = [];
  let prevLevel = 0;

  for (const level of allInAmounts) {
    let amount = 0;
    const eligible: string[] = [];
    const contributions: Record<string, number> = {};

    for (const p of players) {
      const playerContribution =
        Math.min(p.totalBet, level) - Math.min(p.totalBet, prevLevel);
      amount += playerContribution;
      if (playerContribution > 0) contributions[p.userId] = playerContribution;
      if (!p.folded && p.totalBet >= level) {
        eligible.push(p.userId);
      }
    }

    if (amount > 0) {
      pots.push({ amount, eligible, contributions });
    }
    prevLevel = level;
  }

  // Remaining amount above the highest all-in
  const maxAllIn = allInAmounts[allInAmounts.length - 1];
  let remaining = 0;
  const eligible: string[] = [];
  const contributions: Record<string, number> = {};
  for (const p of players) {
    if (p.totalBet > maxAllIn) {
      const excess = p.totalBet - maxAllIn;
      remaining += excess;
      contributions[p.userId] = excess;
    }
    if (!p.folded && p.totalBet > maxAllIn) {
      eligible.push(p.userId);
    }
  }
  if (remaining > 0) {
    pots.push({ amount: remaining, eligible, contributions });
  }

  return pots;
}

// Returns each player's uncalled excess (the part no opponent matched) back
// to their stack and reports it, so settlement can distinguish refunds from
// real pot wins. Covers folded overbettors too, whose excess would otherwise
// form a pot with no eligible winner.
export function returnUncalledBets(
  players: PlayerState[],
): { userId: string; amount: number }[] {
  const refunds: { userId: string; amount: number }[] = [];
  for (const p of players) {
    if (p.totalBet <= 0) continue;
    let othersMax = 0;
    for (const o of players) {
      if (o.userId !== p.userId) othersMax = Math.max(othersMax, o.totalBet);
    }
    if (p.totalBet > othersMax) {
      const excess = p.totalBet - othersMax;
      p.totalBet -= excess;
      p.bet = Math.min(p.bet, p.totalBet);
      p.chips += excess;
      refunds.push({ userId: p.userId, amount: excess });
    }
  }
  return refunds;
}

export function isBettingRoundComplete(
  players: PlayerState[],
  currentBet: number,
): boolean {
  const active = players.filter((p) => !p.folded && !p.allIn);
  if (active.length === 0) return true;
  return active.every((p) => p.hasActed && p.bet === currentBet);
}
