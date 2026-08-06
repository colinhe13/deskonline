import { z } from "zod";
import { config } from "../../config.js";
import { callLlm } from "../llm.client.js";
import { allPersonaViews, personaBindings } from "../personas.js";
import { loadSelfStats } from "../selfreview/persist.js";
import {
  LESSON_EVIDENCE_MAX,
  LESSON_TEXT_MAX,
  SUMMARY_WINDOW_PER_USER,
  countSummariesSince,
  insertLessons,
  loadActiveLessons,
  loadRecentSummaries,
  refreshLessonCache,
  retireLessons,
  type LessonDraft,
  type SummaryDraft,
} from "./store.js";

// Server-wide material gate: below this many new summaries since the last
// reflection the LLM is never called (cost guardrail).
export const REFLECT_MIN_NEW_SUMMARIES = 10;
// Hard cap on lessons accepted from one reflection cycle.
export const REFLECT_LESSONS_PER_CYCLE = 3;
// Representative rows shown to the LLM per persona (stats carry the rest).
const REPRESENTATIVE_ROWS_PER_PERSONA = 3;

const REFLECT_SYSTEM_PROMPT = `你是一名德州扑克教练，负责复盘多名 AI 玩家（不同人格风格）的近期表现，并提炼可复用的经验笔记。

输入是服务端统计好的结论性数据：每个人格的累计行为统计（selfStats）、近期手牌摘要统计与代表性牌例（recent）、当前生效的全部经验笔记（existingLessons，含 id 与 scope）、各人格的风格说明（promptSection）。

任务：
1. 总结规律，新增经验笔记（最多 ${REFLECT_LESSONS_PER_CYCLE} 条）。每条包含：
   - scope："global"（与风格无关的通用牌理，所有人格共享）或具体人格 slug（只对该风格成立的建议）；
   - text：不超过 ${LESSON_TEXT_MAX} 字、简短可执行的策略倾向；
   - evidence：不超过 ${LESSON_EVIDENCE_MAX} 字的依据（引用输入中的统计数据）。
2. 审视 existingLessons，若有被数据证伪或明显冗余的，将其 id 放入 retireIds（只能填输入中出现过的 id）。

没有值得提炼的规律时输出空数组。只输出 JSON，不要任何解释：
{"lessons":[{"scope":"global|<slug>","text":"...","evidence":"..."}],"retireIds":["<id>"]}`;

const reflectionOutputSchema = z.object({
  lessons: z
    .array(
      z.object({
        scope: z.string(),
        text: z.string(),
        evidence: z.string(),
      }),
    )
    .default([]),
  retireIds: z.array(z.string()).default([]),
});

let reflecting = false;
// Debounce anchor: rows are only "new material" if they landed after the last
// reflection attempt. Null until the first successful attempt this process
// lifetime — then everything counts once.
let lastReflectionAt: Date | null = null;

interface PersonaMaterial {
  slug: string;
  displayName: string;
  styleLabel: string;
  promptSection: string;
  users: number;
  selfStats: {
    bluffAttempts: number;
    bluffSuccess: number;
    cbetAttempts: number;
    cbetSuccess: number;
  };
  recent: {
    samples: number;
    bluffAttempts: number;
    bluffSuccess: number;
    cbetAttempts: number;
    cbetSuccess: number;
    netWon: number;
    wonAtShowdown: number;
    wonWithoutShowdown: number;
    foldedToBet: number;
  };
  representative: SummaryDraft[];
}

function summarizeRows(rows: SummaryDraft[]): PersonaMaterial["recent"] {
  const stats = {
    samples: rows.length,
    bluffAttempts: 0,
    bluffSuccess: 0,
    cbetAttempts: 0,
    cbetSuccess: 0,
    netWon: 0,
    wonAtShowdown: 0,
    wonWithoutShowdown: 0,
    foldedToBet: 0,
  };
  for (const row of rows) {
    if (row.bluffed) {
      stats.bluffAttempts += 1;
      if (row.bluffed === "success") stats.bluffSuccess += 1;
    }
    if (row.cbet) {
      stats.cbetAttempts += 1;
      if (row.cbet === "success") stats.cbetSuccess += 1;
    }
    stats.netWon += row.netWon;
    if (row.wonAtShowdown) stats.wonAtShowdown += 1;
    else if (row.netWon > 0) stats.wonWithoutShowdown += 1;
    if (row.foldedToBet) stats.foldedToBet += 1;
  }
  return stats;
}

// Round-robin pick so one prolific user cannot crowd out the others.
function pickRepresentative(perUser: SummaryDraft[][]): SummaryDraft[] {
  const picked: SummaryDraft[] = [];
  let cursor = 0;
  while (picked.length < REPRESENTATIVE_ROWS_PER_PERSONA) {
    let advanced = false;
    for (const rows of perUser) {
      if (
        cursor < rows.length &&
        picked.length < REPRESENTATIVE_ROWS_PER_PERSONA
      ) {
        picked.push(rows[cursor]);
        advanced = true;
      }
    }
    if (!advanced) break;
    cursor += 1;
  }
  return picked;
}

async function buildMaterial(): Promise<{
  personas: PersonaMaterial[];
  lessonIds: Set<string>;
  userContent: Record<string, unknown>;
}> {
  const personas = allPersonaViews();
  const bindings = personaBindings();
  const usersBySlug = new Map<string, string[]>();
  for (const [userId, persona] of bindings) {
    const list = usersBySlug.get(persona.slug) ?? [];
    list.push(userId);
    usersBySlug.set(persona.slug, list);
  }
  const allUserIds = [...bindings.keys()];

  const [selfStats, summariesByUser, activeLessons] = await Promise.all([
    loadSelfStats(allUserIds),
    loadRecentSummaries(allUserIds, SUMMARY_WINDOW_PER_USER),
    loadActiveLessons(),
  ]);

  const materials: PersonaMaterial[] = personas.map((persona) => {
    const userIds = usersBySlug.get(persona.slug) ?? [];
    const perUser = userIds.map((id) => summariesByUser.get(id) ?? []);
    const rows = perUser.flat();
    const self = {
      bluffAttempts: 0,
      bluffSuccess: 0,
      cbetAttempts: 0,
      cbetSuccess: 0,
    };
    for (const id of userIds) {
      const s = selfStats.get(id);
      if (!s) continue;
      self.bluffAttempts += s.bluffAttempts;
      self.bluffSuccess += s.bluffSuccess;
      self.cbetAttempts += s.cbetAttempts;
      self.cbetSuccess += s.cbetSuccess;
    }
    return {
      slug: persona.slug,
      displayName: persona.displayName,
      styleLabel: persona.styleLabel,
      promptSection: persona.promptSection,
      users: userIds.length,
      selfStats: self,
      recent: summarizeRows(rows),
      representative: pickRepresentative(perUser),
    };
  });

  return {
    personas: materials,
    lessonIds: new Set(activeLessons.map((l) => l.id)),
    userContent: {
      personas: materials,
      existingLessons: activeLessons.map((l) => ({
        id: l.id,
        scope: l.personaSlug ?? "global",
        text: l.text,
      })),
    },
  };
}

// Every rule is server-side: the LLM only proposes. Any violation (too many
// lessons, overlong fields, unknown scope, retireIds outside the provided
// set, schema mismatch) discards the whole output — nothing is written.
function validateOutput(
  raw: Record<string, unknown>,
  validScopes: ReadonlySet<string>,
  providedIds: ReadonlySet<string>,
): { drafts: LessonDraft[]; retireIds: string[] } | null {
  const parsed = reflectionOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { lessons, retireIds } = parsed.data;
  if (lessons.length > REFLECT_LESSONS_PER_CYCLE) return null;
  if (retireIds.some((id) => !providedIds.has(id))) return null;
  const drafts: LessonDraft[] = [];
  for (const lesson of lessons) {
    if (!validScopes.has(lesson.scope)) return null;
    const text = lesson.text.trim();
    const evidence = lesson.evidence.trim();
    if (!text || text.length > LESSON_TEXT_MAX) return null;
    if (evidence.length > LESSON_EVIDENCE_MAX) return null;
    drafts.push({
      personaSlug: lesson.scope === "global" ? null : lesson.scope,
      text,
      evidence,
    });
  }
  return { drafts, retireIds };
}

// One server-wide reflection cycle. Fire-and-forget from the lobby hand
// counter; the single-slot lock makes overlapping triggers a no-op.
export async function reflectAll(): Promise<void> {
  if (!config.aiReflectionEnabled) return;
  if (reflecting) {
    console.info("[ai][reflect] 上一轮未完成，跳过");
    return;
  }
  reflecting = true;
  try {
    const newCount = await countSummariesSince(lastReflectionAt ?? new Date(0));
    if (newCount === 0) {
      console.info("[ai][reflect] 跳过：上次反思后无新素材");
      return;
    }
    if (newCount < REFLECT_MIN_NEW_SUMMARIES) {
      console.info(
        `[ai][reflect] 跳过：新素材 ${newCount} 条 < ${REFLECT_MIN_NEW_SUMMARIES}`,
      );
      return;
    }
    const material = await buildMaterial();
    const validScopes = new Set(material.personas.map((p) => p.slug));
    validScopes.add("global");
    // Material is consumed whether or not the LLM succeeds: advancing the
    // anchor here means a failed cycle is not retried against the same rows.
    lastReflectionAt = new Date();

    const raw = await callLlm(
      REFLECT_SYSTEM_PROMPT,
      JSON.stringify(material.userContent),
      { maxTokens: 500, temperature: 0.2 },
    );
    if (!raw) {
      console.error("[ai][reflect] LLM 无响应，本轮丢弃");
      return;
    }
    const validated = validateOutput(raw, validScopes, material.lessonIds);
    if (!validated) {
      console.error("[ai][reflect] 输出非法，整体丢弃不写库");
      return;
    }
    const inserted = await insertLessons(validated.drafts);
    const retired = await retireLessons(validated.retireIds);
    refreshLessonCache(await loadActiveLessons());
    const globalCount = inserted.filter((l) => l.personaSlug === null).length;
    console.info(
      `[ai][reflect] 新增 ${inserted.length} 条（全局 ${globalCount} / 人格 ${
        inserted.length - globalCount
      }）淘汰 ${retired} 条`,
    );
  } catch (err) {
    // DB or aggregation failure: skip this cycle; the lesson cache keeps its
    // last good read so decisions degrade gracefully.
    console.error("[ai][reflect] 本轮失败，跳过", err);
  } finally {
    reflecting = false;
  }
}

export function setReflectionStateForTests(state: {
  reflecting?: boolean;
  lastReflectionAt?: Date | null;
}): void {
  if (state.reflecting !== undefined) reflecting = state.reflecting;
  if (state.lastReflectionAt !== undefined)
    lastReflectionAt = state.lastReflectionAt;
}

export function resetReflectionEngineForTests(): void {
  reflecting = false;
  lastReflectionAt = null;
}
