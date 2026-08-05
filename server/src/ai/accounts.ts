import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db/client.js";
import { config } from "../config.js";
import {
  bindUserPersona,
  ensureAiPersonas,
  personaForPoolIndex,
  personaViewBySlug,
} from "./personas.js";

export interface AiAccount {
  id: string;
  username: string;
}

// userId -> isAi, populated by ensureAiAccounts and extended on demand.
const aiFlagCache = new Map<string, boolean>();
let pool: AiAccount[] = [];

function poolUsernames(): string[] {
  return config.aiAccounts
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Idempotent: creates missing pool accounts and marks them isAi. Called once
// at startup so deployment never needs a manual seed step. Accounts are bound
// to personas by pool order (index % seed count); existing accounts missing a
// persona are backfilled.
export async function ensureAiAccounts(): Promise<void> {
  await ensureAiPersonas();
  const usernames = poolUsernames();
  for (let i = 0; i < usernames.length; i++) {
    const username = usernames[i];
    const seed = personaForPoolIndex(i);
    const persona = personaViewBySlug(seed.slug);
    const existing = await prisma.user.findUnique({ where: { username } });
    if (!existing) {
      // Random password: AI accounts are never meant to be logged into.
      const hashed = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
      const created = await prisma.user.create({
        data: {
          username,
          password: hashed,
          isAi: true,
          personaId: persona?.id ?? null,
        },
      });
      pool.push({ id: created.id, username: created.username });
      aiFlagCache.set(created.id, true);
      if (persona) bindUserPersona(created.id, persona);
    } else {
      if (!existing.isAi || !existing.personaId) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            isAi: true,
            ...(existing.personaId ? {} : { personaId: persona?.id ?? null }),
          },
        });
      }
      pool.push({ id: existing.id, username: existing.username });
      aiFlagCache.set(existing.id, true);
      if (persona) bindUserPersona(existing.id, persona);
    }
  }
}

export function listAiAccounts(): AiAccount[] {
  return [...pool];
}

export function isAiUserId(userId: string): boolean {
  return aiFlagCache.get(userId) === true;
}

// Returns a pool account not already seated in the given room, or null.
export function pickFreeAi(room: {
  findSeatByUserId(userId: string): unknown;
}): AiAccount | null {
  for (const account of pool) {
    if (!room.findSeatByUserId(account.id)) return account;
  }
  return null;
}

export function resetAiStateForTests(): void {
  aiFlagCache.clear();
  pool = [];
}
