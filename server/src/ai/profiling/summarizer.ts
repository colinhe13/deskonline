import { z } from "zod";
import { callLlm } from "../llm.client.js";
import { computeRates } from "./stats.js";
import type { HandRecord, OpponentProfile } from "./types.js";

export const PROFILE_SUMMARY_SYSTEM_PROMPT = `你是一名德州扑克对手分析助手。根据玩家近期手牌的公开行动记录与统计数据，总结该玩家的打牌风格。要求：
1. 只输出 JSON：{"summary": "..."}
2. summary 不超过 100 个汉字，只描述风格倾向（紧/松、凶/被动、诈唬频率、抓诈唬倾向、位置意识、价值下注尺度等）
3. 禁止出现任何具体底牌、公共牌牌面，禁止逐手复述牌局
4. 样本较少或特征不明显时给出保守描述，不得臆造`;

export const NOTE_MAX_CHARS = 120;

const summarySchema = z.object({ summary: z.string().min(1) });

function formatHand(index: number, record: HandRecord, userId: string): string {
  const lines = record.actions.map(
    (a) =>
      `${a.street}:${a.userId === userId ? "hero" : a.userId}:${a.action}${a.amount ? a.amount : ""}`,
  );
  const won = record.winners.find((w) => w.userId === userId);
  const outcome = won
    ? `won ${won.amount}`
    : record.showdownParticipantIds.includes(userId)
      ? "showdown lost"
      : "lost";
  return `hand${index}: ${lines.join(",")} | ${outcome}`;
}

export function buildSummaryInput(
  profile: OpponentProfile,
  recentRecords: HandRecord[],
): string {
  const hands = recentRecords
    .map((r, i) => formatHand(i + 1, r, profile.userId))
    .join("\n");
  return JSON.stringify(
    {
      stats: computeRates(profile.stats),
      recentHands: hands,
    },
    null,
    0,
  );
}

// Returns the new note text, or null on any failure (caller keeps old note).
export async function summarizeOpponent(
  profile: OpponentProfile,
  recentRecords: HandRecord[],
): Promise<string | null> {
  const parsed = await callLlm(
    PROFILE_SUMMARY_SYSTEM_PROMPT,
    buildSummaryInput(profile, recentRecords),
    { maxTokens: 300 },
  );
  if (!parsed) return null;
  const result = summarySchema.safeParse(parsed);
  if (!result.success) return null;
  const note = result.data.summary.trim().slice(0, NOTE_MAX_CHARS);
  return note.length > 0 ? note : null;
}
