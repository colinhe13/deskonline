import { describe, it, expect } from "vitest";
import { PokerEngine } from "../poker/engine.js";

function makeEngine(
  playerCount: number,
  dealerIndex = 0,
  chips: number | number[] = 1000,
  aiFlags: boolean[] = [],
) {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    userId: `u${i}`,
    username: `P${i}`,
    seatIndex: i,
    chips: typeof chips === "number" ? chips : (chips[i] ?? 1000),
    isAi: aiFlags[i] ?? false,
  }));
  const broadcasts: { type: string; payload: unknown }[] = [];
  const engine = new PokerEngine(
    players,
    1,
    2,
    dealerIndex,
    (type, payload) => {
      broadcasts.push({ type, payload });
    },
  );
  return { engine, broadcasts };
}

function cardCountFor(
  engine: PokerEngine,
  viewerId: string,
  targetId: string,
): number {
  const view = engine.getStateForPlayer(viewerId);
  return view.players.find((p) => p.userId === targetId)!.cards.length;
}

describe("hand card privacy", () => {
  it("preflop: other players' cards are never visible", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    expect(cardCountFor(engine, "u1", "u0")).toBe(0);
    expect(cardCountFor(engine, "u0", "u1")).toBe(0);
    expect(cardCountFor(engine, "u0", "u0")).toBe(2); // own cards always visible
  });

  it("showdown: participants' cards are public, folded players stay hidden", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    // u0 (UTG/dealer) all-in, u1 all-in to match, u2 folds
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    expect(engine.handleAction("u1", "allin", 999)).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);
    const s = engine.getState();
    expect(s.phase).toBe("settled");

    // A viewer (u2, folded) sees both showdown participants' cards...
    expect(cardCountFor(engine, "u2", "u0")).toBe(2);
    expect(cardCountFor(engine, "u2", "u1")).toBe(2);
    // ...but not their own folded hand from another viewer's perspective
    expect(cardCountFor(engine, "u0", "u2")).toBe(0);
    expect(cardCountFor(engine, "u1", "u2")).toBe(0);
  });

  it("fold win: winner's cards stay hidden until they choose to reveal", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    expect(engine.handleAction("u1", "fold")).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);
    expect(engine.getState().phase).toBe("settled");

    expect(cardCountFor(engine, "u1", "u0")).toBe(0); // hidden after the win
    expect(cardCountFor(engine, "u2", "u0")).toBe(0);
    expect(cardCountFor(engine, "u0", "u0")).toBe(2); // winner sees their own

    // A folded player cannot reveal anyone's cards
    expect(engine.revealCards("u1")).toBe(false);
    expect(engine.revealCards("u2")).toBe(false);
    expect(cardCountFor(engine, "u1", "u0")).toBe(0);

    // The winner reveals -> now visible to everyone
    expect(engine.revealCards("u0")).toBe(true);
    expect(cardCountFor(engine, "u1", "u0")).toBe(2);
    expect(cardCountFor(engine, "u2", "u0")).toBe(2);

    // Revealing twice is rejected
    expect(engine.revealCards("u0")).toBe(false);
  });

  it("reveal is rejected outside the settled phase", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    expect(engine.revealCards("u0")).toBe(false); // preflop
  });

  it("startHand resets reveal state for the next hand", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    // heads of state: u0 wins by fold, then reveals
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    expect(engine.handleAction("u1", "fold")).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);
    expect(engine.revealCards("u0")).toBe(true);

    expect(engine.nextHand()).toBe(true);
    expect(engine.getState().phase).toBe("preflop");
    for (const p of engine.getState().players) {
      expect(p.cardsRevealed).toBe(false);
    }
    // u1 no longer sees u0's new hand
    expect(cardCountFor(engine, "u1", "u0")).toBe(0);
  });

  it("fold win with a side pot: only the winner may reveal", () => {
    const { engine, broadcasts } = makeEngine(3, 0, [100, 1000, 1000]);
    engine.startHand();
    expect(engine.handleAction("u0", "allin", 100)).toBe(true);
    expect(engine.handleAction("u1", "call", 99)).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);
    expect(engine.getState().phase).toBe("settled");

    const handResults = broadcasts.filter(
      (b) => b.type === "poker:hand_result",
    );
    const payload = handResults[0]?.payload as {
      reason: string;
      winners: { userId: string }[];
    };
    // u0 vs u1 showdown -> reason showdown, winner revealed automatically
    expect(payload.reason).toBe("showdown");
    for (const p of engine.getState().players) {
      if (!p.folded) expect(p.cardsRevealed).toBe(true);
    }
    // Even the loser (a showdown participant) cannot "reveal" further
    const loser = payload.winners[0].userId === "u0" ? "u1" : "u0";
    expect(engine.revealCards(loser)).toBe(false);
  });
});

describe("reveal edge cases", () => {
  it("rejects reveal for unknown players and before settlement", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    expect(engine.revealCards("ghost")).toBe(false);
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    expect(engine.handleAction("u1", "fold")).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);
    expect(engine.getState().phase).toBe("settled");
    expect(engine.revealCards("ghost")).toBe(false);
  });

  it("after the next hand starts, a stale reveal attempt is rejected", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    expect(engine.handleAction("u1", "fold")).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);
    expect(engine.revealCards("u0")).toBe(true);
    expect(engine.nextHand()).toBe(true);
    expect(engine.revealCards("u0")).toBe(false); // phase is preflop again
  });
});

describe("AI fold win reveal", () => {
  it("AI fold winner's cards are auto-revealed to everyone", () => {
    const { engine, broadcasts } = makeEngine(3, 0, 1000, [true, false, false]);
    engine.startHand();
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    expect(engine.handleAction("u1", "fold")).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);
    expect(engine.getState().phase).toBe("settled");

    // Visible to every other player and to spectators
    expect(cardCountFor(engine, "u1", "u0")).toBe(2);
    expect(cardCountFor(engine, "u2", "u0")).toBe(2);
    const spectatorView = engine.getStateForSpectator();
    expect(
      spectatorView.players.find((p) => p.userId === "u0")!.cards,
    ).toHaveLength(2);

    // A settled snapshot is broadcast after hand_result so clients render the cards
    const resultIdx = broadcasts.findIndex(
      (b) => b.type === "poker:hand_result",
    );
    expect(resultIdx).toBeGreaterThanOrEqual(0);
    expect(
      broadcasts.slice(resultIdx + 1).some((b) => b.type === "poker:update"),
    ).toBe(true);

    // Already revealed, so an explicit reveal is a no-op
    expect(engine.revealCards("u0")).toBe(false);
  });

  it("human fold winner stays hidden even when the folders are AI", () => {
    const { engine } = makeEngine(3, 0, 1000, [false, true, true]);
    engine.startHand();
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    expect(engine.handleAction("u1", "fold")).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);
    expect(engine.getState().phase).toBe("settled");

    expect(cardCountFor(engine, "u1", "u0")).toBe(0);
    expect(cardCountFor(engine, "u2", "u0")).toBe(0);
    expect(engine.revealCards("u0")).toBe(true);
    expect(cardCountFor(engine, "u1", "u0")).toBe(2);
  });
});

describe("spectator view privacy", () => {
  function spectatorCardCounts(engine: PokerEngine): number[] {
    return engine.getStateForSpectator().players.map((p) => p.cards.length);
  }

  it("preflop: spectator sees no hole cards at all", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    expect(spectatorCardCounts(engine)).toEqual([0, 0, 0]);
  });

  it("showdown: revealed participants visible, folded players hidden", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    expect(engine.handleAction("u1", "allin", 999)).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);
    expect(engine.getState().phase).toBe("settled");

    expect(spectatorCardCounts(engine)).toEqual([2, 2, 0]);
  });

  it("fold win: winner's cards stay hidden for spectators until revealed", () => {
    const { engine } = makeEngine(3, 0);
    engine.startHand();
    expect(engine.handleAction("u0", "allin", 1000)).toBe(true);
    expect(engine.handleAction("u1", "fold")).toBe(true);
    expect(engine.handleAction("u2", "fold")).toBe(true);

    expect(spectatorCardCounts(engine)).toEqual([0, 0, 0]);
    expect(engine.revealCards("u0")).toBe(true);
    expect(spectatorCardCounts(engine)).toEqual([2, 0, 0]);
  });
});
