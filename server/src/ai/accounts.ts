import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db/client.js";
import { config } from "../config.js";
import {
  bindUserPersona,
  ensureAiPersonas,
  personaForAccount,
  personaViewBySlug,
} from "./personas.js";
import { preloadLessonCache } from "./reflection/store.js";

export interface AiAccount {
  id: string;
  username: string;
}

export interface AiAccountOption {
  username: string;
  displayName: string;
  styleLabel: string;
  available: boolean;
}

export const RETIRED_AI_ACCOUNT_NAMES: ReadonlySet<string> = new Set([
  "AI_MeiLing",
  "AI_DaLiu",
]);

// userId -> isAi, populated by ensureAiAccounts and extended on demand.
const aiFlagCache = new Map<string, boolean>();
let pool: AiAccount[] = [];

function poolUsernames(): string[] {
  return config.aiAccounts
    .split(",")
    .map((s) => s.trim())
    .filter((username) => username.length > 0)
    .filter((username) => !RETIRED_AI_ACCOUNT_NAMES.has(username));
}

// Idempotent: creates missing pool accounts and marks them isAi. Called once
// at startup so deployment never needs a manual seed step. Accounts are bound
// to personas by stable account identity; unknown custom accounts fall back to
// pool order. Existing accounts missing a persona are backfilled.
export async function ensureAiAccounts(): Promise<void> {
  await ensureAiPersonas();
  const usernames = poolUsernames();
  for (let i = 0; i < usernames.length; i++) {
    const username = usernames[i];
    const seed = personaForAccount(username, i);
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
  try {
    await preloadLessonCache();
  } catch (err) {
    // Lessons are optional guidance; a preload failure degrades to
    // lesson-less prompts until the first successful reflection cycle.
    console.error("[ai][reflect] lesson preload failed", err);
  }
}

export function listAiAccounts(): AiAccount[] {
  return [...pool];
}

export function findAiAccount(username: string): AiAccount | null {
  return pool.find((account) => account.username === username) ?? null;
}

export function listAiAccountOptions(room: {
  findSeatByUserId(userId: string): unknown;
}): AiAccountOption[] {
  return pool.map((account, index) => {
    const seed = personaForAccount(account.username, index);
    const persona = personaViewBySlug(seed.slug);
    return {
      username: account.username,
      displayName: persona?.displayName ?? seed.displayName,
      styleLabel: persona?.styleLabel ?? seed.styleLabel,
      available: !room.findSeatByUserId(account.id),
    };
  });
}

export function isAiUserId(userId: string): boolean {
  return aiFlagCache.get(userId) === true;
}

// Returns a pool account not already seated in the given room, or null.
export function pickFreeAi(
  room: { findSeatByUserId(userId: string): unknown },
  username: string,
): AiAccount | null {
  const account = findAiAccount(username);
  if (!account || room.findSeatByUserId(account.id)) return null;
  return account;
}

export function resetAiStateForTests(): void {
  aiFlagCache.clear();
  pool = [];
}
