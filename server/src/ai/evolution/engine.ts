import { prisma } from "../../db/client.js";
import { personaOfUser, applyEvolvedBluffHintRate } from "../personas.js";
import { loadSelfStats } from "../selfreview/persist.js";
import { nextBluffHintRate } from "./rules.js";

// Evolves one AI persona from its cross-match cumulative bluff record.
// Reads the persisted self stats, applies the bounded rule, writes the new
// baseline back to the persona row and refreshes the in-memory view so the
// decision hot path picks it up without a restart.
//
// Never throws: callers fire-and-forget and a DB failure simply leaves the
// previous baseline in place (evolution is lossless — the next cycle
// recomputes from the same cumulative counters).
export async function evolveAiUser(userId: string): Promise<void> {
  const persona = personaOfUser(userId);
  if (!persona) return;

  const statsMap = await loadSelfStats([userId]);
  const stats = statsMap.get(userId);
  const attempts = stats?.bluffAttempts ?? 0;
  const successes = stats?.bluffSuccess ?? 0;

  const next = nextBluffHintRate(
    persona.bluffHintRate,
    persona.seedBluffHintRate,
    { attempts, successes },
  );
  if (Math.abs(next - persona.bluffHintRate) < 1e-9) return;

  await prisma.aiPersona.update({
    where: { id: persona.id },
    data: { evolvedBluffHintRate: next, evolvedAt: new Date() },
  });
  applyEvolvedBluffHintRate(persona.slug, next);
  const rate = attempts > 0 ? successes / attempts : 0;
  console.log(
    `[ai][evolution] ${persona.slug} (${userId}) bluffRate ` +
      `${persona.bluffHintRate.toFixed(3)}→${next.toFixed(3)} ` +
      `(attempts=${attempts} rate=${rate.toFixed(2)})`,
  );
}
