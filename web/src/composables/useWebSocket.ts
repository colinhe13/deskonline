import { ref } from "vue";
import type { ServerMessage } from "../types/protocol";

type MessageHandler = (payload: unknown) => void;

export type SessionInvalidation = {
  reason: "replaced" | "invalid";
  token: string;
};

type SessionInvalidationHandler = (event: SessionInvalidation) => void;

const isConnected = ref(false);
const isReconnecting = ref(false);
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let intentionalClose = false;
const handlers = new Map<string, Set<MessageHandler>>();
const sessionInvalidationHandlers = new Set<SessionInvalidationHandler>();

const MAX_RECONNECT_DELAY = 15_000;
const TERMINAL_CLOSE_CODES = new Set([4001, 4002]);

export function useWebSocket() {
  function clearReconnectState() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    isReconnecting.value = false;
  }

  function notifySessionInvalidated(event: SessionInvalidation) {
    for (const handler of [...sessionInvalidationHandlers]) {
      handler(event);
    }
  }

  function connect() {
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) return;

    intentionalClose = false;
    const base =
      import.meta.env.VITE_WS_BASE || import.meta.env.VITE_API_BASE || "";
    const wsUrl = base.replace(/^http/, "ws") + `/ws?token=${token}`;
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      isConnected.value = true;
      // Always request a full snapshot on connect — covers WS drop-reconnect,
      // page refresh and direct URL entry. Server-side is idempotent: users
      // without an active room only get reconnect:failed.
      send("reconnect", {});
      reconnectAttempts = 0;
      isReconnecting.value = false;
    };

    socket.onmessage = (event) => {
      if (ws !== socket) return;
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        const msgHandlers = handlers.get(msg.type);
        if (msgHandlers) {
          for (const handler of [...msgHandlers]) {
            handler(msg.payload);
          }
        }
      } catch {
        // ignore malformed messages
      }
    };

    socket.onclose = (event) => {
      // A late close from a replaced socket must not affect the new socket.
      if (ws !== socket) return;
      ws = null;
      isConnected.value = false;

      if (TERMINAL_CLOSE_CODES.has(event.code)) {
        intentionalClose = true;
        clearReconnectState();
        notifySessionInvalidated({
          reason: event.code === 4002 ? "replaced" : "invalid",
          token,
        });
        return;
      }

      if (!intentionalClose) {
        scheduleReconnect();
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer || intentionalClose) return;
    isReconnecting.value = true;
    const delay = Math.min(
      1000 * Math.pow(2, reconnectAttempts),
      MAX_RECONNECT_DELAY,
    );
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function disconnect() {
    intentionalClose = true;
    clearReconnectState();
    const current = ws;
    ws = null;
    current?.close(1000);
    isConnected.value = false;
  }

  function send(type: string, payload: unknown) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  function isOpen() {
    return ws?.readyState === WebSocket.OPEN;
  }

  function onMessage(type: string, handler: MessageHandler) {
    if (!handlers.has(type)) {
      handlers.set(type, new Set());
    }
    handlers.get(type)!.add(handler);
  }

  function offMessage(type: string, handler: MessageHandler) {
    handlers.get(type)?.delete(handler);
  }

  function onSessionInvalidated(handler: SessionInvalidationHandler) {
    sessionInvalidationHandlers.add(handler);
    return () => sessionInvalidationHandlers.delete(handler);
  }

  function handleVisibilityChange() {
    if (
      document.visibilityState === "visible" &&
      !intentionalClose &&
      localStorage.getItem("token")
    ) {
      connect();
    }
  }

  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  return {
    isConnected,
    isReconnecting,
    connect,
    disconnect,
    send,
    isOpen,
    onMessage,
    offMessage,
    onSessionInvalidated,
  };
}
