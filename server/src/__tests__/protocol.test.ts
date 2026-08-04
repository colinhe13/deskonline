import { describe, it, expect } from "vitest";
import {
  createServerMessage,
  parseClientMessage,
  shouldRouteToLobby,
  validateChatText,
  MAX_CHAT_LENGTH,
} from "../ws/protocol.js";

describe("protocol", () => {
  describe("createServerMessage", () => {
    it("creates a valid JSON message with type, payload, and timestamp", () => {
      const raw = createServerMessage("test", { foo: "bar" });
      const parsed = JSON.parse(raw);
      expect(parsed.type).toBe("test");
      expect(parsed.payload).toEqual({ foo: "bar" });
      expect(typeof parsed.timestamp).toBe("number");
    });
  });

  describe("parseClientMessage", () => {
    it("parses a valid client message", () => {
      const msg = parseClientMessage(
        JSON.stringify({ type: "room:join", payload: { id: "1" } }),
      );
      expect(msg).toEqual({ type: "room:join", payload: { id: "1" } });
    });

    it("returns null for invalid JSON", () => {
      expect(parseClientMessage("not json")).toBeNull();
    });

    it("returns null when type is missing", () => {
      expect(parseClientMessage(JSON.stringify({ payload: {} }))).toBeNull();
    });

    it("returns null when type is not a string", () => {
      expect(parseClientMessage(JSON.stringify({ type: 123 }))).toBeNull();
    });
  });

  describe("shouldRouteToLobby (gateway 路由总闸)", () => {
    it("routes room:* and poker:* messages", () => {
      expect(shouldRouteToLobby("room:join")).toBe(true);
      expect(shouldRouteToLobby("room:queue-join")).toBe(true);
      expect(shouldRouteToLobby("room:cancel-queue-join")).toBe(true);
      expect(shouldRouteToLobby("room:list:request")).toBe(true);
      expect(shouldRouteToLobby("room:chat:send")).toBe(true);
      expect(shouldRouteToLobby("poker:action")).toBe(true);
      expect(shouldRouteToLobby("poker:reveal")).toBe(true);
    });

    it("routes ai:* messages", () => {
      expect(shouldRouteToLobby("ai:add")).toBe(true);
      expect(shouldRouteToLobby("ai:remove")).toBe(true);
    });

    // Regression: reconnect was silently dropped by the prefix filter,
    // disabling snapshot restore and voice-token resend.
    it("routes reconnect explicitly", () => {
      expect(shouldRouteToLobby("reconnect")).toBe(true);
    });

    it("does not route unrelated types", () => {
      expect(shouldRouteToLobby("voice:token")).toBe(false);
      expect(shouldRouteToLobby("chat:message")).toBe(false);
      expect(shouldRouteToLobby("ai")).toBe(false);
      expect(shouldRouteToLobby("")).toBe(false);
    });
  });

  describe("validateChatText (聊天正文校验)", () => {
    it("rejects non-string payloads as empty", () => {
      expect(validateChatText(undefined)).toEqual({
        ok: false,
        code: "CHAT_EMPTY",
      });
      expect(validateChatText(42)).toEqual({ ok: false, code: "CHAT_EMPTY" });
      expect(validateChatText(null)).toEqual({ ok: false, code: "CHAT_EMPTY" });
    });

    it("rejects empty or whitespace-only text", () => {
      expect(validateChatText("")).toEqual({ ok: false, code: "CHAT_EMPTY" });
      expect(validateChatText(" \t\n ")).toEqual({
        ok: false,
        code: "CHAT_EMPTY",
      });
    });

    it("trims surrounding whitespace from accepted text", () => {
      expect(validateChatText("  hi  ")).toEqual({ ok: true, text: "hi" });
    });

    it("accepts exactly MAX_CHAT_LENGTH visible characters", () => {
      expect(validateChatText("中".repeat(MAX_CHAT_LENGTH))).toEqual({
        ok: true,
        text: "中".repeat(MAX_CHAT_LENGTH),
      });
      expect(validateChatText("😀".repeat(MAX_CHAT_LENGTH)).ok).toBe(true);
    });

    it("rejects MAX_CHAT_LENGTH + 1 visible characters, emoji included", () => {
      expect(validateChatText("a".repeat(MAX_CHAT_LENGTH + 1))).toEqual({
        ok: false,
        code: "CHAT_TOO_LONG",
      });
      // 😀 is a surrogate pair (2 UTF-16 units) but one visible character.
      expect(validateChatText("😀".repeat(MAX_CHAT_LENGTH + 1))).toEqual({
        ok: false,
        code: "CHAT_TOO_LONG",
      });
      expect(validateChatText("😀".repeat(MAX_CHAT_LENGTH))).toEqual(
        expect.objectContaining({ ok: true }),
      );
    });
  });
});
