import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../ai/llm.client.js", () => ({
  callLlm: vi.fn(),
}));

import { callLlm } from "../ai/llm.client.js";
import { ProfileStore } from "../ai/profiling/store.js";
import { summarizeOpponent } from "../ai/profiling/summarizer.js";
import type { HandRecord } from "../ai/profiling/types.js";

const mockedCallLlm = vi.mocked(callLlm);

function record(userId: string): HandRecord {
  return {
    actions: [
      { street: "preflop", userId, action: "blind", amount: 2 },
      { street: "preflop", userId, action: "call", amount: 2 },
    ],
    winners: [{ userId, amount: 6 }],
    showdownParticipantIds: [],
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
      { maxTokens: 300 },
    );
  });

  it("truncates notes to 120 chars", async () => {
    mockedCallLlm.mockResolvedValue({ summary: "紧".repeat(200) });
    const note = await summarizeOpponent(profile, [record("u1")]);
    expect(note?.length).toBe(120);
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
});
