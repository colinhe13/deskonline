import { ref, onUnmounted } from "vue";
import type { ServerMessage } from "../types/protocol";

type MessageHandler = (payload: unknown) => void;

export function useWebSocket() {
  const isConnected = ref(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const handlers = new Map<string, Set<MessageHandler>>();

  function connect() {
    const token = localStorage.getItem("token");
    if (!token) return;

    const base = import.meta.env.VITE_WS_BASE || import.meta.env.VITE_API_BASE || "";
    const wsUrl = base.replace(/^http/, "ws") + `/ws?token=${token}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      isConnected.value = true;
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        const msgHandlers = handlers.get(msg.type);
        if (msgHandlers) {
          for (const handler of msgHandlers) {
            handler(msg.payload);
          }
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = (event) => {
      isConnected.value = false;
      if (event.code !== 4001 && event.code !== 1000) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
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

  onUnmounted(() => {
    disconnect();
  });

  return { isConnected, connect, disconnect, send, onMessage, offMessage };
}
