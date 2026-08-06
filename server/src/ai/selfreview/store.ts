import { config } from "../../config.js";
import type { HandRecord } from "../profiling/types.js";
import type {
  BluffOutcome,
  CbetOutcome,
  HandSelfEvaluation,
} from "./evaluate.js";

export interface OutcomeStats {
  attempts: number;
  // Percentage 0-100; null when there are no attempts yet.
  successRate: number | null;
}

export interface SelfReviewView {
  // Derived table-image label, or null when the sample is inconclusive.
  tableImage: string | null;
  bluffs: OutcomeStats;
  cbets: OutcomeStats;
}

interface SelfStats {
  bluffOutcomes: BluffOutcome[];
  cbetOutcomes: CbetOutcome[];
}

const IMAGE_BUSTED = "多次诈唬被识破，形象偏松";
const IMAGE_TRUSTED = "近期诈唬屡屡得手";

function rateOf(outcomes: string[], success: string): OutcomeStats {
  const attempts = outcomes.length;
  if (attempts === 0) return { attempts: 0, successRate: null };
  const successes = outcomes.filter((o) => o === success).length;
  return {
    attempts,
    successRate: Math.round((successes / attempts) * 1000) / 10,
  };
}

// Per-room, purely in-memory self-review state for AI seats: a ring buffer of
// recent settled hands (recent table memory) and bounded outcome queues per
// AI (its own bluff/c-bet track record). Restart clears everything by design.
export class SelfReviewStore {
  private recentHands = new Map<string, HandRecord[]>();
  private selfStats = new Map<string, Map<string, SelfStats>>();

  // Called once per settled hand; shared by every AI's context.
  recordHand(roomId: string, record: HandRecord): void {
    let hands = this.recentHands.get(roomId);
    if (!hands) {
      hands = [];
      this.recentHands.set(roomId, hands);
    }
    hands.push(record);
    while (hands.length > config.aiRecentHandsWindow) hands.shift();
  }

  recordEvaluation(
    roomId: string,
    userId: string,
    evaluation: HandSelfEvaluation,
  ): void {
    if (!evaluation.bluff && !evaluation.cbet) return;
    let byUser = this.selfStats.get(roomId);
    if (!byUser) {
      byUser = new Map();
      this.selfStats.set(roomId, byUser);
    }
    let stats = byUser.get(userId);
    if (!stats) {
      stats = { bluffOutcomes: [], cbetOutcomes: [] };
      byUser.set(userId, stats);
    }
    if (evaluation.bluff) {
      stats.bluffOutcomes.push(evaluation.bluff);
      while (stats.bluffOutcomes.length > config.aiSelfStatsWindow)
        stats.bluffOutcomes.shift();
    }
    if (evaluation.cbet) {
      stats.cbetOutcomes.push(evaluation.cbet);
      while (stats.cbetOutcomes.length > config.aiSelfStatsWindow)
        stats.cbetOutcomes.shift();
    }
  }

  getRecentHands(roomId: string): HandRecord[] {
    return this.recentHands.get(roomId) ?? [];
  }

  // null means "no self-review data for this AI at this table yet"; callers
  // omit the field instead of sending empty stats.
  getSelfReview(roomId: string, userId: string): SelfReviewView | null {
    const stats = this.selfStats.get(roomId)?.get(userId);
    if (!stats) return null;
    const bluffs = rateOf(stats.bluffOutcomes, "success");
    let tableImage: string | null = null;
    if (bluffs.attempts >= 3 && bluffs.successRate !== null) {
      if (bluffs.successRate < 34) tableImage = IMAGE_BUSTED;
      else if (bluffs.successRate >= 67) tableImage = IMAGE_TRUSTED;
    }
    return {
      tableImage,
      bluffs,
      cbets: rateOf(stats.cbetOutcomes, "success"),
    };
  }

  clearRoom(roomId: string): void {
    this.recentHands.delete(roomId);
    this.selfStats.delete(roomId);
  }

  // Drop entries of users no longer seated, mirroring profileStore.pruneTo.
  pruneTo(roomId: string, keepUserIds: Set<string>): void {
    const byUser = this.selfStats.get(roomId);
    if (!byUser) return;
    for (const userId of byUser.keys()) {
      if (!keepUserIds.has(userId)) byUser.delete(userId);
    }
  }
}

export const selfReviewStore = new SelfReviewStore();
