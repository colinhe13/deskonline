import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "./chat";
import type { ChatMessage } from "../types/protocol";

let counter = 0;

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  counter += 1;
  return {
    id: `m${counter}`,
    userId: "u1",
    username: "Alice",
    text: `hello ${counter}`,
    sentAt: 1_000 + counter,
    ...overrides,
  };
}

describe("chat store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    counter = 0;
  });

  it("appends messages in arrival order", () => {
    const chat = useChatStore();
    chat.appendMessage(message({ text: "第一条" }));
    chat.appendMessage(message({ text: "第二条", userId: "u2" }));

    expect(chat.messages.map((m) => m.text)).toEqual(["第一条", "第二条"]);
  });

  it("caps the transcript so long sessions stay bounded", () => {
    const chat = useChatStore();
    for (let i = 0; i < 510; i += 1) {
      chat.appendMessage(message());
    }

    expect(chat.messages).toHaveLength(500);
    // Oldest entries are dropped first.
    expect(chat.messages[0].text).toBe("hello 11");
    expect(chat.messages[499].text).toBe("hello 510");
  });

  it("tracks a send error separately from the transcript", () => {
    const chat = useChatStore();
    chat.appendMessage(message());
    chat.setError("消息不能为空");

    expect(chat.error).toBe("消息不能为空");
    expect(chat.messages).toHaveLength(1);

    chat.clearError();
    expect(chat.error).toBe("");
    expect(chat.messages).toHaveLength(1);
  });

  it("clears messages and error when leaving the room", () => {
    const chat = useChatStore();
    chat.appendMessage(message());
    chat.setError("消息最长 200 字");

    chat.clearMessages();

    expect(chat.messages).toHaveLength(0);
    expect(chat.error).toBe("");
  });

  it("counts unread only when flagged, and markRead resets", () => {
    const chat = useChatStore();
    chat.appendMessage(message());
    expect(chat.unreadCount).toBe(0);

    chat.appendMessage(message({ userId: "u2" }), { unread: true });
    chat.appendMessage(message({ userId: "u2" }), { unread: true });
    expect(chat.unreadCount).toBe(2);

    chat.markRead();
    expect(chat.unreadCount).toBe(0);
  });

  it("resets unread when clearing the transcript", () => {
    const chat = useChatStore();
    chat.appendMessage(message({ userId: "u2" }), { unread: true });

    chat.clearMessages();

    expect(chat.unreadCount).toBe(0);
  });
});
