import { prisma } from "../db/client.js";

export interface AiPersonaView {
  id: string;
  slug: string;
  displayName: string;
  styleLabel: string;
  promptSection: string;
  temperature: number;
  bluffHintRate: number;
}

export type PersonaSeed = Omit<AiPersonaView, "id">;

// Code is the source of truth for seeds; the DB is the runtime config that
// can be tweaked via SQL without a redeploy. ensureAiPersonas overwrites
// existing rows by slug (review decision: 覆盖更新).
// Keep profiling/aiNote.ts personaNoteBySlug in sync when editing persona
// text — it is a second description source for the same six personas.
export const PERSONA_SEEDS: PersonaSeed[] = [
  {
    slug: "tight-aggressive",
    displayName: "紧凶",
    styleLabel: "TAG",
    temperature: 0.5,
    bluffHintRate: 0.08,
    promptSection: `你是一名紧凶（TAG）玩家。你只玩很少的手牌但执行果断：开池与防守范围比基线收紧约 10-15%，边缘牌面对大注果断弃牌，绝不留恋。一旦入池就打得有侵略性：c-bet 频率高、价值下注尺度偏大（66-100% 底池），不给对手便宜看牌。你的诈唬频率低（约 8%），但每次诈唬都配有阻断牌与完整故事线，一旦出手极难被识破。你几乎从不慢打。`,
  },
  {
    slug: "loose-aggressive",
    displayName: "松凶",
    styleLabel: "LAG",
    temperature: 0.9,
    bluffHintRate: 0.3,
    promptSection: `你是一名松凶（LAG）玩家。你的开池与 3-bet 范围比基线宽约 20%，喜欢主动制造压力：c-bet 频率高，转牌敢于续第二炮，河牌在有利于你代表范围的牌面上敢于开第三枪。你的诈唬频率高（约 30%），偏爱用位置和主动权赢下底池，接受大波动。但你不乱来——每次诈唬都有可代表的故事线，绝不无目的地乱押。`,
  },
  {
    slug: "calling-station",
    displayName: "跟注站",
    styleLabel: "STATION",
    temperature: 0.7,
    bluffHintRate: 0.05,
    promptSection: `你是一名松被动的跟注站。你喜欢跟注看牌，很少主动加注或诈唬（诈唬频率约 5%）：面对中小尺度下注，你倾向于用边缘牌与听牌跟注而不是加注或弃牌。你的边缘牌很难被小注赶跑，只有真正的大注才会让你弃掉中等牌力。拿到坚果时你偶尔慢打，诱使对手继续诈唬。你在河牌几乎从不加注——一旦加注基本是强牌。`,
  },
  {
    slug: "maniac",
    displayName: "疯狂型",
    styleLabel: "MANIAC",
    temperature: 1.0,
    bluffHintRate: 0.4,
    promptSection: `你是一名疯狂型（Maniac）玩家。你的开池范围极宽，频繁 3-bet，敢于多条街纯诈唬与超池施压。你的诈唬频率极高（约 40%），愿意为了讲完一个故事线押上全部筹码。你的打法波动极大，偶有过度激进的失误——但这正是你的风格：让同桌所有人时刻提心吊胆，没人能准确读取你。`,
  },
  {
    slug: "nit-rock",
    displayName: "岩石",
    styleLabel: "NIT",
    temperature: 0.4,
    bluffHintRate: 0.02,
    promptSection: `你是一名极紧被动的岩石。你只玩顶级起手牌（约前 10%），中等牌宁愿跟注也不加注，几乎从不诈唬（诈唬频率约 2%）。你不主动建造大底池，面对不确定的局面宁可过牌控池。但一旦你主动大注或加注，基本是真牌——你极少出手的激进动作本身就有极强可信度，对手不敢轻视。`,
  },
  {
    slug: "balanced",
    displayName: "均衡型",
    styleLabel: "BALANCED",
    temperature: 0.6,
    bluffHintRate: 0.15,
    promptSection: `你是一名均衡型玩家，最接近 GTO 基线。你的范围在价值与诈唬之间保持平衡：开池、c-bet、3-bet 都包含两类成分，尺度规范——小尺度线性、大尺度极化。你的诈唬频率适中（约 15%），既不保守也不疯狂，并优先根据对手画像读取动态调整。你是整桌的参照风格。`,
  },
];

// Account identity is stable even when the active pool is shortened or
// reordered. Keep this separate from PERSONA_SEEDS so disabled accounts can
// remain in the database without shifting the personas of active accounts.
const PERSONA_SLUG_BY_ACCOUNT: Record<string, string> = {
  AI_XiaoZhi: "tight-aggressive",
  AI_LaoWang: "loose-aggressive",
  AI_MeiLing: "calling-station",
  AI_XiaoMei: "maniac",
  AI_DaLiu: "nit-rock",
  AI_AQiang: "balanced",
};

const personaBySlug = new Map<string, AiPersonaView>();
const personaByUserId = new Map<string, AiPersonaView>();

// Idempotent startup seed: upsert by slug, overwriting all fields so a redeploy
// refreshes persona text. Called from ensureAiAccounts.
export async function ensureAiPersonas(): Promise<Map<string, AiPersonaView>> {
  for (const seed of PERSONA_SEEDS) {
    const { slug, ...fields } = seed;
    const row = await prisma.aiPersona.upsert({
      where: { slug },
      update: fields,
      create: seed,
    });
    personaBySlug.set(row.slug, row);
  }
  return personaBySlug;
}

export function personaForPoolIndex(index: number): PersonaSeed {
  return PERSONA_SEEDS[index % PERSONA_SEEDS.length];
}

export function personaForAccount(
  username: string,
  poolIndex: number,
): PersonaSeed {
  const slug = PERSONA_SLUG_BY_ACCOUNT[username];
  return (
    PERSONA_SEEDS.find((seed) => seed.slug === slug) ??
    personaForPoolIndex(poolIndex)
  );
}

export function personaViewBySlug(slug: string): AiPersonaView | undefined {
  return personaBySlug.get(slug);
}

export function bindUserPersona(userId: string, persona: AiPersonaView): void {
  personaByUserId.set(userId, persona);
}

// Synchronous lookup used on the hot decision path — never hits the DB.
export function personaOfUser(userId: string): AiPersonaView | null {
  return personaByUserId.get(userId) ?? null;
}

export function resetPersonasForTests(): void {
  personaBySlug.clear();
  personaByUserId.clear();
}
