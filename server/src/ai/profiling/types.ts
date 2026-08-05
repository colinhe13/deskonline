import type { StructuredAction } from "../../poker/types.js";

export interface HandRecord {
  actions: StructuredAction[];
  winners: { userId: string; amount: number }[];
  showdownParticipantIds: string[];
  // Public hand names (e.g. "两对 K 和 9") for revealed players: filled from
  // HandResult.handNames at showdown, extended later by voluntary reveals.
  // Never raw card faces.
  revealedHandNames: Record<string, string>;
  // Guards attachReveal: a reveal must only extend the hand it belongs to.
  handNumber: number;
}

// Raw counters; all rates are derived on read to avoid float drift.
export interface PlayerStats {
  hands: number;
  vpipHands: number;
  pfrHands: number;
  threeBetHands: number;
  threeBetOpps: number;
  postflopAggr: number;
  postflopCalls: number;
  foldToRaiseOpps: number;
  foldToRaiseFolds: number;
  foldToCbetOpps: number;
  foldToCbetFolds: number;
  showdownHands: number;
}

export interface OpponentProfile {
  userId: string;
  username: string;
  stats: PlayerStats;
  note: string | null;
  handsSinceLastSummary: number;
  lastUpdatedAt: string;
}

export interface StatsDto {
  hands: number;
  vpip: number | null;
  pfr: number | null;
  threeBet: number | null;
  af: number | null;
  foldToRaise: number | null;
  foldToCbet: number | null;
  wtsd: number | null;
}

export interface ProfileView {
  userId: string;
  username: string;
  isAi: boolean;
  hands: number;
  ready: boolean;
  stats: StatsDto | null;
  note: string | null;
}
