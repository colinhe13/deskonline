// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PlayerProfileModal from "../components/table/PlayerProfileModal.vue";
import type { ProfileView } from "../stores/profiles";

function profile(overrides: Partial<ProfileView> = {}): ProfileView {
  return {
    userId: "u2",
    username: "Bob",
    isAi: false,
    hands: 6,
    ready: true,
    stats: {
      hands: 6,
      vpip: 50,
      pfr: 16.7,
      threeBet: null,
      af: 2.5,
      foldToRaise: 40,
      wtsd: 33.3,
    },
    note: "偏松凶，喜欢翻后持续下注",
    ...overrides,
  };
}

function mountModal(props: Record<string, unknown> = {}) {
  return mount(PlayerProfileModal, {
    props: { username: "Bob", isAi: false, profile: null, ...props },
  });
}

describe("PlayerProfileModal", () => {
  it("shows the GTO note for AI players, never a profile", () => {
    const wrapper = mountModal({ isAi: true });
    expect(wrapper.find(".ai-badge").exists()).toBe(true);
    expect(wrapper.text()).toContain("GTO 基准策略");
    expect(wrapper.find(".stats-grid").exists()).toBe(false);
  });

  it("shows the empty placeholder when no observations exist yet", () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain("暂无观察数据");
    expect(wrapper.find(".stats-grid").exists()).toBe(false);
  });

  it("shows the observed-hand count before the sample threshold", () => {
    const wrapper = mountModal({
      profile: profile({ ready: false, hands: 3, stats: null, note: null }),
    });
    expect(wrapper.text()).toContain("已观察 3 手");
    expect(wrapper.find(".stats-grid").exists()).toBe(false);
  });

  it("renders all six stats with formatted values when ready", () => {
    const wrapper = mountModal({ profile: profile() });
    const cells = wrapper.findAll(".stat-cell");
    expect(cells).toHaveLength(6);

    const text = wrapper.text();
    expect(text).toContain("50%"); // vpip
    expect(text).toContain("16.7%"); // pfr
    expect(text).toContain("2.5"); // af
    expect(text).toContain("40%"); // foldToRaise
    expect(text).toContain("33.3%"); // wtsd
    expect(text).toContain("—"); // threeBet is null
    expect(text).toContain("偏松凶，喜欢翻后持续下注");
    expect(text).toContain("仅供娱乐");
  });

  it("omits the note block when there is no summary yet", () => {
    const wrapper = mountModal({ profile: profile({ note: null }) });
    expect(wrapper.find(".note").exists()).toBe(false);
    expect(wrapper.find(".stats-grid").exists()).toBe(true);
  });

  it("emits close from both the overlay backdrop and the button", async () => {
    const wrapper = mountModal({ profile: profile() });

    await wrapper.find(".modal-overlay").trigger("click");
    await wrapper.find(".modal-actions button").trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(2);
  });
});
