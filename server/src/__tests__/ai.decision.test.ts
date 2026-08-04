import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { aiTimeoutMs: 10 },
}));

vi.mock("../ai/llm.client.js", () => ({
  callLlm: vi.fn(),
}));

import { decideAiAction, fallbackAction } from "../ai/decision.js";
import { callLlm } from "../ai/llm.client.js";
import type { GameState, ActionOption } from "../poker/types.js";

function state(): GameState {
  const base = {
    seatIndex: 0,
    chips: 100,
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    cards: [],
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
    cardsRevealed: false,
  };
  return {
    phase: "preflop",
    communityCards: [],
    pot: 3,
    sidePots: [],
    players: [
      { ...base, userId: "ai1", username: "AI_XiaoZhi", cards: [] },
      { ...base, userId: "u2", username: "h2", seatIndex: 1 },
    ],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    smallBlind: 1,
    bigBlind: 2,
    currentBet: 0,
    minRaise: 2,
    handNumber: 1,
    actionLog: [],
  };
}

const withCheck: ActionOption[] = [
  { type: "check" },
  { type: "fold" },
  { type: "raise", min: 2, max: 100 },
  { type: "allin", amount: 100 },
];

const noCheck: ActionOption[] = [
  { type: "fold" },
  { type: "call", amount: 4 },
  { type: "raise", min: 8, max: 100 },
  { type: "allin", amount: 100 },
];

describe("fallbackAction", () => {
  it("checks when check is available", () => {
    expect(fallbackAction(withCheck)).toEqual({ action: "check" });
  });

  it("folds when check is unavailable", () => {
    expect(fallbackAction(noCheck)).toEqual({ action: "fold" });
  });
});

describe("decideAiAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through a legal LLM decision", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "raise", amount: 10 });
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "raise",
      amount: 10,
    });
  });

  it("falls back when the LLM returns null (timeout/network)", async () => {
    vi.mocked(callLlm).mockResolvedValue(null);
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "check",
    });
    await expect(decideAiAction(state(), "ai1", noCheck)).resolves.toEqual({
      action: "fold",
    });
  });

  it("falls back on schema-invalid output", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "bluff", amount: -3 });
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "check",
    });
  });

  it("falls back when the action is not in availableActions", async () => {
    // check unavailable but the model wants to check
    vi.mocked(callLlm).mockResolvedValue({ action: "check", amount: 0 });
    await expect(decideAiAction(state(), "ai1", noCheck)).resolves.toEqual({
      action: "fold",
    });
  });

  it("clamps an out-of-bounds raise amount into the legal window", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "raise", amount: 1 }); // min 2
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "raise",
      amount: 2,
    });
    vi.mocked(callLlm).mockResolvedValue({ action: "raise", amount: 500 }); // max 100
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "raise",
      amount: 100,
    });
  });

  it("defaults the raise amount to the minimum when omitted", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "raise" });
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "raise",
      amount: 2,
    });
  });

  it("rounds a fractional raise amount", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "raise", amount: 7.6 });
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "raise",
      amount: 8,
    });
  });

  it("maps the bet alias to raise", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "bet", amount: 10 });
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "raise",
      amount: 10,
    });
  });

  it("maps allin spelling variants", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "all-in" });
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "allin",
      amount: 100,
    });
  });

  it("falls back when raise is requested but unavailable", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "raise", amount: 10 });
    const noRaise: ActionOption[] = [
      { type: "fold" },
      { type: "call", amount: 4 },
    ];
    await expect(decideAiAction(state(), "ai1", noRaise)).resolves.toEqual({
      action: "fold",
    });
  });

  it("fills the allin amount from the option list when omitted", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "allin" });
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "allin",
      amount: 100,
    });
  });

  it("ignores a bogus allin amount and uses the full stack", async () => {
    vi.mocked(callLlm).mockResolvedValue({ action: "allin", amount: 0 });
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "allin",
      amount: 100,
    });
  });

  it("falls back when the LLM call throws", async () => {
    vi.mocked(callLlm).mockRejectedValue(new Error("boom"));
    await expect(decideAiAction(state(), "ai1", withCheck)).resolves.toEqual({
      action: "check",
    });
  });
});
