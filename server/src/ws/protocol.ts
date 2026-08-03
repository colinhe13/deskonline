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
