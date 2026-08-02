import { WebSocketGateway } from "../ws/gateway.js";
import { roomManager } from "./room.manager.js";
import { deductPoints, addPoints } from "../points/points.service.js";

export class LobbyHandler {
  constructor(private gateway: WebSocketGateway) {}

  async handleMessage(userId: string, username: string, type: string, payload: unknown) {
    switch (type) {
      case "room:create":
        await this.handleCreateRoom(userId, username, payload);
        break;
      case "room:join":
        await this.handleJoinRoom(userId, username, payload);
        break;
      case "room:leave":
        await this.handleLeaveRoom(userId);
        break;
      case "room:start":
        await this.handleStartGame(userId);
        break;
      default:
        break;
    }
  }

  private async handleCreateRoom(userId: string, username: string, payload: unknown) {
    const p = payload as {
      maxPlayers?: number;
      smallBlind?: number;
      bigBlind?: number;
      minBuyIn?: number;
      maxBuyIn?: number;
    };

    const existing = roomManager.findRoomByPlayer(userId);
    if (existing) {
      this.gateway.sendToUser(userId, "room:error", { code: "ALREADY_IN_ROOM", message: "你已在房间中" });
      return;
    }

    const maxPlayers = Math.min(Math.max(p?.maxPlayers || 9, 2), 9);
    const smallBlind = p?.smallBlind || 10;
    const bigBlind = p?.bigBlind || 20;
    const minBuyIn = p?.minBuyIn || bigBlind * 10;
    const maxBuyIn = p?.maxBuyIn || bigBlind * 100;

    const room = roomManager.createRoom({
      hostId: userId,
      maxPlayers,
      smallBlind,
      bigBlind,
      minBuyIn,
      maxBuyIn,
    });

    try {
      await deductPoints(userId, minBuyIn);
    } catch {
      roomManager.destroyRoom(room.config.id);
      this.gateway.sendToUser(userId, "room:error", { code: "INSUFFICIENT_POINTS", message: "积分不足" });
      return;
    }

    room.addPlayer(userId, username, minBuyIn);
    this.broadcastLobbyList();
    this.gateway.sendToUser(userId, "room:state", { room: room.toDetail() });
  }

  private async handleJoinRoom(userId: string, username: string, payload: unknown) {
    const p = payload as { roomId?: string; buyIn?: number };

    const existing = roomManager.findRoomByPlayer(userId);
    if (existing) {
      this.gateway.sendToUser(userId, "room:error", { code: "ALREADY_IN_ROOM", message: "你已在房间中" });
      return;
    }

    const room = roomManager.getRoom(p?.roomId || "");
    if (!room) {
      this.gateway.sendToUser(userId, "room:error", { code: "ROOM_NOT_FOUND", message: "房间不存在" });
      return;
    }

    if (room.isFull) {
      this.gateway.sendToUser(userId, "room:error", { code: "ROOM_FULL", message: "房间已满" });
      return;
    }

    if (room.status === "playing") {
      this.gateway.sendToUser(userId, "room:error", { code: "GAME_IN_PROGRESS", message: "游戏进行中" });
      return;
    }

    const buyIn = p?.buyIn || room.config.minBuyIn;
    if (buyIn < room.config.minBuyIn || buyIn > room.config.maxBuyIn) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "INVALID_BUYIN",
        message: `带入金额需在 ${room.config.minBuyIn} - ${room.config.maxBuyIn} 之间`,
      });
      return;
    }

    try {
      await deductPoints(userId, buyIn);
    } catch {
      this.gateway.sendToUser(userId, "room:error", { code: "INSUFFICIENT_POINTS", message: "积分不足" });
      return;
    }

    room.addPlayer(userId, username, buyIn);
    this.broadcastLobbyList();
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
  }

  private async handleLeaveRoom(userId: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    const chips = room.removePlayer(userId);
    await addPoints(userId, chips);

    if (room.config.hostId === userId || room.playerCount === 0) {
      for (const seat of room.seats) {
        if (seat.userId) {
          await addPoints(seat.userId, seat.chips);
          this.gateway.sendToUser(seat.userId, "room:state", { room: null, reason: "HOST_LEFT" });
        }
      }
      roomManager.destroyRoom(room.config.id);
    } else {
      room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    }

    this.broadcastLobbyList();
  }

  private async handleStartGame(userId: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.config.hostId !== userId) {
      this.gateway.sendToUser(userId, "room:error", { code: "NOT_HOST", message: "只有房主可以开始游戏" });
      return;
    }

    if (room.playerCount < 2) {
      this.gateway.sendToUser(userId, "room:error", { code: "NOT_ENOUGH_PLAYERS", message: "至少需要2名玩家" });
      return;
    }

    room.status = "playing";
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    // Phase 3: PokerEngine will be started here
  }

  handleDisconnect(userId: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    room.markDisconnected(userId);
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });

    // Phase 5 will add 60s timeout and auto-removal
    setTimeout(async () => {
      const currentRoom = roomManager.findRoomByPlayer(userId);
      if (currentRoom) {
        const seat = currentRoom.findSeatByUserId(userId);
        if (seat && !seat.connected) {
          const chips = currentRoom.removePlayer(userId);
          await addPoints(userId, chips);

          if (currentRoom.config.hostId === userId || currentRoom.playerCount === 0) {
            for (const s of currentRoom.seats) {
              if (s.userId) {
                await addPoints(s.userId, s.chips);
                this.gateway.sendToUser(s.userId, "room:state", { room: null, reason: "HOST_LEFT" });
              }
            }
            roomManager.destroyRoom(currentRoom.config.id);
          } else {
            currentRoom.broadcast(this.gateway, "room:state", { room: currentRoom.toDetail() });
          }
          this.broadcastLobbyList();
        }
      }
    }, 60_000);
  }

  broadcastLobbyList() {
    this.gateway.broadcastAll("room:list", { rooms: roomManager.listRooms() });
  }
}
