// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ChatPanel from "../components/chat/ChatPanel.vue";
import { useChatStore } from "../stores/chat";
import { MAX_CHAT_LENGTH } from "../types/protocol";
import type { ChatMessage } from "../types/protocol";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id ?? "m1",
    userId: "u2",
    username: "Bob",
    text: "你好",
    sentAt: 1,
    ...overrides,
  };
}

function mountPanel(myUserId: string | null = "u1") {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(ChatPanel, {
    props: { myUserId },
    global: { plugins: [pinia] },
  });
  return { wrapper, chat: useChatStore() };
}

describe("ChatPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the empty state before any message arrives", () => {
    const { wrapper } = mountPanel();
    expect(wrapper.text()).toContain("暂无消息");
    expect(wrapper.findAll(".chat-message")).toHaveLength(0);
  });

  it("renders messages with author names and highlights my own", async () => {
    const { wrapper, chat } = mountPanel();
    chat.appendMessage(message());
    chat.appendMessage(
      message({ id: "m2", userId: "u1", username: "Alice", text: "我来了" }),
    );
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll(".chat-message");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Bob");
    expect(items[0].text()).toContain("你好");
    expect(items[0].classes()).not.toContain("mine");
    expect(items[1].classes()).toContain("mine");
    expect(items[1].text()).toContain("我来了");
  });

  it("renders hostile text as plain text, never as HTML", async () => {
    const { wrapper, chat } = mountPanel();
    chat.appendMessage(
      message({
        id: "xss",
        text: '<img src=x onerror=alert(1)><script>alert("pwn")</script>',
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.html()).toContain("&lt;img");
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
  });

  it("emits trimmed text on submit and clears the draft", async () => {
    const { wrapper } = mountPanel();
    const input = wrapper.find("input.chat-input");
    await input.setValue("  大家好  ");
    await wrapper.find("form").trigger("submit.prevent");

    expect(wrapper.emitted("send")).toEqual([["大家好"]]);
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("never emits for empty or whitespace-only input", async () => {
    const { wrapper } = mountPanel();
    const send = wrapper.find("button.chat-send");
    expect((send.element as HTMLButtonElement).disabled).toBe(true);

    await wrapper.find("input.chat-input").setValue("   ");
    expect((send.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.emitted("send")).toBeUndefined();
  });

  it("counts visible characters and blocks input over the limit", async () => {
    const { wrapper } = mountPanel();
    const input = wrapper.find("input.chat-input");
    const send = wrapper.find("button.chat-send");

    await input.setValue("中".repeat(MAX_CHAT_LENGTH));
    expect(wrapper.find(".chat-count").text()).toBe(`${MAX_CHAT_LENGTH}/200`);
    expect(wrapper.find(".chat-count").classes()).not.toContain("over");
    expect((send.element as HTMLButtonElement).disabled).toBe(false);
    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.emitted("send")).toHaveLength(1);

    // One emoji is one visible character even though it is two UTF-16 units.
    await input.setValue("😀".repeat(MAX_CHAT_LENGTH + 1));
    expect(wrapper.find(".chat-count").text()).toBe(
      `${MAX_CHAT_LENGTH + 1}/200`,
    );
    expect(wrapper.find(".chat-count").classes()).toContain("over");
    expect((send.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.emitted("send")).toHaveLength(1);
  });

  it("shows the server rejection inline and clears it on new input", async () => {
    const { wrapper, chat } = mountPanel();
    chat.setError("消息最长 200 字");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".chat-error").text()).toBe("消息最长 200 字");

    await wrapper.find("input.chat-input").setValue("再试一次");
    expect(wrapper.find(".chat-error").exists()).toBe(false);
  });
});
