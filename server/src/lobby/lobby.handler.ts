import { WebSocketGateway } from "../ws/gateway.js";
import { roomManager } from "./room.manager.js";
import { deductPoints, addPoints } from "../points/points.service.js";
import { PokerEngine } from "../poker/engine.js";
import { Room } from "./room.js";
import { livekitService } from "../voice/livekit.service.js";

export class LobbyHandler {
  private engines: Map<string, PokerEngine> = new Map();

  constructor(private gateway: WebSocketGateway) {}

  async handleMessage(userId: string, username: string, type: string, payload: unknown) {
    switch (type) {
      case "room:join":
        await this.handleJoinRoom(userId, username, payload);
        break;
      case "room:confirm":
        await this.handleConfirmBuyIn(userId, payload);
        break;
      case "room:leave":
        await this.handleLeaveRoom(userId);
        break;
      case "room:update-settings":
        await this.handleUpdateSettings(userId, payload);
        break;
      case "room:transfer-host":
        this.handleTransferHost(userId, payload);
        break;
      case "room:move-seat":
        this.handleMoveSeat(userId, payload);
        break;
      case "room:start":
        this.handleStartGame(userId);
        break;
      case "poker:action":
        this.handlePokerAction(userId, payload);
        break;
      case "reconnect":
        this.handleReconnect(userId, username);
        break;
      case "room:list:request":
        this.sendRoomListToUser(userId);
        break;
      default:
        break;
    }
  }

  private handlePokerAction(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;
    const engine = this.engines.get(room.id);
    if (!engine) return;

    const p = payload as { action: string; amount?: number };
    engine.handleAction(userId, p.action, p.amount);
  }

  private startEngine(room: Room) {
    const players = room.confirmedSeats().map((s) => ({
      userId: s.userId!,
      username: s.username!,
      seatIndex: s.index,
      chips: s.chips,
    }));

    const engine = new PokerEngine(
      players,
      room.settings.smallBlind,
      room.settings.bigBlind,
      0,
      (type, payload) => this.broadcastEngineMessage(room, type, payload),
    );

    this.engines.set(room.id, engine);
    engine.startHand();
  }

  private broadcastEngineMessage(room: Room, type: string, payload: unknown) {
    if (type === "poker:update") {
      const p = payload as { targetUserId: string; state: unknown; availableActions: unknown };
      this.gateway.sendToUser(p.targetUserId, "poker:update", {
        state: p.state,
        availableActions: p.availableActions,
      });
    } else if (type === "poker:hand_result") {
      room.broadcast(this.gateway, "poker:hand_result", payload);
      const engine = this.engines.get(room.id);
      if (engine) {
        const state = engine.getState();
        for (const p of state.players) {
          const seat = room.findSeatByUserId(p.userId);
          if (seat) seat.chips = p.chips;
        }
      }
      setTimeout(() => {
        const eng = this.engines.get(room.id);
        if (eng && room.status === "playing") {
          const busted = room.markBusted();
          if (busted) {
            // Busted players must rebuy before the table continues.
            room.autoResume = true;
            this.engines.delete(room.id);
            eng.destroy();
            room.status = "waiting";
          } else if (!eng.nextHand()) {
            room.status = "waiting";
            this.engines.delete(room.id);
            eng.destroy();
          }
          room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
        }
      }, 5000);
    }
  }

  private async handleJoinRoom(userId: string, username: string, payload: unknown) {
    const p = payload as { roomId?: string };

    const existing = roomManager.findRoomByPlayer(userId);
    if (existing) {
      this.gateway.sendToUser(userId, "room:error", { code: "ALREADY_IN_ROOM", message: "你已在房间中" });
      return;
    }

    const room = roomManager.getRoom(p?.roomId || "main");
    if (!room) {
      this.gateway.sendToUser(userId, "room:error", { code: "ROOM_NOT_FOUND", message: "房间不存在" });
      return;
    }

    if (room.isFull) {
      this.gateway.sendToUser(userId, "room:error", { code: "ROOM_FULL", message: "房间已满" });
      return;
    }

    if (room.status === "playing") {
      this.gateway.sendToUser(userId, "room:error", { code: "GAME_IN_PROGRESS", message: "游戏进行中，请稍后再进入" });
      return;
    }

    room.addPlayer(userId, username);
    this.broadcastLobbyList();
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.sendVoiceToken(userId, username, room.id);
  }

  private async handleConfirmBuyIn(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    const seat = room.findSeatByUserId(userId);
    if (!seat) return;

    if (room.status === "playing") {
      this.gateway.sendToUser(userId, "room:error", { code: "GAME_IN_PROGRESS", message: "游戏进行中，无法修改带入" });
      return;
    }

    const p = payload as { buyIn?: number };
    const buyIn = p?.buyIn ?? 0;
    if (buyIn < room.settings.minBuyIn || buyIn > room.settings.maxBuyIn) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "INVALID_BUYIN",
        message: `带入金额需在 ${room.settings.minBuyIn} - ${room.settings.maxBuyIn} 之间`,
      });
      return;
    }

    try {
      if (seat.confirmed) {
        // Adjust already-committed chips to the new buy-in.
        const net = buyIn - seat.chips;
        if (net > 0) await deductPoints(userId, net);
        else if (net < 0) await addPoints(userId, -net);
      } else {
        await deductPoints(userId, buyIn);
      }
    } catch {
      this.gateway.sendToUser(userId, "room:error", { code: "INSUFFICIENT_POINTS", message: "积分不足" });
      return;
    }

    room.confirmBuyIn(userId, buyIn);
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.tryResumeGame(room);
  }

  // After a busted-pause, auto-resume once enough confirmed players have chips.
  private tryResumeGame(room: Room) {
    if (!room.autoResume || room.status !== "waiting") return;
    const confirmed = room.confirmedSeats();
    if (confirmed.length < 2) return;
    if (confirmed.some((s) => s.chips <= 0)) return;
    room.autoResume = false;
    room.status = "playing";
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.startEngine(room);
  }

  private async handleUpdateSettings(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.hostId !== userId) {
      this.gateway.sendToUser(userId, "room:error", { code: "NOT_HOST", message: "只有房主可以修改设置" });
      return;
    }
    if (room.status === "playing") {
      this.gateway.sendToUser(userId, "room:error", { code: "GAME_IN_PROGRESS", message: "游戏进行中，无法修改设置" });
      return;
    }

    const p = payload as {
      maxPlayers?: number;
      smallBlind?: number;
      bigBlind?: number;
      minBuyIn?: number;
      maxBuyIn?: number;
    };

    const maxPlayers = p.maxPlayers ?? room.settings.maxPlayers;
    const smallBlind = p.smallBlind ?? room.settings.smallBlind;
    const bigBlind = p.bigBlind ?? room.settings.bigBlind;
    const minBuyIn = p.minBuyIn ?? room.settings.minBuyIn;
    const maxBuyIn = p.maxBuyIn ?? room.settings.maxBuyIn;

    if (maxPlayers < 2 || maxPlayers > 9 || maxPlayers < room.playerCount) {
      this.gateway.sendToUser(userId, "room:error", { code: "INVALID_SETTINGS", message: "人数设置无效" });
      return;
    }
    if (smallBlind <= 0 || bigBlind <= smallBlind) {
      this.gateway.sendToUser(userId, "room:error", { code: "INVALID_SETTINGS", message: "盲注设置无效" });
      return;
    }
    if (minBuyIn < bigBlind || maxBuyIn < minBuyIn) {
      this.gateway.sendToUser(userId, "room:error", { code: "INVALID_SETTINGS", message: "带入范围设置无效" });
      return;
    }

    // Changing settings voids every player's committed buy-in; refund them.
    const refunds = room.clearConfirmations();
    for (const r of refunds) {
      await addPoints(r.userId, r.chips);
    }

    room.settings = { maxPlayers, smallBlind, bigBlind, minBuyIn, maxBuyIn };
    this.broadcastLobbyList();
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
  }

  private handleTransferHost(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.hostId !== userId) {
      this.gateway.sendToUser(userId, "room:error", { code: "NOT_HOST", message: "只有房主可以移交房主" });
      return;
    }

    const p = payload as { targetUserId?: string };
    if (!p?.targetUserId || !room.transferHost(p.targetUserId)) {
      this.gateway.sendToUser(userId, "room:error", { code: "INVALID_TARGET", message: "目标玩家不在房间中" });
      return;
    }

    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
  }

  private handleMoveSeat(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.status === "playing") {
      this.gateway.sendToUser(userId, "room:error", { code: "GAME_IN_PROGRESS", message: "游戏进行中，无法换座" });
      return;
    }

    const p = payload as { seatIndex?: number };
    if (typeof p?.seatIndex !== "number") return;

    if (!room.moveSeat(userId, p.seatIndex)) {
      this.gateway.sendToUser(userId, "room:error", { code: "SEAT_TAKEN", message: "该座位已被占用" });
      return;
    }

    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
  }

  private handleStartGame(userId: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.hostId !== userId) {
      this.gateway.sendToUser(userId, "room:error", { code: "NOT_HOST", message: "只有房主可以开始游戏" });
      return;
    }
    if (room.status === "playing") return;

    if (room.confirmedCount < 2) {
      this.gateway.sendToUser(userId, "room:error", { code: "NOT_ENOUGH_PLAYERS", message: "至少需要2名已确认带入的玩家" });
      return;
    }

    room.status = "playing";
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.startEngine(room);
  }

  private async handleLeaveRoom(userId: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    this.gateway.sendToUser(userId, "voice:disconnect", {});
    await this.ejectPlayer(room, userId);
  }

  // Removes a player, settling chips and keeping the system room alive.
  private async ejectPlayer(room: Room, userId: string) {
    const engine = this.engines.get(room.id);
    const state = engine?.getState();
    const wasInHand = !!state && state.players.some((p) => p.userId === userId);
    // Once a hand is settled, seat chips are final (already synced from the
    // engine); voiding would add stale totalBet on top and mint points.
    const handSettled = !!state && state.phase === "settled";

    if (engine && wasInHand && !handSettled) {
      this.voidHandToSeats(room, engine);
    }

    const chips = room.removePlayer(userId);
    await addPoints(userId, chips);

    if (engine && wasInHand) {
      engine.destroy();
      this.engines.delete(room.id);
      if (room.confirmedCount >= 2) {
        this.startEngine(room); // continue with a fresh hand among remaining players
      } else {
        room.status = "waiting";
      }
    }

    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.broadcastLobbyList();
  }

  private voidHandToSeats(room: Room, engine: PokerEngine) {
    const state = engine.getState();
    for (const p of state.players) {
      const seat = room.findSeatByUserId(p.userId);
      if (seat) seat.chips = p.chips + p.totalBet; // void the in-progress hand
    }
  }

  handleDisconnect(userId: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    room.markDisconnected(userId);
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });

    setTimeout(async () => {
      const currentRoom = roomManager.findRoomByPlayer(userId);
      if (!currentRoom) return;
      const seat = currentRoom.findSeatByUserId(userId);
      if (seat && !seat.connected) {
        await this.ejectPlayer(currentRoom, userId);
      }
    }, 60_000);
  }

  broadcastLobbyList() {
    this.gateway.broadcastAll("room:list", { rooms: roomManager.listRooms() });
  }

  sendRoomListToUser(userId: string) {
    this.gateway.sendToUser(userId, "room:list", { rooms: roomManager.listRooms() });
  }

  private handleReconnect(userId: string, username: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) {
      this.gateway.sendToUser(userId, "reconnect:failed", { reason: "NO_ACTIVE_ROOM" });
      return;
    }

    room.markReconnected(userId);
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });

    const engine = this.engines.get(room.id);
    if (engine) {
      const state = engine.getStateForPlayer(userId);
      const actions = engine.getAvailableActionsForPlayer(userId);
      this.gateway.sendToUser(userId, "poker:update", { state, availableActions: actions });
    }

    this.sendVoiceToken(userId, username, room.id);
    this.gateway.sendToUser(userId, "reconnect:success", { roomId: room.id });
  }

  private async sendVoiceToken(userId: string, username: string, roomId: string) {
    const roomName = livekitService.getRoomName(roomId);
    const token = await livekitService.generateToken(roomName, userId, username);
    const url = livekitService.getClientUrl();
    this.gateway.sendToUser(userId, "voice:token", { token, url });
  }
}
