import { describe, it, expect } from "vitest";
import { buildDecisionContext, GTO_SYSTEM_PROMPT } from "../ai/prompt.js";
import type { GameState, PlayerState } from "../poker/types.js";

function player(overrides: Partial<PlayerState>): PlayerState {
  return {
    userId: "u1",
    username: "AI_XiaoZhi",
    seatIndex: 0,
    chips: 148,
    bet: 0,
    totalBet: 2,
    folded: false,
    allIn: false,
    hasActed: false,
    cards: [],
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
    cardsRevealed: false,
    ...overrides,
  };
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: "flop",
    communityCards: [
      { rank: "Q", suit: "spades" },
      { rank: "7", suit: "diamonds" },
      { rank: "2", suit: "clubs" },
    ],
    pot: 9,
    sidePots: [],
    players: [
      player({
        userId: "ai1",
        username: "AI_XiaoZhi",
        seatIndex: 2,
        cards: [
          { rank: "A", suit: "hearts" },
          { rank: "K", suit: "diamonds" },
        ],
      }),
      player({
        userId: "u2",
        username: "human2",
        seatIndex: 0,
        chips: 120,
        bet: 4,
        cards: [
          { rank: "9", suit: "hearts" },
          { rank: "9", suit: "clubs" },
        ],
      }),
      player({
        userId: "u3",
        username: "human3",
        seatIndex: 1,
        folded: true,
        cards: [
          { rank: "3", suit: "hearts" },
          { rank: "4", suit: "hearts" },
        ],
      }),
    ],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    smallBlind: 1,
    bigBlind: 2,
    currentBet: 4,
    minRaise: 4,
    handNumber: 3,
    actionLog: ["SB (h) posts 1", "BB (h) posts 2", "--- flop ---"],
    ...overrides,
  };
}

describe("buildDecisionContext", () => {
  it("never exposes opponents' hole cards (信息隔离红线)", () => {
    const ctx = buildDecisionContext(state(), "ai1") as {
      opponents: Record<string, unknown>[];
      mySeat: { holeCards: string[] };
    };
    // 自己能看到手牌
    expect(ctx.mySeat.holeCards).toEqual(["Ah", "Kd"]);
    // 对手视角：连 cards 字段都不能存在
    expect(ctx.opponents).toHaveLength(2);
    for (const opp of ctx.opponents) {
      expect(opp).not.toHaveProperty("cards");
      expect(opp).not.toHaveProperty("holeCards");
      expect(JSON.stringify(opp)).not.toContain("9h");
    }
  });

  it("formats community cards and phase", () => {
    const ctx = buildDecisionContext(state(), "ai1") as {
      communityCards: string[];
      phase: string;
      handNo: number;
      pot: number;
      toCall: number;
    };
    expect(ctx.communityCards).toEqual(["Qs", "7d", "2c"]);
    expect(ctx.phase).toBe("flop");
    expect(ctx.handNo).toBe(3);
    expect(ctx.pot).toBe(9);
    expect(ctx.toCall).toBe(4); // currentBet 4 - my bet 0
  });

  it("marks opponent status as folded / allin / active", () => {
    const s = state();
    s.players[2].allIn = true;
    s.players[2].folded = false;
    const ctx = buildDecisionContext(s, "ai1") as {
      opponents: { status: string; seat: number }[];
    };
    const bySeat = Object.fromEntries(
      ctx.opponents.map((o) => [o.seat, o.status]),
    );
    expect(bySeat[1]).toBe("allin");
    expect(bySeat[0]).toBe("active");
  });

  it("computes positions relative to the button (9-max labels)", () => {
    const s = state();
    // players at array idx 0/1/2, dealerIndex = 0 → idx0=BTN, idx1=SB, idx2=BB.
    // Seat numbers are deliberately decoupled from array order.
    const ctx = buildDecisionContext(s, "ai1") as {
      mySeat: { position: string };
      opponents: { position: string; seat: number }[];
    };
    expect(ctx.mySeat.position).toBe("BTN");
    const bySeat = Object.fromEntries(
      ctx.opponents.map((o) => [o.seat, o.position]),
    );
    expect(bySeat[0]).toBe("SB");
    expect(bySeat[1]).toBe("BB");
  });

  it("labels heads-up as BTN and BB", () => {
    const s = state({
      players: [
        player({ userId: "ai1", seatIndex: 0, isDealer: true }),
        player({ userId: "u2", seatIndex: 1 }),
      ],
      dealerIndex: 0,
    });
    const ctx = buildDecisionContext(s, "ai1") as {
      mySeat: { position: string };
      opponents: { position: string }[];
    };
    expect(ctx.mySeat.position).toBe("BTN");
    expect(ctx.opponents[0].position).toBe("BB");
  });

  it("mirrors the action log as history", () => {
    const ctx = buildDecisionContext(state(), "ai1") as { history: string[] };
    expect(ctx.history).toEqual([
      "SB (h) posts 1",
      "BB (h) posts 2",
      "--- flop ---",
    ]);
  });

  it("computes minRaiseAmount consistent with the raise minimum", () => {
    const ctx = buildDecisionContext(state(), "ai1") as {
      minRaiseAmount: number;
    };
    // currentBet 4 + minRaise 4 - my bet 0 = 8
    expect(ctx.minRaiseAmount).toBe(8);
  });
});

describe("GTO_SYSTEM_PROMPT", () => {
  it("declares the exact JSON output contract and all five actions", () => {
    expect(GTO_SYSTEM_PROMPT).toContain(
      '{"action":"fold|check|call|raise|allin","amount":0}',
    );
    expect(GTO_SYSTEM_PROMPT).toContain("fold（弃牌）");
    expect(GTO_SYSTEM_PROMPT).toContain("allin（全下）");
  });

  it("explains the raise amount semantics used by the engine", () => {
    expect(GTO_SYSTEM_PROMPT).toContain("本轮你要额外投入的筹码数");
  });
});

describe("buildDecisionContext opponent profiles", () => {
  const readyProfile = {
    userId: "u2",
    username: "human2",
    isAi: false,
    hands: 8,
    ready: true,
    stats: {
      hands: 8,
      vpip: 40,
      pfr: 25,
      threeBet: 10,
      af: 2.5,
      foldToRaise: 60,
      wtsd: 30,
    },
    note: "翻前偏紧，河牌爱抓诈唬",
  };

  it("omits profile fields when no profiles are passed", () => {
    const ctx = buildDecisionContext(state(), "ai1");
    expect(ctx).not.toHaveProperty("opponentProfiles");
    expect(ctx).not.toHaveProperty("opponentProfileGuidance");
  });

  it("injects ready profiles at the head of the context with guidance", () => {
    const ctx = buildDecisionContext(state(), "ai1", [readyProfile]);
    const keys = Object.keys(ctx);
    expect(keys[0]).toBe("opponentProfileGuidance");
    expect(keys[1]).toBe("opponentProfiles");
    const profiles = ctx.opponentProfiles as {
      name: string;
      stats: unknown;
      note: string;
    }[];
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("human2");
    expect(profiles[0].note).toBe("翻前偏紧，河牌爱抓诈唬");
  });

  it("filters out profiles below the sample threshold", () => {
    const coldProfile = { ...readyProfile, ready: false, stats: null, note: null };
    const ctx = buildDecisionContext(state(), "ai1", [coldProfile]);
    expect(ctx).not.toHaveProperty("opponentProfiles");
  });

  it("never leaks hole cards through the profile section", () => {
    const ctx = buildDecisionContext(state(), "ai1", [readyProfile]);
    const serialized = JSON.stringify(ctx.opponentProfiles);
    expect(serialized).not.toMatch(/[2-9TJQKA][hdcs]\b/);
  });
});
