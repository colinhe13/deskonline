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
    // Hand names are already public at showdown; raw card faces stay excluded.
    revealedHandNames: { ...result.handNames },
  };
}
