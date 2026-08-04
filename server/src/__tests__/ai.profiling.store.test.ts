import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../ai/llm.client.js", () => ({
  callLlm: vi.fn(),
}));

import { callLlm } from "../ai/llm.client.js";
import { ProfileStore } from "../ai/profiling/store.js";
import {
  NOTE_MAX_CHARS,
  summarizeOpponent,
} from "../ai/profiling/summarizer.js";
import type { HandRecord } from "../ai/profiling/types.js";
import { config } from "../config.js";

const mockedCallLlm = vi.mocked(callLlm);

function record(userId: string): HandRecord {
  return {
    actions: [
      { street: "preflop", userId, action: "blind", amount: 2 },
      { street: "preflop", userId, action: "call", amount: 2 },
    ],
    winners: [{ userId, amount: 6 }],
    showdownParticipantIds: [],
    revealedHandNames: {},
    handNumber: 1,
  };
}

describe("ProfileStore", () => {
  let store: ProfileStore;
  beforeEach(() => {
    store = new ProfileStore();
  });

  it("accumulates hands per opponent keyed by room and userId", () => {
    store.recordHand("room1", "u1", "alice", record("u1"));
    store.recordHand("room1", "u1", "alice", record("u1"));
    const profile = store.getProfile("room1", "u1");
    expect(profile?.stats.hands).toBe(2);
    expect(store.getProfile("room2", "u1")).toBeUndefined();
  });

  it("keeps at most 5 recent records per opponent", () => {
    for (let i = 0; i < 7; i++) {
      store.recordHand("room1", "u1", "alice", record("u1"));
    }
    expect(store.getRecentRecords("room1", "u1")).toHaveLength(5);
  });

  it("getViews hides stats and note below the min sample threshold", () => {
    for (let i = 0; i < 3; i++) {
      store.recordHand("room1", "u1", "alice", record("u1"));
    }
    store.setNote("room1", "u1", "很紧");
    const [view] = store.getViews("room1");
    expect(view).toMatchObject({
      userId: "u1",
      isAi: false,
      hands: 3,
      ready: false,
      stats: null,
      note: null,
    });
  });

  it("getViews exposes stats and note once the threshold is reached", () => {
    for (let i = 0; i < 5; i++) {
      store.recordHand("room1", "u1", "alice", record("u1"));
    }
    store.setNote("room1", "u1", "翻前很紧");
    const [view] = store.getViews("room1");
    expect(view.ready).toBe(true);
    expect(view.stats?.vpip).toBe(100);
    expect(view.note).toBe("翻前很紧");
  });

  it("setNote resets handsSinceLastSummary", () => {
    store.recordHand("room1", "u1", "alice", record("u1"));
    expect(store.getProfile("room1", "u1")?.handsSinceLastSummary).toBe(1);
    store.setNote("room1", "u1", "note");
    expect(store.getProfile("room1", "u1")?.handsSinceLastSummary).toBe(0);
  });

  it("clearRoom drops profiles and recent records", () => {
    store.recordHand("room1", "u1", "alice", record("u1"));
    store.clearRoom("room1");
    expect(store.listProfiles("room1")).toHaveLength(0);
    expect(store.getRecentRecords("room1", "u1")).toHaveLength(0);
  });

  it("pruneTo drops departed players but keeps seated and reserved ones", () => {
    store.recordHand("room1", "u1", "alice", record("u1"));
    store.recordHand("room1", "u2", "bob", record("u2"));
    store.recordHand("room1", "u3", "carol", record("u3"));

    store.pruneTo("room1", new Set(["u1", "u2"]));

    expect(store.getProfile("room1", "u1")).toBeDefined();
    expect(store.getProfile("room1", "u2")).toBeDefined();
    expect(store.getProfile("room1", "u3")).toBeUndefined();
    expect(store.getRecentRecords("room1", "u3")).toHaveLength(0);
  });

  it("pruneTo with nobody left clears the whole room", () => {
    store.recordHand("room1", "u1", "alice", record("u1"));
    store.pruneTo("room1", new Set());
    expect(store.listProfiles("room1")).toHaveLength(0);
    expect(store.getRecentRecords("room1", "u1")).toHaveLength(0);
  });

  describe("attachReveal", () => {
    it("writes the hand name into the user's most recent record only", () => {
      store.recordHand("room1", "u1", "alice", record("u1"));
      store.recordHand("room1", "u1", "alice", record("u1"));
      store.attachReveal("room1", "u1", "高牌 A", 1);
      const records = store.getRecentRecords("room1", "u1");
      expect(records[1].revealedHandNames).toEqual({ u1: "高牌 A" });
      expect(records[0].revealedHandNames).toEqual({});
    });

    it("refuses to write when the last record belongs to an earlier hand", () => {
      const older = record("u1");
      older.handNumber = 3;
      store.recordHand("room1", "u1", "alice", older);
      // Collection failed for hand 4; the reveal must not pollute hand 3.
      store.attachReveal("room1", "u1", "高牌 A", 4);
      expect(older.revealedHandNames).toEqual({});
    });

    it("is a no-op when the user has no records", () => {
      expect(() =>
        store.attachReveal("room1", "ghost", "一对 K", 1),
      ).not.toThrow();
      expect(store.getRecentRecords("room1", "ghost")).toHaveLength(0);
    });

    it("is visible to every observer sharing the same record object", () => {
      const shared = record("u1");
      store.recordHand("room1", "u1", "alice", shared);
      store.recordHand("room1", "u2", "bob", shared);
      store.attachReveal("room1", "u1", "两对 K 和 9", 1);
      expect(
        store.getRecentRecords("room1", "u2")[0].revealedHandNames,
      ).toEqual({
        u1: "两对 K 和 9",
      });
    });
  });
});

describe("summarizeOpponent", () => {
  beforeEach(() => {
    mockedCallLlm.mockReset();
  });

  const profile = {
    userId: "u1",
    username: "alice",
    stats: {
      hands: 5,
      vpipHands: 4,
      pfrHands: 2,
      threeBetHands: 0,
      threeBetOpps: 1,
      postflopAggr: 3,
      postflopCalls: 1,
      foldToRaiseOpps: 2,
      foldToRaiseFolds: 1,
      showdownHands: 2,
    },
    note: null,
    handsSinceLastSummary: 5,
    lastUpdatedAt: "2026-08-04T00:00:00.000Z",
  };

  it("returns the trimmed note on valid output", async () => {
    mockedCallLlm.mockResolvedValue({ summary: " 翻前偏紧，河牌爱抓诈唬 " });
    const note = await summarizeOpponent(profile, [record("u1")]);
    expect(note).toBe("翻前偏紧，河牌爱抓诈唬");
    expect(mockedCallLlm).toHaveBeenCalledWith(
      expect.stringContaining("对手分析"),
      expect.stringContaining('"stats"'),
      { maxTokens: 300, timeoutMs: config.aiSummaryTimeoutMs },
    );
  });

  it("truncates notes to the max length", async () => {
    mockedCallLlm.mockResolvedValue({ summary: "紧".repeat(300) });
    const note = await summarizeOpponent(profile, [record("u1")]);
    expect(note?.length).toBe(NOTE_MAX_CHARS);
  });

  it("returns null when the LLM call fails", async () => {
    mockedCallLlm.mockResolvedValue(null);
    expect(await summarizeOpponent(profile, [record("u1")])).toBeNull();
  });

  it("returns null on invalid output shape", async () => {
    mockedCallLlm.mockResolvedValue({ text: "不是JSON结构" });
    expect(await summarizeOpponent(profile, [record("u1")])).toBeNull();
    mockedCallLlm.mockResolvedValue({ summary: "" });
    expect(await summarizeOpponent(profile, [record("u1")])).toBeNull();
  });

  it("never includes hole cards in the summary input", async () => {
    mockedCallLlm.mockResolvedValue({ summary: "ok" });
    await summarizeOpponent(profile, [record("u1")]);
    const userContent = mockedCallLlm.mock.calls[0][1];
    expect(userContent).not.toMatch(/[2-9TJQKA][hdcs]\b/);
  });

  it("includes revealed hand names but never card faces in the input", async () => {
    mockedCallLlm.mockResolvedValue({ summary: "ok" });
    const foldWinReveal = record("u1");
    foldWinReveal.revealedHandNames = { u1: "高牌 A" };
    const showdownLoss = record("u1");
    showdownLoss.winners = [{ userId: "u2", amount: 10 }];
    showdownLoss.showdownParticipantIds = ["u1", "u2"];
    showdownLoss.revealedHandNames = { u1: "两对 K 和 9", u2: "顺子" };
    const unrevealed = record("u1");
    unrevealed.winners = [{ userId: "u2", amount: 6 }];

    await summarizeOpponent(profile, [foldWinReveal, showdownLoss, unrevealed]);
    const userContent = mockedCallLlm.mock.calls[0][1];
    expect(userContent).toContain("won 6，亮牌：高牌 A");
    expect(userContent).toContain("showdown lost，亮牌：两对 K 和 9");
    expect(userContent).toContain("call2 | lost");
    // hand3 is the last entry and unrevealed: its line ends the JSON string.
    expect(userContent).toMatch(/call2 \| lost"\}/);
    expect(userContent).not.toMatch(/[2-9TJQKA][hdcs]\b/);
    expect(userContent).not.toMatch(/hearts|clubs|diamonds|spades/);
  });
});
