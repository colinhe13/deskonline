import { describe, it, expect } from "vitest";
import { createServerMessage, parseClientMessage } from "../ws/protocol.js";

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
      const msg = parseClientMessage(JSON.stringify({ type: "room:join", payload: { id: "1" } }));
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
});
