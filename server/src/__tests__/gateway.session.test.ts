import { createServer, type Server } from "node:http";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";

const mocks = vi.hoisted(() => ({
  verifyActiveToken: vi.fn(),
  handleMessage: vi.fn(),
  getLeaderboard: vi.fn(),
}));

vi.mock("../auth/auth.service.js", () => ({
  verifyActiveToken: mocks.verifyActiveToken,
}));

vi.mock("../leaderboard/leaderboard.service.js", () => ({
  getLeaderboard: mocks.getLeaderboard,
}));

vi.mock("../lobby/lobby.handler.js", () => ({
  LobbyHandler: class {
    constructor(_gateway: unknown) {}

    sendRoomListToUser() {}

    handleDisconnect() {}

    handleMessage(...args: unknown[]) {
      return mocks.handleMessage(...args);
    }

    getTableChipsByUserId() {
      return new Map();
    }
  },
}));

import { WebSocketGateway } from "../ws/gateway.js";

function listen(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function waitForClose(socket: WebSocket) {
  return new Promise<number>((resolve) => {
    socket.once("close", (code) => resolve(code));
  });
}

describe("WebSocketGateway session replacement", () => {
  let server: Server;
  let gateway: WebSocketGateway;

  beforeEach(async () => {
    mocks.handleMessage.mockReset();
    mocks.handleMessage.mockResolvedValue(undefined);
    mocks.getLeaderboard.mockReset();
    mocks.getLeaderboard.mockResolvedValue([]);
    mocks.verifyActiveToken.mockReset();
    mocks.verifyActiveToken.mockImplementation(async (token: string) => ({
      userId: "u1",
      username: "alice",
      sessionVersion: token === "new-token" ? 2 : 1,
    }));
    server = createServer();
    gateway = new WebSocketGateway(server);
    await listen(server);
  });

  afterEach(async () => {
    gateway.destroy();
    await close(server);
  });

  function url(token: string) {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not start");
    }
    return `ws://127.0.0.1:${address.port}/ws?token=${token}`;
  }

  it("rejects a token that the active-session verifier rejects", async () => {
    mocks.verifyActiveToken.mockRejectedValueOnce(new Error("SESSION_INVALID"));
    const socket = new WebSocket(url("old-token"));

    await expect(waitForClose(socket)).resolves.toBe(4001);
    expect(gateway.getConnectedUserIds()).toEqual([]);
  });

  it("sends the current leaderboard snapshot after connecting", async () => {
    const socket = new WebSocket(url("old-token"));
    const snapshot = new Promise<unknown>((resolve) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as {
          type: string;
          payload: unknown;
        };
        if (message.type === "leaderboard:update") resolve(message.payload);
      });
    });

    await new Promise<void>((resolve) => socket.once("open", () => resolve()));
    await expect(snapshot).resolves.toEqual({ entries: [], revision: 1 });

    const closed = waitForClose(socket);
    socket.close();
    await closed;
  });

  it("closes the old connection when a newer connection is accepted", async () => {
    const first = new WebSocket(url("old-token"));
    await new Promise<void>((resolve) => first.once("open", () => resolve()));
    const firstClosed = waitForClose(first);

    const second = new WebSocket(url("new-token"));
    await new Promise<void>((resolve) => second.once("open", () => resolve()));

    await expect(firstClosed).resolves.toBe(4002);
    expect(gateway.getConnectedUserIds()).toEqual(["u1"]);
    expect(gateway.getClient("u1")?.ws).not.toBe(first);

    const secondClosed = waitForClose(second);
    gateway.disconnectUser("u1", "logout");
    await expect(secondClosed).resolves.toBe(4001);
    expect(gateway.getConnectedUserIds()).toEqual([]);
  });

  it("rejects a handshake that resumes after session invalidation", async () => {
    const first = new WebSocket(url("old-token"));
    await new Promise<void>((resolve) => first.once("open", () => resolve()));
    const firstClosed = waitForClose(first);

    gateway.disconnectUser("u1", "replaced", 2);
    await expect(firstClosed).resolves.toBe(4002);

    const stale = new WebSocket(url("old-token"));
    await expect(waitForClose(stale)).resolves.toBe(4001);
  });

  it("does not let a stale invalidation callback close a newer session", async () => {
    mocks.verifyActiveToken.mockImplementation(async (token: string) => ({
      userId: "u1",
      username: "alice",
      sessionVersion: token === "latest-token" ? 3 : 1,
    }));
    const latest = new WebSocket(url("latest-token"));
    await new Promise<void>((resolve) => latest.once("open", () => resolve()));

    const latestClosed = waitForClose(latest);
    gateway.disconnectUser("u1", "logout", 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(latest.readyState).toBe(WebSocket.OPEN);

    gateway.disconnectUser("u1", "logout", 4);
    await expect(latestClosed).resolves.toBe(4001);
  });
});
