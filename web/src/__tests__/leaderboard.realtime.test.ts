// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  onMessage: vi.fn(),
  offMessage: vi.fn(),
}));

vi.mock("../utils/http", () => ({
  http: { get: mocks.get },
}));

vi.mock("../composables/useWebSocket", () => ({
  useWebSocket: () => ({
    onMessage: mocks.onMessage,
    offMessage: mocks.offMessage,
  }),
}));

import LeaderboardModal from "../components/lobby/LeaderboardModal.vue";

const entry = (username: string, total: number, rank: number) => ({
  rank,
  userId: username,
  username,
  isAi: false,
  total,
  dailyDelta: 0,
});

describe("LeaderboardModal settlement snapshots", () => {
  let updateHandler: ((payload: unknown) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    updateHandler = undefined;
    mocks.onMessage.mockImplementation(
      (type: string, handler: (payload: unknown) => void) => {
        if (type === "leaderboard:update") updateHandler = handler;
      },
    );
    mocks.get.mockResolvedValue({
      data: {
        revision: 1,
        entries: [entry("alice", 10000, 1)],
      },
    });
  });

  afterEach(() => {
    updateHandler = undefined;
  });

  it("updates immediately after a hand-settlement snapshot arrives", async () => {
    const wrapper = mount(LeaderboardModal);
    await flushPromises();
    expect(wrapper.text()).toContain("alice");
    expect(wrapper.text()).toContain("10000");

    updateHandler?.({
      revision: 2,
      entries: [entry("bob", 11000, 1), entry("alice", 9000, 2)],
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("bob");
    expect(wrapper.text()).toContain("11000");
    expect(wrapper.text()).toContain("9000");
  });

  it("ignores an older REST or WebSocket snapshot", async () => {
    const wrapper = mount(LeaderboardModal);
    await flushPromises();

    updateHandler?.({
      revision: 3,
      entries: [entry("new", 12000, 1)],
    });
    await wrapper.vm.$nextTick();
    updateHandler?.({
      revision: 2,
      entries: [entry("stale", 13000, 1)],
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("new");
    expect(wrapper.text()).not.toContain("stale");
  });

  it("unsubscribes when the modal closes", async () => {
    const wrapper = mount(LeaderboardModal);
    await flushPromises();
    wrapper.unmount();

    expect(mocks.offMessage).toHaveBeenCalledWith(
      "leaderboard:update",
      expect.any(Function),
    );
  });
});
