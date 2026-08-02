import { PlayerState, SidePot } from "./types.js";

export function calculateSidePots(players: PlayerState[]): SidePot[] {
  const activePlayers = players.filter((p) => !p.folded);
  const allInAmounts = [...new Set(activePlayers.filter((p) => p.allIn).map((p) => p.totalBet))].sort(
    (a, b) => a - b,
  );

  if (allInAmounts.length === 0) {
    const total = players.reduce((sum, p) => sum + p.totalBet, 0);
    return [{ amount: total, eligible: activePlayers.map((p) => p.userId) }];
  }

  const pots: SidePot[] = [];
  let prevLevel = 0;

  for (const level of allInAmounts) {
    let amount = 0;
    const eligible: string[] = [];

    for (const p of players) {
      const playerContribution = Math.min(p.totalBet, level) - Math.min(p.totalBet, prevLevel);
      amount += playerContribution;
      if (!p.folded && p.totalBet >= level) {
        eligible.push(p.userId);
      }
    }

    if (amount > 0) {
      pots.push({ amount, eligible });
    }
    prevLevel = level;
  }

  // Remaining amount above the highest all-in
  const maxAllIn = allInAmounts[allInAmounts.length - 1];
  let remaining = 0;
  const eligible: string[] = [];
  for (const p of players) {
    if (p.totalBet > maxAllIn) {
      remaining += p.totalBet - maxAllIn;
    }
    if (!p.folded && p.totalBet > maxAllIn) {
      eligible.push(p.userId);
    }
  }
  if (remaining > 0) {
    pots.push({ amount: remaining, eligible });
  }

  return pots;
}

export function isBettingRoundComplete(players: PlayerState[], currentBet: number): boolean {
  const active = players.filter((p) => !p.folded && !p.allIn);
  if (active.length <= 1) return true;
  return active.every((p) => p.hasActed && p.bet === currentBet);
}
