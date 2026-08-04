import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";
import { verifyActiveToken, JwtPayload } from "../auth/auth.service.js";
import {
  createServerMessage,
  parseClientMessage,
  shouldRouteToLobby,
} from "./protocol.js";
import { LobbyHandler } from "../lobby/lobby.handler.js";

interface ConnectedClient {
  ws: WebSocket;
  user: JwtPayload;
  alive: boolean;
  active: boolean;
}

const HEARTBEAT_INTERVAL = 30_000;

export class WebSocketGateway {
  private wss: WebSocketServer;
  private clients: Map<string, ConnectedClient> = new Map();
  private minimumValidSessionVersions: Map<string, number> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval>;
  private lobbyHandler: LobbyHandler;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.lobbyHandler = new LobbyHandler(this);
    this.wss.on("connection", (ws, req) => {
      void this.handleConnection(ws, req);
    });
    this.heartbeatTimer = setInterval(
      () => this.heartbeat(),
      HEARTBEAT_INTERVAL,
    );
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Missing token");
      return;
    }

    let user: JwtPayload;
    try {
      user = await verifyActiveToken(token);
    } catch {
      ws.close(4001, "Invalid token");
      return;
    }

    if (ws.readyState !== WebSocket.OPEN) return;

    const minimumValidSessionVersion = this.minimumValidSessionVersions.get(
      user.userId,
    );
    if (
      minimumValidSessionVersion !== undefined &&
      user.sessionVersion < minimumValidSessionVersion
    ) {
      ws.close(4001, "Invalid token");
      return;
    }

    const existing = this.clients.get(user.userId);
    if (existing) {
      existing.active = false;
      existing.ws.close(4002, "Replaced by new connection");
    }

    const client: ConnectedClient = { ws, user, alive: true, active: true };
    this.clients.set(user.userId, client);

    ws.on("pong", () => {
      client.alive = true;
    });

    ws.on("message", (data) => {
      if (this.clients.get(user.userId)?.ws !== ws || !client.active) {
        return;
      }
      const msg = parseClientMessage(data.toString());
      if (msg) {
        void this.handleMessage(ws, user.userId, msg.type, msg.payload).catch(
          (err) => {
            console.error("[ws] message handling failed", err);
          },
        );
      }
    });

    ws.on("close", () => {
      if (this.clients.get(user.userId)?.ws === ws) {
        this.clients.delete(user.userId);
        if (client.active) this.onDisconnect(user.userId);
      }
    });

    ws.send(
      createServerMessage("connected", {
        userId: user.userId,
        username: user.username,
      }),
    );
    this.lobbyHandler.sendRoomListToUser(user.userId);
  }

  private async handleMessage(
    ws: WebSocket,
    userId: string,
    type: string,
    payload: unknown,
  ): Promise<void> {
    const client = this.clients.get(userId);
    if (!client || client.ws !== ws || !client.active) return;
    if (shouldRouteToLobby(type)) {
      await this.lobbyHandler.handleMessage(
        userId,
        client.user.username,
        type,
        payload,
      );
    }
  }

  private onDisconnect(userId: string) {
    this.lobbyHandler.handleDisconnect(userId);
  }

  private heartbeat() {
    for (const [userId, client] of this.clients) {
      if (!client.alive) {
        client.ws.terminate();
        this.clients.delete(userId);
        this.onDisconnect(userId);
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }

  sendToUser(userId: string, type: string, payload: unknown) {
    const client = this.clients.get(userId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(createServerMessage(type, payload));
    }
  }

  disconnectUser(
    userId: string,
    reason: "replaced" | "logout" = "replaced",
    minimumValidSessionVersion?: number,
  ) {
    if (minimumValidSessionVersion !== undefined) {
      const currentMinimum = this.minimumValidSessionVersions.get(userId);
      if (
        currentMinimum === undefined ||
        minimumValidSessionVersion > currentMinimum
      ) {
        this.minimumValidSessionVersions.set(
          userId,
          minimumValidSessionVersion,
        );
      }
    }

    const client = this.clients.get(userId);
    if (!client) return;

    if (
      minimumValidSessionVersion !== undefined &&
      client.user.sessionVersion >= minimumValidSessionVersion
    ) {
      return;
    }

    const code = reason === "replaced" ? 4002 : 4001;
    const message =
      reason === "replaced" ? "Session replaced" : "Session revoked";
    client.active = false;
    this.clients.delete(userId);
    this.onDisconnect(userId);
    if (
      client.ws.readyState === WebSocket.OPEN ||
      client.ws.readyState === WebSocket.CONNECTING
    ) {
      client.ws.close(code, message);
    }
  }

  broadcast(userIds: string[], type: string, payload: unknown) {
    const data = createServerMessage(type, payload);
    for (const userId of userIds) {
      const client = this.clients.get(userId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  broadcastAll(type: string, payload: unknown) {
    const data = createServerMessage(type, payload);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  getClient(userId: string): ConnectedClient | undefined {
    return this.clients.get(userId);
  }

  getConnectedUserIds(): string[] {
    return [...this.clients.keys()];
  }

  getTableChipsByUserId(): Map<string, number> {
    return this.lobbyHandler.getTableChipsByUserId();
  }

  destroy() {
    clearInterval(this.heartbeatTimer);
    this.wss.close();
  }
}
