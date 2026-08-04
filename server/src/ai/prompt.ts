import { GameState, Card, Suit } from "../poker/types.js";
import type { ProfileView } from "./profiling/types.js";

export const GTO_SYSTEM_PROMPT = `你是一名顶级无限注德州扑克 GTO（博弈论最优）策略引擎。你根据当前牌局局面输出唯一决策。请严格遵循以下策略框架与输出规范。

## 决策原则
1. 目标是长期期望值（EV）最大化，不追求单手输赢；接受 GTO 固有的波动。
2. 所有尺度以 BB（大盲注）为单位换算；筹码深度用 BB 数衡量。
3. 位置至关重要：越靠后位置范围越宽；翻后优先利用位置优势。
4. 尺度服务于范围：小尺度配高频持续下注（范围下注），大尺度配两极化范围（强牌+诈唬）。
5. 用底池赔率判断跟注：跟注成本 / (底池 + 跟注成本) 是所需胜率；听牌用补牌数×2（单街）/×4（双街）估算胜率。
6. 诈唬必须有清晰逻辑：阻断牌（blockers）、可代表的强牌故事线、对手范围中的可弃牌部分。不要随机诈唬。
7. 多人底池（3 人及以上）显著收紧：多人时边缘牌与弱听牌价值骤降，持续下注频率降低。
8. 永远不要慢打（slow play）到损失价值的程度；坚果牌在潮湿牌面应主动建池。

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
- 面对下注：用 MDF（最低防守频率 = 1 - 底池/(底池+下注)）约束自己不过度弃牌；强牌加注或跟注，边缘牌看赔率，空气弃牌。
- 位置：有位置时多过牌控池（pot control）打摊牌价值；无位置时避免用边缘牌打大底池，check-fold 是正当选择。
- 河牌：只做两件事——价值下注（对手更差的牌会跟）或诈唬（对手更好的牌会弃），没有中间地带。
- 多人底池：收紧所有范围，c-bet 只带真实价值或强听牌。

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

// Guidance shown alongside injected opponent profiles; keeps the GTO system
// prompt untouched while steering exploitative adjustments.
const OPPONENT_PROFILE_GUIDANCE =
  "opponentProfiles 是你对同桌对手积累的行为统计与风格评价（样本充足）。请在 GTO 基线上针对对手倾向调整：对紧手减少诈唬、加大价值下注尺度；对面对加注弃牌率高的对手增加施压频率；对爱抓诈唬（高进摊牌率）的对手减少河牌薄诈唬，只用强牌索取价值。若评价包含亮牌/摊牌行为观察（如多次亮出弱牌赢下底池），据此校准对其诈唬频率的判断。统计仅供参考，不要因单一数据过度偏离。";

// Assembles the AI-visible situation. Opponents' hole cards are NEVER
// included — mirrors the getStateForPlayer isolation guarantee.
export function buildDecisionContext(
  state: GameState,
  userId: string,
  profiles?: ProfileView[],
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

  // Profiles go first so the stable prefix within one hand can hit the
  // provider's context cache on repeated decision calls.
  const usable = (profiles ?? []).filter((p) => p.ready);
  if (usable.length === 0) return base;
  return {
    opponentProfileGuidance: OPPONENT_PROFILE_GUIDANCE,
    opponentProfiles: usable.map((p) => ({
      name: p.username,
      stats: p.stats,
      note: p.note ?? undefined,
    })),
    ...base,
  };
}
