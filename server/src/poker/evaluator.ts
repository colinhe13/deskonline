import { Card, HandRank, HandResult } from "./types.js";
import { rankValue } from "./deck.js";

export function evaluateHand(cards: Card[]): HandResult {
  if (cards.length < 5) throw new Error("Need at least 5 cards");

  const combos = combinations(cards, 5);
  let best: HandResult | null = null;

  for (const combo of combos) {
    const result = evaluate5(combo);
    if (!best || compareHands(result, best) > 0) {
      best = result;
    }
  }

  return best!;
}

export function compareHands(a: HandResult, b: HandResult): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < a.kickers.length; i++) {
    if (a.kickers[i] !== b.kickers[i]) return a.kickers[i] - b.kickers[i];
  }
  return 0;
}

function evaluate5(cards: Card[]): HandResult {
  const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);
  const isStraight = checkStraight(values);
  const straightHigh = isStraight ? getStraightHigh(values) : 0;

  const counts = getValueCounts(values);

  if (isFlush && isStraight && straightHigh === 14) {
    return { rank: HandRank.RoyalFlush, bestCards: cards, kickers: [14] };
  }
  if (isFlush && isStraight) {
    return { rank: HandRank.StraightFlush, bestCards: cards, kickers: [straightHigh] };
  }
  if (counts[0]?.count === 4) {
    return { rank: HandRank.FourOfAKind, bestCards: cards, kickers: [counts[0].value, counts[1].value] };
  }
  if (counts[0]?.count === 3 && counts[1]?.count === 2) {
    return { rank: HandRank.FullHouse, bestCards: cards, kickers: [counts[0].value, counts[1].value] };
  }
  if (isFlush) {
    return { rank: HandRank.Flush, bestCards: cards, kickers: values };
  }
  if (isStraight) {
    return { rank: HandRank.Straight, bestCards: cards, kickers: [straightHigh] };
  }
  if (counts[0]?.count === 3) {
    const kickers = counts.filter((c) => c.count === 1).map((c) => c.value).sort((a, b) => b - a);
    return { rank: HandRank.ThreeOfAKind, bestCards: cards, kickers: [counts[0].value, ...kickers] };
  }
  if (counts[0]?.count === 2 && counts[1]?.count === 2) {
    const pairs = [counts[0].value, counts[1].value].sort((a, b) => b - a);
    const kicker = counts[2].value;
    return { rank: HandRank.TwoPair, bestCards: cards, kickers: [...pairs, kicker] };
  }
  if (counts[0]?.count === 2) {
    const kickers = counts.filter((c) => c.count === 1).map((c) => c.value).sort((a, b) => b - a);
    return { rank: HandRank.OnePair, bestCards: cards, kickers: [counts[0].value, ...kickers] };
  }
  return { rank: HandRank.HighCard, bestCards: cards, kickers: values };
}

function checkStraight(values: number[]): boolean {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.length < 5) return false;

  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i] - unique[i + 4] === 4) return true;
  }
  // Wheel: A-2-3-4-5
  if (unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5)) {
    return true;
  }
  return false;
}

function getStraightHigh(values: number[]): number {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i] - unique[i + 4] === 4) return unique[i];
  }
  // Wheel
  return 5;
}

function getValueCounts(values: number[]): { value: number; count: number }[] {
  const map = new Map<number, number>();
  for (const v of values) {
    map.set(v, (map.get(v) || 0) + 1);
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
}

function combinations(cards: Card[], k: number): Card[][] {
  const result: Card[][] = [];
  function helper(start: number, combo: Card[]) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      combo.push(cards[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

export function rankDisplayName(value: number): string {
  switch (value) {
    case 14:
      return "A";
    case 13:
      return "K";
    case 12:
      return "Q";
    case 11:
      return "J";
    default:
      return String(value);
  }
}

export function describeHand(hand: HandResult): string {
  const k = hand.kickers;
  switch (hand.rank) {
    case HandRank.RoyalFlush:
      return "皇家同花顺";
    case HandRank.StraightFlush:
      return "同花顺";
    case HandRank.FourOfAKind:
      return `四条 ${rankDisplayName(k[0])}`;
    case HandRank.FullHouse:
      return `葫芦 ${rankDisplayName(k[0])} 带 ${rankDisplayName(k[1])}`;
    case HandRank.Flush:
      return "同花";
    case HandRank.Straight:
      return "顺子";
    case HandRank.ThreeOfAKind:
      return `三条 ${rankDisplayName(k[0])}`;
    case HandRank.TwoPair:
      return `两对 ${rankDisplayName(k[0])} 和 ${rankDisplayName(k[1])}`;
    case HandRank.OnePair:
      return `一对 ${rankDisplayName(k[0])}`;
    case HandRank.HighCard:
      return `高牌 ${rankDisplayName(k[0])}`;
    default:
      return "";
  }
}
