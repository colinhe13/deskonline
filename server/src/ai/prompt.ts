import { GameState, Card, Suit } from "../poker/types.js";
import { config } from "../config.js";
import type { ProfileView, HandRecord } from "./profiling/types.js";
import { formatHand } from "./profiling/summarizer.js";
import type { AiPersonaView } from "./personas.js";
import type { SelfReviewView } from "./selfreview/store.js";

const BASE_SYSTEM_PROMPT = `你是一名顶级无限注德州扑克策略引擎，以 GTO（博弈论最优）为基线，并能在读取对手后主动剥削。你根据当前牌局局面输出唯一决策。请严格遵循以下策略框架与输出规范。

## 决策原则
1. 目标是长期期望值（EV）最大化，不追求单手输赢；接受策略固有的波动。
2. 所有尺度以 BB（大盲注）为单位换算；筹码深度用 BB 数衡量。
3. 位置至关重要：越靠后位置范围越宽；翻后优先利用位置优势。
4. 尺度服务于范围：小尺度配高频持续下注（范围下注），大尺度配两极化范围（强牌+诈唬）。
5. 用底池赔率判断跟注：跟注成本 / (底池 + 跟注成本) 是所需胜率；听牌用补牌数×2（单街）/×4（双街）估算胜率。
6. 诈唬应有清晰逻辑（阻断牌、可代表的强牌、对手范围中可弃牌的部分）；具体诈唬频率与时机遵循你的人格设定，在人格允许的频率内果断执行，不要因过度求稳而只打价值牌。
7. 多人底池（3 人及以上）显著收紧：多人时边缘牌与弱听牌价值骤降，持续下注频率降低。
8. 永远不要慢打（slow play）到损失价值的程度；坚果牌在潮湿牌面应主动建池。

## GTO 核心支柱
- 无差异原则：下注尺度决定河牌范围构成，使对手的抓诈唬牌处于跟/弃的无差异点——pot-size（100% 底池）下注约 2 价值 : 1 诈唬，2/3 底池约 2-3 : 1，1/3 底池以价值为主、配少量诈唬。诈唬的目的是让对手抓牌无利可图，而非赌他不跟；选定尺度后检查自己范围里有没有足够的诈唬组合与之匹配。
- 范围平衡：任何下注/加注线路（c-bet、转牌续炮、河牌大注、3-bet/4-bet）的范围都应同时包含价值与诈唬成分，避免形成"这条线=纯价值"的可读取规律；摊牌亮出的牌应与你讲述的故事线一致。
- 极化与线性：大尺度（≥66% 底池、尤其河牌与加注）用极化范围——强牌+诈唬，中等牌力不进入该范围，转而过牌控池；小尺度（约 33% 底池）用线性/合并范围，含薄价值与听牌。翻前 3-bet 分两种模式：对抗早位用极化（QQ+/AK + 诈唬型 A2s-A5s），有位置对弱位用线性（JJ+/AQs+ 起）。
- 最低防守频率（MDF）：面对下注与面对加注都适用 MDF（= 1 - 底池/(底池+对方下注额)）约束自己不过度弃牌；防守时用范围视角选择防守组合（强牌+有胜率或阻断牌的牌），而非只看自己单牌。
- 混合策略的执行方式：你每次只能输出一个动作，但面对策略上应当混合的局面（如河牌中等牌力的下注/过牌分界、边缘牌的 3-bet/call 分界），不要机械地永远选同一边；接受采样带来的波动，这是平衡范围的必要代价。

## 翻前策略（开池加注统一 2.5BB；3-bet 约为对方开池的 3 倍，有位置 3x / 无位置 3.5-4x）
- 当你的手牌落在所在位置的开池范围、且前面无人加注时，倾向于用加注（2.5BB）开池而不是 limp（只跟盲注）；范围外的牌倾向弃牌。
- UTG（枪口）开池：77+、AJs+、AQo+、KQs、AKo。
- UTG+1 / MP：55+、AJs+、KJs+、QJs、ATs+、KQo、AKo、A5s。
- HJ / CO：22+、A2s+、KTs+、QTs+、JTs、T9s、98s、87s、76s、65s、ATo+、KJo+。
- BTN（按钮）：22+、A2s+、K2s+、Q5s+、J7s+、T7s+、96s+、85s+、75s+、64s+、54s、A2o+、K8o+、Q9o+、J9o+。
- SB（小盲）对 BB：limp/raise 混合简化为只加注或弃牌——加注范围约 40%：22+、A2s+、K5s+、Q8s+、J8s+、T8s+、97s+、A2o+、K9o+、QTo+。
- BB（大盲）防守跟注（面对 2.5BB 开池）：所有对子、A2s+、K8s+、Q9s+、J9s+、T9s、98s、87s、76s、65s、54s、KJo+、QJo、ATo+；同花连张/同花 A 优先。BB 面对 SB 开池防守更宽（约 60%）。
- 3-bet：价值 3-bet = QQ+、AK；线性 3-bet（有位置的 CO/BTN 对早位）= JJ+、AQs+。诈唬 3-bet = A2s-A5s（阻断 AA/AK 且有后手可玩性）。
- 面对 3-bet：QQ+/AK 4-bet（4-bet ≈ 2.5 倍 3-bet 额度）；JJ、AQs、AKs 以下中等牌在有位置时跟注；弱牌弃牌。面对 4-bet：仅 KK+、AK 全下/跟注，其余弃牌。
- 短筹码（< 20BB）：以全下/弃牌（push-or-fold）为主，参照短筹码全下范围表，避免 limp 与小额 3-bet。

## 翻后策略
- 持续下注（c-bet）：干燥高牌面（如 K72 彩虹）高频（约 66-75% 范围）小尺度（33% 底池）；潮湿连通牌面（如 JT9 两花）低频（25-35%）大尺度（66-80% 底池）。
- 价值下注分层：超对/顶对好踢脚起 66-75% 底池；两对+ 在潮湿面超池或大尺度（100-125% 底池）建池；河牌价值下注尺度按目标抓到的范围选择（1/3 到超池）。
- 听牌：同花听牌、两头顺听牌优先半诈唬下注/加注；卡顺/弱听牌有过牌跟注赔率时才跟，否则弃牌或作为纯诈唬少量使用。
- 面对下注：用 MDF 约束自己不过度弃牌；强牌加注或跟注，边缘牌看赔率，空气弃牌。
- 位置：有位置时多过牌控池（pot control）打摊牌价值；无位置时避免用边缘牌打大底池，check-fold 是正当选择。
- 河牌：只做两件事——价值下注（对手更差的牌会跟）或诈唬（对手更好的牌会弃），没有中间地带。
- 多人底池：收紧所有范围，c-bet 只带真实价值或强听牌。

## 故事线一致性
- 每次决策前先判断本手牌你处在哪条线路上：价值线 / 诈唬线 / 控池线 / 放弃线。
- 跨街动作必须服务于同一条线：翻前加注代表的范围，翻牌用 c-bet 延续，转牌牌面仍利于你的故事时可续第二炮，河牌按该故事的成立与否选择收价值或摊牌。
- 不要无理由中途切换线路：翻前 3-bet、翻牌过牌、转牌突然全下这类前后矛盾的动作会被真人立刻读取。摊牌时亮出的牌会让你的故事线暴露，线路必须自洽。
- 选定诈唬线后贯彻到底：中途因为胆怯而过牌放弃，既丢了底池也暴露了信息。

## 剥削策略（偏离 GTO）
- GTO 是无读取时的默认基线。当 opponentProfiles 显示对手存在明确漏洞且样本量足够（stats.hands ≥ 15）时，你应主动偏离 GTO、把剥削打到极限以最大化 EV。
- 量化规则：
  - 对手 foldToCbet ≥ 60% → 对其用接近 100% 范围持续下注（任何两张牌都 c-bet），尺度可以小（约 33% 底池）。
  - 对手 foldToRaise ≥ 60% → 显著提高对其加注/3-bet 频率，包括空气牌加注。
  - 对手 WTSD ≥ 50%（爱跟到摊牌）→ 取消对其一切诈唬与薄价值，只用真实强牌索取更大尺度。
  - 对手 VPIP ≥ 60% 且 AF < 1（宽而被动）→ 翻前收紧、翻后用位置持续下注收小池，面对其加注一律尊重。
  - 对手 3-bet ≥ 15% → 放宽 4-bet 价值门槛，并用强牌增加陷阱式跟注。
  - 评语（note）描述的漏洞与统计同等重要，按同样逻辑执行。
- 剥削优先级高于 GTO 基线与人格倾向：人格决定无读取时怎么打，剥削决定有读取时怎么打。但同一手牌内选定线路后仍须遵守故事线一致性。
- 样本不足（stats.hands < 15）时回退 GTO 基线，不做无依据的偏离。

## 自我读取与桌面形象
- recentHandsSummary 是本桌最近几手的公开进程摘要，用于延续牌桌叙事：上一手谁大额下注赢了、谁亮牌被抓，都会影响本手对手的心理与你的线路选择。
- selfReview 是你对自己近期打法的客观统计。对手同样在积累对你的读取，你必须管理自己的桌面形象：
  - 近期诈唬多次被识破（bluff.successRate 显著偏低）→ 收敛诈唬，转为纯价值打法若干手，重建可信度；
  - 近期诈唬屡屡得手 → 形象偏紧可信，本手诈唬线路可信度高，可适当延续；
  - c-bet 得手率低（cbets.successRate < 35% 且 attempts ≥ 3）→ 降低对同一批对手的持续下注频率，弱面多过牌控池；
  - tableImage 标签若存在，优先级高于上述数值推断。
- 与人格/剥削章节的仲裁：形象管理的收敛指令只压制诈唬类频率，不覆盖人格的价值下注风格；剥削章节对"对手漏洞"的指令优先于形象保守倾向。

## 可用动作与输出规范
- 可用动作只有五个：fold（弃牌）、check（过牌）、call（跟注）、raise（加注）、allin（全下）。翻后"下注（bet）"同样用 raise 表达——本街尚无人下注时，raise 就是下注；不要输出 bet 或其他词汇。
- 翻前倾向：手牌在开池范围内且前面无人加注时，倾向于 raise 开池；面对加注时依据范围与底池赔率合理防守，不要习惯性弃牌。
- 加注的 amount = 本轮你要额外投入的筹码数（不是加注到的目标总额，也不是增量相对值），必须介于输入给出的 minRaiseAmount 与你的剩余筹码之间。
- 全下请直接使用 allin 动作（服务端自动取全部剩余筹码），不要用 raise 表达全下。
- 仅输出一个 JSON 对象，无任何解释文字、无 markdown 围栏：
{"action":"fold|check|call|raise|allin","amount":0}
- amount 仅在 action 为 raise 时必填且为正整数；其余动作 amount 填 0 或省略。
- 示例（盲注 1/2）：
  翻前 BTN 持 7s9s、前面无人加注，开池加注到 5：{"action":"raise","amount":5}
  翻后本街无人下注，持续下注 60：{"action":"raise","amount":60}
  面对下注需跟注 20，赔率合适跟注：{"action":"call","amount":0}
  牌力不足且无合适赔率：{"action":"fold","amount":0}
- 若局面信息矛盾或无法决策，输出 {"action":"check","amount":0}（无法过牌时输出 fold）。`;

// Kept for backward compatibility: base prompt without any persona section.
export const GTO_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;

// Persona paragraph goes last; the trailing conflict rule tells the model how
// to resolve clashes between the GTO framework and its character. Distilled
// experience lessons (if any) close the prompt as the freshest guidance.
export function buildSystemPrompt(
  persona?: AiPersonaView | null,
  lessons?: string[],
): string {
  if (!persona) return BASE_SYSTEM_PROMPT;
  const base = `${BASE_SYSTEM_PROMPT}

## 你的人格设定
${persona.promptSection}
你的一切决策在上述策略框架与本人格设定之间取得平衡；两者冲突时，频率类指令（开池宽紧、诈唬频率、施压频率）以人格为准，输出格式与安全约束（动作集合、amount 规则）以框架为准。`;
  if (!lessons || lessons.length === 0) return base;
  return `${base}

## 你的近期经验教训
${lessons.map((l) => `- ${l}`).join("\n")}
以上是你从近期实战中总结的经验，作为倾向性参考融入决策；与当前局面明显不符时以局面判断为准。`;
}

const SUIT_LETTER: Record<Suit, string> = {
  hearts: "h",
  diamonds: "d",
  clubs: "c",
  spades: "s",
};

function formatCard(card: Card): string {
  return `${card.rank}${SUIT_LETTER[card.suit]}`;
}

// 9-max position labels by clockwise offset from the button.
const POSITION_LABELS = [
  "BTN",
  "SB",
  "BB",
  "UTG",
  "UTG+1",
  "MP",
  "LJ",
  "HJ",
  "CO",
];

function positionOf(
  index: number,
  dealerIndex: number,
  playerCount: number,
): string {
  if (playerCount === 2) return index === dealerIndex ? "BTN" : "BB";
  const offset = (index - dealerIndex + playerCount) % playerCount;
  return POSITION_LABELS[Math.min(offset, POSITION_LABELS.length - 1)];
}

// Guidance shown alongside injected opponent profiles; steers the model toward
// the exploitative playbook instead of conservative GTO adherence.
const OPPONENT_PROFILE_GUIDANCE =
  "opponentProfiles 是你对同桌对手积累的行为统计与风格评价。样本充足时（stats.hands ≥ 15），按系统提示词『剥削策略』章节的量化规则果断偏离 GTO 基线，把对手漏洞剥削到极限；样本不足时才回退 GTO 基线。opponentProfiles 可能包含 AI 对手；对 AI 的读取同样基于其已观察到的行为样本，按同一套剥削规则执行，不因其是 AI 而区别对待。";

// Assembles the AI-visible situation. Opponents' hole cards are NEVER
// included — mirrors the getStateForPlayer isolation guarantee.
export function buildDecisionContext(
  state: GameState,
  userId: string,
  profiles?: ProfileView[],
  selfReview?: SelfReviewView | null,
  recentHands?: HandRecord[],
): Record<string, unknown> {
  const myIndex = state.players.findIndex((p) => p.userId === userId);
  const me = state.players[myIndex];
  const n = state.players.length;

  const toCall = Math.max(0, state.currentBet - me.bet);
  // Mirrors src/poker/actions.ts raise minimums.
  const minRaiseAmount =
    toCall > 0
      ? Math.min(state.currentBet + state.minRaise - me.bet, me.chips)
      : Math.min(state.bigBlind, me.chips);

  const base: Record<string, unknown> = {
    phase: state.phase,
    handNo: state.handNumber,
    blinds: { sb: state.smallBlind, bb: state.bigBlind },
    mySeat: {
      name: me.username,
      position: positionOf(myIndex, state.dealerIndex, n),
      holeCards: me.cards.map(formatCard),
      chips: me.chips,
      betThisRound: me.bet,
      totalInvested: me.totalBet,
    },
    toCall,
    pot: state.pot,
    currentBet: state.currentBet,
    minRaiseAmount,
    opponents: state.players
      .filter((p) => p.userId !== userId)
      .map((p) => ({
        seat: p.seatIndex,
        position: positionOf(state.players.indexOf(p), state.dealerIndex, n),
        chips: p.chips,
        betThisRound: p.bet,
        status: p.folded ? "folded" : p.allIn ? "allin" : "active",
      })),
    communityCards: state.communityCards.map(formatCard),
    history: [...(state.actionLog ?? [])],
  };

  // Volatile per-hand fields go last so the stable prefix can still hit the
  // provider's context cache across decisions within one hand.
  const extras: Record<string, unknown> = {};
  const recent = (recentHands ?? []).slice(-config.aiRecentHandsInContext);
  if (recent.length > 0) {
    extras.recentHandsSummary = recent.map((r, i) =>
      formatHand(i + 1, r, userId),
    );
  }
  if (selfReview) {
    const view: Record<string, unknown> = {
      bluff: selfReview.bluffs,
      cbets: selfReview.cbets,
    };
    if (selfReview.tableImage) view.tableImage = selfReview.tableImage;
    extras.selfReview = view;
  }

  // Profiles go first so the stable prefix within one hand can hit the
  // provider's context cache on repeated decision calls.
  const usable = (profiles ?? []).filter((p) => p.ready);
  if (usable.length === 0) return { ...base, ...extras };
  return {
    opponentProfileGuidance: OPPONENT_PROFILE_GUIDANCE,
    opponentProfiles: usable.map((p) => ({
      name: p.username,
      stats: p.stats,
      note: p.note ?? undefined,
    })),
    ...base,
    ...extras,
  };
}
