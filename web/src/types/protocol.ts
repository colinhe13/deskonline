export interface ClientMessage {
  type: string;
  payload: unknown;
}

export interface ServerMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}
