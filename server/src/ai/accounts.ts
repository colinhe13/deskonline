import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db/client.js";
import { config } from "../config.js";

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
// at startup so deployment never needs a manual seed step.
export async function ensureAiAccounts(): Promise<void> {
  for (const username of poolUsernames()) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (!existing) {
      // Random password: AI accounts are never meant to be logged into.
      const hashed = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
      const created = await prisma.user.create({
        data: { username, password: hashed, isAi: true },
      });
      pool.push({ id: created.id, username: created.username });
      aiFlagCache.set(created.id, true);
    } else {
      if (!existing.isAi) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { isAi: true },
        });
      }
      pool.push({ id: existing.id, username: existing.username });
      aiFlagCache.set(existing.id, true);
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
