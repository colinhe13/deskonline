export interface ClientMessage {
  type: string;
  payload: unknown;
}

export interface ServerMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

export function createServerMessage(type: string, payload: unknown): string {
  const msg: ServerMessage = { type, payload, timestamp: Date.now() };
  return JSON.stringify(msg);
}

export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed.type !== "string") return null;
    return { type: parsed.type, payload: parsed.payload };
  } catch {
    return null;
  }
}

export const MAX_CHAT_LENGTH = 200;

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  sentAt: number;
}

export type ChatValidationResult =
  | { ok: true; text: string }
  | { ok: false; code: "CHAT_EMPTY" | "CHAT_TOO_LONG" };

// Length is measured in user-visible code points (after trimming) so Chinese
// text and emoji count the same way they read. The loop bails out as soon as
// the limit is exceeded, so oversized payloads cost bounded work.
export function validateChatText(raw: unknown): ChatValidationResult {
  if (typeof raw !== "string") return { ok: false, code: "CHAT_EMPTY" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, code: "CHAT_EMPTY" };

  let count = 0;
  for (let i = 0; i < trimmed.length && count <= MAX_CHAT_LENGTH;) {
    const codePoint = trimmed.codePointAt(i)!;
    i += codePoint > 0xffff ? 2 : 1;
    count += 1;
  }
  if (count > MAX_CHAT_LENGTH) {
    return { ok: false, code: "CHAT_TOO_LONG" };
  }
  return { ok: true, text: trimmed };
}

const LOBBY_PREFIXES = ["room:", "poker:", "ai:"];

// The gateway forwards only these messages to the LobbyHandler.
// "reconnect" is routed explicitly (it carries no prefix); without this,
// reconnect snapshots and voice-token resends would never run.
export function shouldRouteToLobby(type: string): boolean {
  return (
    type === "reconnect" ||
    LOBBY_PREFIXES.some((prefix) => type.startsWith(prefix))
  );
}
