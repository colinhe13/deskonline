import { prisma } from "../../db/client.js";

// Lesson scope: null = global (injected into every persona), otherwise the
// owning persona slug. Caps and dedupe are enforced per scope, server-side —
// LLM output is never trusted directly.
export const LESSON_CAP_PER_SCOPE = 8;
export const LESSON_TEXT_MAX = 80;
export const LESSON_EVIDENCE_MAX = 60;
// Merged persona+global lessons actually injected into one decision prompt.
export const LESSON_INJECTION_MAX = 4;
export const SUMMARY_WINDOW_PER_USER = 50;

export interface LessonDraft {
  personaSlug: string | null;
  text: string;
  evidence: string;
}

export interface ActiveLesson {
  id: string;
  personaSlug: string | null;
  text: string;
  evidence: string;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeText(text: string): string {
  return text.replace(/[\s\p{P}]/gu, "");
}

export async function loadActiveLessons(): Promise<ActiveLesson[]> {
  const rows = await prisma.aiLesson.findMany({
    where: { status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    personaSlug: r.personaSlug,
    text: r.text,
    evidence: r.evidence,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

// Inserts validated lessons under their scope, skipping normalized-text
// duplicates, then retires the oldest overflow beyond the per-scope cap.
// Returns the rows actually created.
export async function insertLessons(
  drafts: LessonDraft[],
): Promise<ActiveLesson[]> {
  const inserted: ActiveLesson[] = [];
  for (const draft of drafts) {
    const text = draft.text.trim().slice(0, LESSON_TEXT_MAX);
    const evidence = draft.evidence.trim().slice(0, LESSON_EVIDENCE_MAX);
    if (!text) continue;
    const norm = normalizeText(text);
    // Linear scan within the scope (≤ cap + batch) keeps the dedupe check
    // free of DB-specific text-normalization functions.
    const actives = await prisma.aiLesson.findMany({
      where: { status: "active", personaSlug: draft.personaSlug },
      orderBy: { updatedAt: "desc" },
    });
    if (actives.some((l) => normalizeText(l.text) === norm)) continue;
    const row = await prisma.aiLesson.create({
      data: { personaSlug: draft.personaSlug, text, evidence },
    });
    inserted.push({
      id: row.id,
      personaSlug: row.personaSlug,
      text: row.text,
      evidence: row.evidence,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    const overflow = actives.length + 1 - LESSON_CAP_PER_SCOPE;
    if (overflow > 0) {
      const oldest = [...actives]
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .slice(0, overflow)
        .map((l) => l.id);
      await prisma.aiLesson.updateMany({
        where: { id: { in: oldest }, status: "active" },
        data: { status: "retired", retiredAt: new Date() },
      });
    }
  }
  return inserted;
}

// Retires only ids that are currently active; unknown or already-retired ids
// are ignored (the caller validated them against the reflection input).
export async function retireLessons(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await prisma.aiLesson.updateMany({
    where: { id: { in: ids }, status: "active" },
    data: { status: "retired", retiredAt: new Date() },
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// Hand-summary buffer: settle-time accumulation, boundary flush, window prune
// ---------------------------------------------------------------------------

export interface SummaryDraft {
  userId: string;
  position: string;
  boardTexture: string;
  streetReached: string;
  myBets: number;
  myRaises: number;
  facedBets: number;
  bluffed: string | null;
  cbet: string | null;
  netWon: number;
  wonAtShowdown: boolean;
  foldedToBet: boolean;
}

const pendingSummaries = new Map<string, SummaryDraft[]>();

export function accumulateSummary(roomId: string, draft: SummaryDraft): void {
  let list = pendingSummaries.get(roomId);
  if (!list) {
    list = [];
    pendingSummaries.set(roomId, list);
  }
  list.push(draft);
}

// Writes the room's pending rows, then prunes each affected user to the most
// recent SUMMARY_WINDOW_PER_USER rows. Snapshot-copy semantics identical to
// flushSelfStats: rows accumulated while the write is in flight survive; on
// failure the buffer is untouched and the next flush retries. Losing a few
// summaries on repeated failure is acceptable — they are reflection fodder,
// not accounting.
export async function flushSummaries(roomId: string): Promise<void> {
  const list = pendingSummaries.get(roomId);
  if (!list || list.length === 0) return;
  const snapshot = [...list];
  await prisma.aiHandSummary.createMany({ data: snapshot });
  pendingSummaries.set(roomId, list.slice(snapshot.length));
  if (pendingSummaries.get(roomId)?.length === 0)
    pendingSummaries.delete(roomId);
  const userIds = [...new Set(snapshot.map((d) => d.userId))];
  for (const userId of userIds) {
    const rows = await prisma.aiHandSummary.findMany({
      where: { userId },
      orderBy: [{ playedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const excess = rows.slice(SUMMARY_WINDOW_PER_USER).map((r) => r.id);
    if (excess.length > 0) {
      await prisma.aiHandSummary.deleteMany({
        where: { id: { in: excess } },
      });
    }
  }
}

export function clearSummariesRoom(roomId: string): void {
  pendingSummaries.delete(roomId);
}

export async function loadRecentSummaries(
  userIds: string[],
  take: number,
): Promise<Map<string, SummaryDraft[]>> {
  const out = new Map<string, SummaryDraft[]>();
  if (userIds.length === 0) return out;
  await Promise.all(
    userIds.map(async (userId) => {
      const rows = await prisma.aiHandSummary.findMany({
        where: { userId },
        orderBy: { playedAt: "desc" },
        take,
      });
      out.set(
        userId,
        rows.map((r) => ({
          userId: r.userId,
          position: r.position,
          boardTexture: r.boardTexture,
          streetReached: r.streetReached,
          myBets: r.myBets,
          myRaises: r.myRaises,
          facedBets: r.facedBets,
          bluffed: r.bluffed,
          cbet: r.cbet,
          netWon: r.netWon,
          wonAtShowdown: r.wonAtShowdown,
          foldedToBet: r.foldedToBet,
        })),
      );
    }),
  );
  return out;
}

// Debounce probe for the reflection cycle: how many rows landed since the
// last successful reflection?
export async function countSummariesSince(since: Date): Promise<number> {
  return prisma.aiHandSummary.count({ where: { playedAt: { gt: since } } });
}

// ---------------------------------------------------------------------------
// Process-wide lesson cache: the decision hot path never hits the DB
// ---------------------------------------------------------------------------

// null key = global scope.
const lessonCache = new Map<string | null, ActiveLesson[]>();

export function refreshLessonCache(lessons: ActiveLesson[]): void {
  lessonCache.clear();
  for (const lesson of lessons) {
    const list = lessonCache.get(lesson.personaSlug);
    if (list) list.push(lesson);
    else lessonCache.set(lesson.personaSlug, [lesson]);
  }
}

// Merged injection list for one persona: persona-specific lessons first
// (they encode style-tuned guidance), global lessons fill the rest. Caller
// applies the final count cap. Input order is updatedAt desc (load order).
export function cachedLessonsForPersona(slug: string): string[] {
  const own = lessonCache.get(slug) ?? [];
  const global = lessonCache.get(null) ?? [];
  return [...own, ...global].map((l) => l.text);
}

// Startup warm-up (Q4): the decision hot path must see persisted lessons
// immediately after a restart, not only after the first reflection cycle.
export async function preloadLessonCache(): Promise<void> {
  refreshLessonCache(await loadActiveLessons());
}

export function resetReflectionStoreForTests(): void {
  pendingSummaries.clear();
  lessonCache.clear();
}
