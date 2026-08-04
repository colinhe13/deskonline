import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { useWebSocket } from "../composables/useWebSocket";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000 });
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

const storage = new Map<string, string>();

function sentTypes(ws: MockWebSocket): string[] {
  return ws.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);
}

beforeEach(() => {
  MockWebSocket.instances = [];
  storage.clear();
  storage.set("token", "test-token");
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  globalThis.localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  } as unknown as Storage;
});

afterEach(() => {
  useWebSocket().disconnect();
});

describe("useWebSocket 快照恢复（刷新/直接访问/断线重连）", () => {
  it("首次连接建立即发送 reconnect 快照请求", () => {
    const ws = useWebSocket();
    ws.connect();
    const sock = MockWebSocket.instances[0];
    expect(sock).toBeTruthy();
    expect(sock.url).toContain("/ws?token=test-token");

    sock.open();
    expect(sentTypes(sock)).toEqual(["reconnect"]);
    expect(ws.isOpen()).toBe(true);
  });

  it("未打开时 isOpen 为 false，send 不投递消息", () => {
    const ws = useWebSocket();
    ws.connect();
    const sock = MockWebSocket.instances[0];
    expect(ws.isOpen()).toBe(false);
    ws.send("room:list:request", {});
    expect(sock.sent).toHaveLength(0);
  });

  it("主动断开后重连仍然发送 reconnect", () => {
    const ws = useWebSocket();
    ws.connect();
    MockWebSocket.instances[0].open();
    ws.disconnect();

    ws.connect();
    const sock = MockWebSocket.instances[1];
    sock.open();
    expect(sentTypes(sock)).toEqual(["reconnect"]);
  });

  it("意外断开自动重连成功后发送 reconnect", async () => {
    const ws = useWebSocket();
    ws.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    // Simulate a network drop (not an intentional close).
    first.readyState = MockWebSocket.CLOSED;
    first.onclose?.({ code: 1006 });

    await new Promise((r) => setTimeout(r, 1100));
    const second = MockWebSocket.instances[1];
    expect(second).toBeTruthy();
    second.open();
    expect(sentTypes(second)).toEqual(["reconnect"]);
    ws.disconnect();
  });

  it("被新设备替换后不再自动重连并通知认证失效", async () => {
    const events: { reason: string; token: string }[] = [];
    const ws = useWebSocket();
    const off = ws.onSessionInvalidated((event) => events.push(event));
    ws.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    first.readyState = MockWebSocket.CLOSED;
    first.onclose?.({ code: 4002 });

    await new Promise((r) => setTimeout(r, 1100));
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(ws.isReconnecting.value).toBe(false);
    expect(events).toEqual([{ reason: "replaced", token: "test-token" }]);
    off();
  });

  it("旧 socket 的迟到 close 不会清空新 socket", () => {
    const ws = useWebSocket();
    ws.connect();
    const first = MockWebSocket.instances[0];
    first.open();
    ws.disconnect();

    ws.connect();
    const second = MockWebSocket.instances[1];
    second.open();
    first.onclose?.({ code: 4002 });

    expect(ws.isOpen()).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
