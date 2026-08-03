import { ref } from "vue";
import type { ServerMessage } from "../types/protocol";

type MessageHandler = (payload: unknown) => void;

const isConnected = ref(false);
const isReconnecting = ref(false);
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let intentionalClose = false;
const handlers = new Map<string, Set<MessageHandler>>();

const MAX_RECONNECT_DELAY = 15_000;

export function useWebSocket() {
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

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      isConnected.value = true;
      if (reconnectAttempts > 0) {
        send("reconnect", {});
      }
      reconnectAttempts = 0;
      isReconnecting.value = false;
    };

    ws.onmessage = (event) => {
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

    ws.onclose = (event) => {
      isConnected.value = false;
      ws = null;
      if (!intentionalClose && event.code !== 4001) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws?.close();
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
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    isReconnecting.value = false;
    ws?.close(1000);
    ws = null;
    isConnected.value = false;
  }

  function send(type: string, payload: unknown) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
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
    onMessage,
    offMessage,
  };
}
