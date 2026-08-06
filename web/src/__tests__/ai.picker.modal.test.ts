// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AiPickerModal from "../components/table/AiPickerModal.vue";
import type { AiAccountOption } from "../stores/game";

const options: AiAccountOption[] = [
  {
    username: "AI_XiaoZhi",
    displayName: "紧凶",
    styleLabel: "TAG",
    available: true,
  },
  {
    username: "AI_LaoWang",
    displayName: "松凶",
    styleLabel: "LAG",
    available: false,
  },
  {
    username: "AI_XiaoMei",
    displayName: "疯狂型",
    styleLabel: "MANIAC",
    available: true,
  },
  {
    username: "AI_AQiang",
    displayName: "均衡型",
    styleLabel: "BALANCED",
    available: true,
  },
];

describe("AiPickerModal", () => {
  it("renders active choices and marks occupied accounts", () => {
    const wrapper = mount(AiPickerModal, { props: { options } });

    expect(wrapper.findAll(".ai-option")).toHaveLength(4);
    expect(wrapper.text()).toContain("AI_XiaoZhi");
    expect(wrapper.text()).toContain("紧凶 · TAG");
    expect(wrapper.text()).toContain("已在本桌");
    expect(wrapper.findAll(".ai-option")[1].attributes("disabled")).toBe("");
  });

  it("emits the selected account name and close event", async () => {
    const wrapper = mount(AiPickerModal, { props: { options } });

    await wrapper.findAll(".ai-option")[0].trigger("click");
    await wrapper.find(".modal-overlay").trigger("click");

    expect(wrapper.emitted("select")).toEqual([["AI_XiaoZhi"]]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
