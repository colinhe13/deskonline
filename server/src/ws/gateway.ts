import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";
import { verifyToken, JwtPayload } from "../auth/auth.service.js";
import { createServerMessage, parseClientMessage } from "./protocol.js";
import { LobbyHandler } from "../lobby/lobby.handler.js";

interface ConnectedClient {
  ws: WebSocket;
  user: JwtPayload;
  alive: boolean;
}

const HEARTBEAT_INTERVAL = 30_000;

export class WebSocketGateway {
  private wss: WebSocketServer;
  private clients: Map<string, ConnectedClient> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval>;
  private lobbyHandler: LobbyHandler;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.lobbyHandler = new LobbyHandler(this);
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL);
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Missing token");
      return;
    }

    let user: JwtPayload;
    try {
      user = verifyToken(token);
    } catch {
      ws.close(4001, "Invalid token");
      return;
    }

    const existing = this.clients.get(user.userId);
    if (existing) {
      existing.ws.close(4002, "Replaced by new connection");
    }

    const client: ConnectedClient = { ws, user, alive: true };
    this.clients.set(user.userId, client);

    ws.on("pong", () => {
      client.alive = true;
    });

    ws.on("message", (data) => {
      const msg = parseClientMessage(data.toString());
      if (msg) {
        this.handleMessage(user.userId, msg.type, msg.payload);
      }
    });

    ws.on("close", () => {
      if (this.clients.get(user.userId)?.ws === ws) {
        this.clients.delete(user.userId);
        this.onDisconnect(user.userId);
      }
    });

    ws.send(createServerMessage("connected", { userId: user.userId, username: user.username }));
  }

  private handleMessage(userId: string, type: string, payload: unknown) {
    const client = this.clients.get(userId);
    if (!client) return;
    if (type.startsWith("room:")) {
      this.lobbyHandler.handleMessage(userId, client.user.username, type, payload);
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

  destroy() {
    clearInterval(this.heartbeatTimer);
    this.wss.close();
  }
}
