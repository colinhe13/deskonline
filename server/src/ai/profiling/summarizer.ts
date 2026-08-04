import { z } from "zod";
import { config } from "../../config.js";
import { callLlm } from "../llm.client.js";
import { computeRates } from "./stats.js";
import type { HandRecord, OpponentProfile } from "./types.js";

export const PROFILE_SUMMARY_SYSTEM_PROMPT = `你是一名德州扑克对手分析助手。根据玩家近期手牌的公开行动记录与统计数据，总结该玩家的打牌风格。要求：
1. 只输出 JSON：{"summary": "..."}
2. summary 不超过 150 个汉字，且必须是完整句子（宁可少写也不要被截断），只描述风格倾向（紧/松、凶/被动、诈唬频率、抓诈唬倾向、位置意识、价值下注尺度等）；输入中若含亮牌/摊牌牌型，请结合行动推断其诈唬与价值下注倾向（如多次亮出弱牌却赢下底池说明诈唬成功率高）
3. 禁止出现任何具体底牌花色、公共牌牌面，禁止逐手复述牌局；允许引用输入中已公开的牌型名（如"两对"、"高牌 A"）
4. 样本较少或特征不明显时给出保守描述，不得臆造`;

export const NOTE_MAX_CHARS = 180;

const summarySchema = z.object({ summary: z.string().min(1) });

function formatHand(index: number, record: HandRecord, userId: string): string {
  const lines = record.actions.map(
    (a) =>
      `${a.street}:${a.userId === userId ? "hero" : a.userId}:${a.action}${a.amount ? a.amount : ""}`,
  );
  const won = record.winners.find((w) => w.userId === userId);
  let outcome = won
    ? `won ${won.amount}`
    : record.showdownParticipantIds.includes(userId)
      ? "showdown lost"
      : "lost";
  const handName = record.revealedHandNames[userId];
  if (handName) outcome += `，亮牌：${handName}`;
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
    { maxTokens: 300, timeoutMs: config.aiSummaryTimeoutMs },
  );
  if (!parsed) return null;
  const result = summarySchema.safeParse(parsed);
  if (!result.success) return null;
  const note = result.data.summary.trim().slice(0, NOTE_MAX_CHARS);
  return note.length > 0 ? note : null;
}
