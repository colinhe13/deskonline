import type { StructuredAction } from "../../poker/types.js";
import type { HandResult } from "../../poker/engine.js";
import type { HandRecord } from "./types.js";

export function buildHandRecord(
  history: StructuredAction[],
  result: HandResult,
): HandRecord {
  return {
    actions: [...history],
    winners: result.winners.map((w) => ({
      userId: w.userId,
      amount: w.amount,
    })),
    showdownParticipantIds: Object.keys(result.showdownCards),
  };
}
