import { describe, it, expect } from "vitest";
import { evaluateHand, compareHands } from "../poker/evaluator.js";
import { Card, HandRank } from "../poker/types.js";

function c(rank: string, suit: string): Card {
  return { rank: rank as Card["rank"], suit: suit as Card["suit"] };
}

describe("evaluator", () => {
  it("identifies royal flush", () => {
    const cards = [c("A", "spades"), c("K", "spades"), c("Q", "spades"), c("J", "spades"), c("10", "spades"), c("2", "hearts"), c("3", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.RoyalFlush);
  });

  it("identifies straight flush", () => {
    const cards = [c("9", "hearts"), c("8", "hearts"), c("7", "hearts"), c("6", "hearts"), c("5", "hearts"), c("K", "spades"), c("2", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.StraightFlush);
    expect(result.kickers[0]).toBe(9);
  });

  it("identifies four of a kind", () => {
    const cards = [c("K", "spades"), c("K", "hearts"), c("K", "diamonds"), c("K", "clubs"), c("A", "spades"), c("2", "hearts"), c("3", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.FourOfAKind);
    expect(result.kickers[0]).toBe(13);
  });

  it("identifies full house", () => {
    const cards = [c("Q", "spades"), c("Q", "hearts"), c("Q", "diamonds"), c("J", "clubs"), c("J", "spades"), c("2", "hearts"), c("3", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.FullHouse);
    expect(result.kickers).toEqual([12, 11]);
  });

  it("identifies flush", () => {
    const cards = [c("A", "clubs"), c("J", "clubs"), c("8", "clubs"), c("6", "clubs"), c("2", "clubs"), c("K", "spades"), c("Q", "hearts")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.Flush);
  });

  it("identifies straight", () => {
    const cards = [c("9", "spades"), c("8", "hearts"), c("7", "diamonds"), c("6", "clubs"), c("5", "spades"), c("K", "hearts"), c("2", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.Straight);
    expect(result.kickers[0]).toBe(9);
  });

  it("identifies wheel straight A-2-3-4-5", () => {
    const cards = [c("A", "spades"), c("2", "hearts"), c("3", "diamonds"), c("4", "clubs"), c("5", "spades"), c("K", "hearts"), c("Q", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.Straight);
    expect(result.kickers[0]).toBe(5);
  });

  it("identifies three of a kind", () => {
    const cards = [c("7", "spades"), c("7", "hearts"), c("7", "diamonds"), c("A", "clubs"), c("K", "spades"), c("2", "hearts"), c("3", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.ThreeOfAKind);
    expect(result.kickers[0]).toBe(7);
  });

  it("identifies two pair", () => {
    const cards = [c("J", "spades"), c("J", "hearts"), c("5", "diamonds"), c("5", "clubs"), c("A", "spades"), c("2", "hearts"), c("3", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.TwoPair);
    expect(result.kickers[0]).toBe(11);
    expect(result.kickers[1]).toBe(5);
  });

  it("identifies one pair", () => {
    const cards = [c("10", "spades"), c("10", "hearts"), c("A", "diamonds"), c("K", "clubs"), c("8", "spades"), c("2", "hearts"), c("3", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.OnePair);
    expect(result.kickers[0]).toBe(10);
  });

  it("identifies high card", () => {
    const cards = [c("A", "spades"), c("K", "hearts"), c("9", "diamonds"), c("7", "clubs"), c("5", "spades"), c("3", "hearts"), c("2", "diamonds")];
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.HighCard);
    expect(result.kickers[0]).toBe(14);
  });

  it("compares hands correctly - higher rank wins", () => {
    const flush = evaluateHand([c("A", "clubs"), c("J", "clubs"), c("8", "clubs"), c("6", "clubs"), c("2", "clubs"), c("K", "spades"), c("Q", "hearts")]);
    const straight = evaluateHand([c("9", "spades"), c("8", "hearts"), c("7", "diamonds"), c("6", "clubs"), c("5", "spades"), c("K", "hearts"), c("2", "diamonds")]);
    expect(compareHands(flush, straight)).toBeGreaterThan(0);
  });

  it("compares same rank by kickers", () => {
    const pairK = evaluateHand([c("K", "spades"), c("K", "hearts"), c("A", "diamonds"), c("9", "clubs"), c("7", "spades"), c("3", "hearts"), c("2", "diamonds")]);
    const pairQ = evaluateHand([c("Q", "spades"), c("Q", "hearts"), c("A", "diamonds"), c("9", "clubs"), c("7", "spades"), c("3", "hearts"), c("2", "diamonds")]);
    expect(compareHands(pairK, pairQ)).toBeGreaterThan(0);
  });
});
