import { WebSocketGateway } from "../ws/gateway.js";
import { roomManager } from "./room.manager.js";
import { deductPoints, addPoints } from "../points/points.service.js";
import { PokerEngine } from "../poker/engine.js";
import { Room } from "./room.js";
import { livekitService } from "../voice/livekit.service.js";
import { isAiUserId, pickFreeAi } from "../ai/accounts.js";
import { decideAiAction } from "../ai/decision.js";
import { config } from "../config.js";
import { ActionOption } from "../poker/types.js";

const SETTLEMENT_WINDOW_MS = 5000;

export class LobbyHandler {
  private engines: Map<string, PokerEngine> = new Map();
  // roomId -> userId of the AI currently awaiting an LLM decision.
  private aiPending: Map<string, string> = new Map();
  // Bumped whenever a room's engine is replaced, invalidating stale timers.
  private engineGeneration: Map<string, number> = new Map();

  constructor(private gateway: WebSocketGateway) {}

  async handleMessage(
    userId: string,
    username: string,
    type: string,
    payload: unknown,
  ) {
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
      case "poker:reveal":
        this.handleRevealCards(userId);
        break;
      case "reconnect":
        this.handleReconnect(userId, username);
        break;
      case "room:list:request":
        this.sendRoomListToUser(userId);
        break;
      case "ai:add":
        await this.handleAddAi(userId);
        break;
      case "ai:remove":
        await this.handleRemoveAi(userId, payload);
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

  private handleRevealCards(userId: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;
    const engine = this.engines.get(room.id);
    if (!engine) return;
    engine.revealCards(userId);
  }

  // ------------------------------------------------------------------
  // Engine lifecycle
  // ------------------------------------------------------------------

  private bumpGeneration(roomId: string) {
    this.engineGeneration.set(
      roomId,
      (this.engineGeneration.get(roomId) ?? 0) + 1,
    );
  }

  // keepDealer=true reuses the previous dealer (voided hand); otherwise the
  // button advances to the next seat in the rebuilt roster.
  private startEngine(room: Room, keepDealer = false) {
    const players = room.confirmedSeats().map((s) => ({
      userId: s.userId!,
      username: s.username!,
      seatIndex: s.index,
      chips: s.chips,
      isAi: s.isAi,
    }));

    const dealerIndex = this.resolveDealerIndex(room, players, keepDealer);
    room.dealerSeatIndex = null;

    const engine = new PokerEngine(
      players,
      room.settings.smallBlind,
      room.settings.bigBlind,
      dealerIndex,
      (type, payload) => this.broadcastEngineMessage(room, type, payload),
    );

    this.engines.set(room.id, engine);
    this.bumpGeneration(room.id);
    engine.startHand();
  }

  private resolveDealerIndex(
    room: Room,
    players: { seatIndex: number }[],
    keepDealer: boolean,
  ): number {
    if (players.length === 0) return 0;
    const seatIndexes = players.map((p) => p.seatIndex);
    const prevDealerSeat = room.dealerSeatIndex;
    if (prevDealerSeat === null) return 0;
    if (keepDealer && seatIndexes.includes(prevDealerSeat)) {
      return players.findIndex((p) => p.seatIndex === prevDealerSeat);
    }
    const after = seatIndexes.filter((i) => i > prevDealerSeat);
    const nextSeat =
      after.length > 0 ? Math.min(...after) : Math.min(...seatIndexes);
    const idx = players.findIndex((p) => p.seatIndex === nextSeat);
    return idx >= 0 ? idx : 0;
  }

  private destroyEngine(room: Room) {
    const engine = this.engines.get(room.id);
    if (engine) {
      const state = engine.getState();
      room.dealerSeatIndex =
        state.players[state.dealerIndex]?.seatIndex ?? null;
      engine.destroy();
      this.engines.delete(room.id);
    }
    this.aiPending.delete(room.id);
    this.bumpGeneration(room.id);
  }

  private broadcastEngineMessage(room: Room, type: string, payload: unknown) {
    if (type === "poker:update") {
      const p = payload as {
        targetUserId: string;
        state: unknown;
        availableActions: ActionOption[];
      };
      if (isAiUserId(p.targetUserId)) {
        // AI seats have no WS connection; drive their decisions server-side.
        if (p.availableActions.length > 0) {
          this.scheduleAiTurn(room, p.targetUserId);
        }
      } else {
        this.gateway.sendToUser(p.targetUserId, "poker:update", {
          state: p.state,
          availableActions: p.availableActions,
        });
      }
      this.pushSpectatorView(room);
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
      // Busted humans become unconfirmed (their client shows the rebuy
      // prompt); busted AI seats are handled at the hand boundary.
      let humanBusted = false;
      for (const seat of room.seats) {
        if (seat.userId && seat.confirmed && seat.chips === 0 && !seat.isAi) {
          seat.confirmed = false;
          seat.buyIn = 0;
          humanBusted = true;
        }
      }
      room.autoResume = humanBusted;
      this.aiPending.delete(room.id);
      const gen = this.engineGeneration.get(room.id) ?? 0;
      setTimeout(() => {
        this.handleHandEnd(room, gen).catch((err) => {
          // A settlement failure (e.g. transient DB error) must not leave the
          // room stuck in "playing" with no engine.
          console.error("[lobby] hand settlement failed", err);
          if (!this.engines.get(room.id) && room.status === "playing") {
            room.status = "waiting";
            room.autoResume = true;
            room.broadcast(this.gateway, "room:state", {
              room: room.toDetail(),
            });
          }
        });
      }, SETTLEMENT_WINDOW_MS);
    }
  }

  // ------------------------------------------------------------------
  // AI turn scheduling
  // ------------------------------------------------------------------

  private scheduleAiTurn(room: Room, userId: string) {
    const roomId = room.id;
    if (this.aiPending.has(roomId)) return;
    const engine = this.engines.get(roomId);
    if (!engine) return;
    const state = engine.getState();
    if (state.phase === "showdown" || state.phase === "settled") return;
    const current = state.players[state.currentPlayerIndex];
    if (!current || current.userId !== userId) return;

    this.aiPending.set(roomId, userId);
    console.info(`[ai] turn scheduled for ${userId}`);

    // Last-resort watchdog: whatever happens inside the LLM path, this turn MUST
    // produce a legal action within a bounded time or the table stalls.
    const watchdog = setTimeout(() => {
      const eng = this.engines.get(roomId);
      // A rebuilt engine owns a fresh pending marker; never touch it here.
      if (!eng || eng !== engine) return;
      const st = eng.getState();
      if (st.phase === "showdown" || st.phase === "settled") return;
      if (!this.consumeAiPending(roomId, userId)) return;
      console.warn(`[ai] watchdog forcing fallback action for ${userId}`);
      this.applyFallbackAction(eng, userId);
    }, config.aiTimeoutMs + 5000);

    decideAiAction(state, userId, engine.getAvailableActionsForPlayer(userId))
      .then(({ action, amount }) => {
        clearTimeout(watchdog);
        const eng = this.engines.get(roomId);
        // The table may have changed while the LLM was thinking; a rebuilt
        // engine has already rescheduled this AI's turn on its own.
        if (!eng || eng !== engine) return;
        if (!this.consumeAiPending(roomId, userId)) return;
        const st = eng.getState();
        if (st.phase === "showdown" || st.phase === "settled") return;
        const cur = st.players[st.currentPlayerIndex];
        if (!cur || cur.userId !== userId) return;

        if (!eng.handleAction(userId, action, amount)) {
          console.warn(`[ai] rejected action ${action}, applying fallback`);
          this.applyFallbackAction(eng, userId);
        }
      })
      .catch((err) => {
        clearTimeout(watchdog);
        console.error("[ai] decision failed", err);
        const eng = this.engines.get(roomId);
        if (!eng || eng !== engine) return;
        if (!this.consumeAiPending(roomId, userId)) return;
        this.applyFallbackAction(eng, userId);
      });
  }

  // Atomically claims the pending-AI slot so the decide callback and the
  // watchdog can never both act on the same turn.
  private consumeAiPending(roomId: string, userId: string): boolean {
    if (this.aiPending.get(roomId) !== userId) return false;
    this.aiPending.delete(roomId);
    return true;
  }

  // check -> call -> fold -> allin: every branch is legal by construction,
  // so a fallback can never be rejected and stall the hand.
  private applyFallbackAction(eng: PokerEngine, userId: string) {
    const actions = eng.getAvailableActionsForPlayer(userId);
    const pick =
      actions.find((a) => a.type === "check") ||
      actions.find((a) => a.type === "call") ||
      actions.find((a) => a.type === "fold") ||
      actions.find((a) => a.type === "allin");
    if (!pick) return;
    eng.handleAction(userId, pick.type, pick.amount);
  }

  // ------------------------------------------------------------------
  // Hand boundary: AI rebuy, seat changes, rebuild
  // ------------------------------------------------------------------

  // Applies queued seat changes at a hand boundary. Returns nothing; callers
  // inspect the room afterwards.
  private async settleSeatChanges(room: Room) {
    // Busted AI seats auto-rebuy at the table minimum; leave when the AI
    // account cannot pay.
    for (const seat of room.seats) {
      const uid = seat.userId;
      if (!uid || !seat.isAi || !seat.confirmed || seat.chips !== 0) continue;
      try {
        await deductPoints(uid, room.settings.minBuyIn);
        room.confirmBuyIn(uid, room.settings.minBuyIn);
      } catch {
        room.removePlayer(uid);
      }
    }

    for (const uid of [...room.pendingLeaveUserIds]) {
      const seat = room.findSeatByUserId(uid);
      if (seat) {
        const chips = seat.chips;
        room.removePlayer(uid);
        if (chips > 0) await addPoints(uid, chips);
      }
    }
    room.pendingLeaveUserIds = [];
  }

  private async handleHandEnd(room: Room, gen: number) {
    if (this.engineGeneration.get(room.id) !== gen) return;
    const engine = this.engines.get(room.id);
    if (!engine || room.status !== "playing") return;

    this.destroyEngine(room);
    await this.settleSeatChanges(room);

    if (!room.hasHuman()) {
      await this.removeAllAi(room);
      room.status = "waiting";
      room.autoResume = false;
      room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
      this.broadcastLobbyList();
      return;
    }

    const needsConfirm =
      room.humanSeats().some((s) => !s.confirmed) || room.autoResume;
    if (needsConfirm) {
      room.status = "waiting";
      room.autoResume = true;
      room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
      this.broadcastLobbyList();
      return;
    }

    const roster = room.confirmedSeats().filter((s) => s.chips > 0);
    if (roster.length < 2) {
      room.status = "waiting";
      room.autoResume = false;
      room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
      this.broadcastLobbyList();
      return;
    }

    room.status = "playing";
    this.startEngine(room);
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
  }

  // Removes every AI seat, refunding chips. Enforces "no pure-AI tables".
  private async removeAllAi(room: Room) {
    for (const seat of room.aiSeats()) {
      const uid = seat.userId!;
      const chips = seat.chips;
      room.removePlayer(uid);
      if (chips > 0) await addPoints(uid, chips);
    }
    room.pendingLeaveUserIds = [];
  }

  // ------------------------------------------------------------------
  // Room join / buy-in / leave
  // ------------------------------------------------------------------

  private async handleJoinRoom(
    userId: string,
    username: string,
    payload: unknown,
  ) {
    const p = payload as { roomId?: string; seatIndex?: number };

    const existing = roomManager.findRoomByPlayer(userId);
    if (existing) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "ALREADY_IN_ROOM",
        message: "你已在房间中",
      });
      return;
    }

    const targetRoomId = p?.roomId || "main";
    const spectatingRoom = roomManager.findRoomBySpectator(userId);
    if (spectatingRoom) {
      if (spectatingRoom.id === targetRoomId) {
        this.handleSpectatorJoin(userId, username, spectatingRoom, p?.seatIndex);
        return;
      }
      spectatingRoom.removeSpectator(userId);
    }

    const room = roomManager.getRoom(targetRoomId);
    if (!room) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "ROOM_NOT_FOUND",
        message: "房间不存在",
      });
      return;
    }

    // Mid-hand or full rooms are entered as a spectator; once the room is
    // back to waiting with a free seat, the spectator seats themselves.
    if (room.status === "playing" || room.isFull) {
      this.enterAsSpectator(userId, username, room);
      return;
    }

    room.addPlayer(userId, username);
    this.broadcastLobbyList();
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.sendVoiceToken(userId, username, room.id);
  }

  // A spectator re-joining: sit down when possible, otherwise resend the
  // current snapshot so their view never goes stale.
  private handleSpectatorJoin(
    userId: string,
    username: string,
    room: Room,
    seatIndex?: number,
  ) {
    if (room.status !== "waiting" || room.isFull) {
      this.gateway.sendToUser(userId, "room:state", {
        room: room.toDetail(),
      });
      this.sendSpectatorSnapshot(userId, room);
      return;
    }

    room.removeSpectator(userId);
    room.addPlayer(userId, username);
    if (
      typeof seatIndex === "number" &&
      room.seats[seatIndex]?.userId === null
    ) {
      room.moveSeat(userId, seatIndex);
    }
    this.broadcastLobbyList();
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.sendVoiceToken(userId, username, room.id);
  }

  private enterAsSpectator(userId: string, username: string, room: Room) {
    room.addSpectator(userId, username);
    this.broadcastLobbyList();
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.sendSpectatorSnapshot(userId, room);
  }

  // Spectators get the observer view only — no hole cards, no actions.
  private sendSpectatorSnapshot(userId: string, room: Room) {
    const engine = this.engines.get(room.id);
    if (!engine) return;
    this.gateway.sendToUser(userId, "poker:update", {
      state: engine.getStateForSpectator(),
      availableActions: [],
    });
  }

  // Every engine update also reaches spectators with a single shared payload.
  private pushSpectatorView(room: Room) {
    if (room.spectators.length === 0) return;
    const engine = this.engines.get(room.id);
    if (!engine) return;
    this.gateway.broadcast(
      room.spectators.map((sp) => sp.userId),
      "poker:update",
      { state: engine.getStateForSpectator(), availableActions: [] },
    );
  }

  private async handleConfirmBuyIn(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    const seat = room.findSeatByUserId(userId);
    if (!seat) return;

    if (room.status === "playing") {
      this.gateway.sendToUser(userId, "room:error", {
        code: "GAME_IN_PROGRESS",
        message: "游戏进行中，无法修改带入",
      });
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
      this.gateway.sendToUser(userId, "room:error", {
        code: "INSUFFICIENT_POINTS",
        message: "积分不足",
      });
      return;
    }

    room.confirmBuyIn(userId, buyIn);
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.tryResumeGame(room);
  }

  // After a pause (busted rebuy or queued human), resume once every seated
  // human is confirmed with chips.
  private tryResumeGame(room: Room) {
    if (!room.autoResume || room.status !== "waiting") return;
    const confirmed = room.confirmedSeats();
    if (confirmed.length < 2) return;
    if (confirmed.some((s) => s.chips <= 0)) return;
    if (room.humanSeats().some((s) => !s.confirmed)) return;
    room.autoResume = false;
    room.status = "playing";
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.startEngine(room);
  }

  private async handleUpdateSettings(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.hostId !== userId) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "NOT_HOST",
        message: "只有房主可以修改设置",
      });
      return;
    }
    if (room.status === "playing") {
      this.gateway.sendToUser(userId, "room:error", {
        code: "GAME_IN_PROGRESS",
        message: "游戏进行中，无法修改设置",
      });
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
      this.gateway.sendToUser(userId, "room:error", {
        code: "INVALID_SETTINGS",
        message: "人数设置无效",
      });
      return;
    }
    if (smallBlind <= 0 || bigBlind <= smallBlind) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "INVALID_SETTINGS",
        message: "盲注设置无效",
      });
      return;
    }
    if (minBuyIn < bigBlind || maxBuyIn < minBuyIn) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "INVALID_SETTINGS",
        message: "带入范围设置无效",
      });
      return;
    }

    // Changing settings voids every player's committed buy-in; refund them.
    const refunds = room.clearConfirmations();
    for (const r of refunds) {
      await addPoints(r.userId, r.chips);
    }

    room.settings = { maxPlayers, smallBlind, bigBlind, minBuyIn, maxBuyIn };

    // AI seats re-confirm automatically at the new minimum buy-in so a
    // settings change never strands them unconfirmed.
    for (const seat of room.aiSeats()) {
      try {
        await deductPoints(seat.userId!, room.settings.minBuyIn);
        room.confirmBuyIn(seat.userId!, room.settings.minBuyIn);
      } catch {
        room.removePlayer(seat.userId!);
      }
    }

    this.broadcastLobbyList();
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
  }

  private handleTransferHost(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.hostId !== userId) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "NOT_HOST",
        message: "只有房主可以移交房主",
      });
      return;
    }

    const p = payload as { targetUserId?: string };
    const targetSeat = p?.targetUserId
      ? room.findSeatByUserId(p.targetUserId)
      : undefined;
    if (!targetSeat) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "INVALID_TARGET",
        message: "目标玩家不在房间中",
      });
      return;
    }
    if (targetSeat.isAi) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "INVALID_TARGET",
        message: "不能把房主移交给 AI",
      });
      return;
    }

    room.transferHost(p!.targetUserId!);
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
  }

  private handleMoveSeat(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.status === "playing") {
      this.gateway.sendToUser(userId, "room:error", {
        code: "GAME_IN_PROGRESS",
        message: "游戏进行中，无法换座",
      });
      return;
    }

    const p = payload as { seatIndex?: number };
    if (typeof p?.seatIndex !== "number") return;

    if (!room.moveSeat(userId, p.seatIndex)) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "SEAT_TAKEN",
        message: "该座位已被占用",
      });
      return;
    }

    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
  }

  private handleStartGame(userId: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.hostId !== userId) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "NOT_HOST",
        message: "只有房主可以开始游戏",
      });
      return;
    }
    if (room.status === "playing") return;

    if (room.confirmedCount < 2) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "NOT_ENOUGH_PLAYERS",
        message: "至少需要2名已确认带入的玩家",
      });
      return;
    }

    room.status = "playing";
    room.autoResume = false;
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.startEngine(room);
  }

  private async handleLeaveRoom(userId: string) {
    const spectatingRoom = roomManager.findRoomBySpectator(userId);
    if (spectatingRoom) {
      spectatingRoom.removeSpectator(userId);
      this.broadcastLobbyList();
      spectatingRoom.broadcast(this.gateway, "room:state", {
        room: spectatingRoom.toDetail(),
      });
      return;
    }

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
      this.destroyEngine(room);
      await this.settleSeatChanges(room);

      if (!room.hasHuman()) {
        await this.removeAllAi(room);
        room.status = "waiting";
        room.autoResume = false;
      } else {
        const needsConfirm =
          room.humanSeats().some((s) => !s.confirmed) || room.autoResume;
        if (needsConfirm) {
          room.status = "waiting";
          room.autoResume = true;
        } else if (room.confirmedCount >= 2) {
          room.status = "playing";
          // A voided hand replays with the same dealer; a settled hand advances.
          this.startEngine(room, !handSettled);
        } else {
          room.status = "waiting";
        }
      }
    } else if (!room.hasHuman()) {
      await this.removeAllAi(room);
      room.status = "waiting";
      room.autoResume = false;
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
    const spectatingRoom = roomManager.findRoomBySpectator(userId);
    if (spectatingRoom) {
      spectatingRoom.removeSpectator(userId);
      this.broadcastLobbyList();
      spectatingRoom.broadcast(this.gateway, "room:state", {
        room: spectatingRoom.toDetail(),
      });
      return;
    }

    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    room.markDisconnected(userId);
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });

    setTimeout(async () => {
      const currentRoom = roomManager.findRoomByPlayer(userId);
      if (!currentRoom) return;
      const seat = currentRoom.findSeatByUserId(userId);
      if (seat && !seat.connected) {
        try {
          await this.ejectPlayer(currentRoom, userId);
        } catch (err) {
          console.error("[lobby] disconnect eject failed", err);
        }
      }
    }, 60_000);
  }

  // ------------------------------------------------------------------
  // AI management (host-only)
  // ------------------------------------------------------------------

  private async handleAddAi(userId: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.hostId !== userId) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "NOT_HOST",
        message: "只有房主可以添加 AI",
      });
      return;
    }
    if (room.isFull) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "ROOM_FULL",
        message: "房间已满，无法添加 AI",
      });
      return;
    }

    const account = pickFreeAi(room);
    if (!account) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "NO_FREE_AI",
        message: "没有空闲的 AI 账号",
      });
      return;
    }

    room.addPlayer(account.id, account.username, true);
    try {
      await deductPoints(account.id, room.settings.minBuyIn);
    } catch {
      room.removePlayer(account.id);
      this.gateway.sendToUser(userId, "room:error", {
        code: "AI_INSUFFICIENT_POINTS",
        message: "AI 账号积分不足",
      });
      return;
    }
    room.confirmBuyIn(account.id, room.settings.minBuyIn);

    this.broadcastLobbyList();
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.tryResumeGame(room);
  }

  private async handleRemoveAi(userId: string, payload: unknown) {
    const room = roomManager.findRoomByPlayer(userId);
    if (!room) return;

    if (room.hostId !== userId) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "NOT_HOST",
        message: "只有房主可以移除 AI",
      });
      return;
    }

    const p = payload as { targetUserId?: string };
    const targetId = p?.targetUserId;
    const seat = targetId ? room.findSeatByUserId(targetId) : undefined;
    if (!seat || !seat.isAi) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "NOT_AI",
        message: "目标不是 AI 玩家",
      });
      return;
    }

    if (room.status === "playing") {
      // Mid-hand removal takes effect once the current hand settles.
      if (!room.pendingLeaveUserIds.includes(targetId!)) {
        room.pendingLeaveUserIds.push(targetId!);
      }
      room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
      return;
    }

    const chips = room.removePlayer(targetId!);
    if (chips > 0) await addPoints(targetId!, chips);
    this.broadcastLobbyList();
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
  }

  // ------------------------------------------------------------------
  // Misc
  // ------------------------------------------------------------------

  broadcastLobbyList() {
    this.gateway.broadcastAll("room:list", { rooms: roomManager.listRooms() });
  }

  sendRoomListToUser(userId: string) {
    this.gateway.sendToUser(userId, "room:list", {
      rooms: roomManager.listRooms(),
    });
  }

  private handleReconnect(userId: string, username: string) {
    const room = roomManager.findRoomByPlayer(userId);
    if (room) {
      room.markReconnected(userId);
      room.broadcast(this.gateway, "room:state", { room: room.toDetail() });

      const engine = this.engines.get(room.id);
      if (engine) {
        const state = engine.getStateForPlayer(userId);
        const actions = engine.getAvailableActionsForPlayer(userId);
        this.gateway.sendToUser(userId, "poker:update", {
          state,
          availableActions: actions,
        });
      }

      this.sendVoiceToken(userId, username, room.id);
      this.gateway.sendToUser(userId, "reconnect:success", { roomId: room.id });
      return;
    }

    const spectatingRoom = roomManager.findRoomBySpectator(userId);
    if (spectatingRoom) {
      spectatingRoom.broadcast(this.gateway, "room:state", {
        room: spectatingRoom.toDetail(),
      });
      this.sendSpectatorSnapshot(userId, spectatingRoom);
      this.gateway.sendToUser(userId, "reconnect:success", {
        roomId: spectatingRoom.id,
      });
      return;
    }

    this.gateway.sendToUser(userId, "reconnect:failed", {
      reason: "NO_ACTIVE_ROOM",
    });
  }

  private async sendVoiceToken(
    userId: string,
    username: string,
    roomId: string,
  ) {
    const roomName = livekitService.getRoomName(roomId);
    const token = await livekitService.generateToken(
      roomName,
      userId,
      username,
    );
    const url = livekitService.getClientUrl();
    this.gateway.sendToUser(userId, "voice:token", { token, url });
  }
}
