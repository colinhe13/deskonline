import type { StructuredAction } from "../../poker/types.js";

export interface HandRecord {
  actions: StructuredAction[];
  winners: { userId: string; amount: number }[];
  showdownParticipantIds: string[];
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
