export interface ClientMessage {
  type: string;
  payload: unknown;
}

export interface ServerMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

export const MAX_CHAT_LENGTH = 200;

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  sentAt: number;
}
