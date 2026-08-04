import { randomUUID } from "node:crypto";
import { WebSocketGateway } from "../ws/gateway.js";
import { roomManager } from "./room.manager.js";
import {
  activateBuyInHold,
  addPoints,
  createBuyInHold,
  deductPoints,
  refundBuyInHold,
  settleBuyInHold,
  updateBuyInHoldAmount,
} from "../points/points.service.js";
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
  // Commands that can race with hand settlement are serialized per room.
  private roomCommandQueues: Map<string, Promise<void>> = new Map();
  // Pending reservations keep their spectator slot for the same 60s window as
  // seated players. The timer is transferred to the seat if activation happens
  // while the user is disconnected.
  private pendingDisconnectTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

  constructor(private gateway: WebSocketGateway) {}

  private getRoomIdFromPayload(payload: unknown): string {
    const roomId = (payload as { roomId?: unknown } | null)?.roomId;
    return typeof roomId === "string" && roomId.length > 0 ? roomId : "main";
  }

  private findRoomForUser(userId: string): Room | undefined {
    return (
      roomManager.findRoomByPlayer(userId) ??
      roomManager.findRoomByPendingSeatReservation(userId) ??
      roomManager.findRoomBySpectator(userId)
    );
  }

  private async withRoomCommandLock<T>(
    roomId: string,
    command: () => Promise<T>,
  ): Promise<T> {
    const previous = this.roomCommandQueues.get(roomId);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => current);
    this.roomCommandQueues.set(roomId, tail);

    if (previous) await previous.catch(() => undefined);
    try {
      return await command();
    } finally {
      release();
      if (this.roomCommandQueues.get(roomId) === tail) {
        this.roomCommandQueues.delete(roomId);
      }
    }
  }

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
      case "room:queue-join":
        await this.withRoomCommandLock(this.getRoomIdFromPayload(payload), () =>
          this.handleQueueJoin(userId, username, payload),
        );
        break;
      case "room:cancel-queue-join":
        await this.withRoomCommandLock(
          this.findRoomForUser(userId)?.id ?? "main",
          () => this.handleCancelQueueJoin(userId),
        );
        break;
      case "room:leave":
        await this.withRoomCommandLock(
          this.findRoomForUser(userId)?.id ?? "main",
          () => this.handleLeaveRoom(userId),
        );
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

  // Chips committed to tables, per user. While an engine runs, its state is
  // authoritative (chips + open bet); otherwise the seat holds the chips.
  getTableChipsByUserId(): Map<string, number> {
    const chips = new Map<string, number>();
    const add = (userId: string, amount: number) => {
      if (amount <= 0) return;
      chips.set(userId, (chips.get(userId) ?? 0) + amount);
    };
    for (const room of roomManager.allRooms()) {
      const engine = this.engines.get(room.id);
      if (engine) {
        for (const p of engine.getState().players) {
          add(p.userId, p.chips + p.bet);
        }
      } else {
        for (const seat of room.seats) {
          if (seat.userId) add(seat.userId, seat.chips);
        }
      }
      for (const reservation of room.pendingSeatReservations) {
        add(reservation.userId, reservation.buyIn);
      }
    }
    return chips;
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

  private async settleActiveHolds(room: Room) {
    for (const seat of room.seats) {
      if (!seat.userId || !seat.buyInHoldOperationId) continue;

      if (seat.confirmed && seat.chips > 0) {
        const updated = await updateBuyInHoldAmount(
          seat.buyInHoldOperationId,
          seat.chips,
        );
        if (!updated) throw new Error("HOLD_UPDATE_FAILED");
      } else {
        const settled = await settleBuyInHold(
          seat.buyInHoldOperationId,
          seat.chips,
        );
        if (!settled) throw new Error("HOLD_SETTLEMENT_FAILED");
        seat.buyInHoldOperationId = null;
      }
    }
  }

  private async activatePendingReservations(room: Room) {
    for (const reservation of [...room.pendingSeatReservations]) {
      const target = room.seats[reservation.seatIndex];
      const targetUnavailable = !target || target.userId !== null;
      if (targetUnavailable) {
        const cancelled = await this.cancelPendingReservation(
          room,
          reservation.userId,
        );
        if (!cancelled) {
          console.error(
            `[lobby] failed to refund unavailable reservation ${reservation.operationId}`,
          );
          continue;
        }
        this.sendQueueError(
          reservation.userId,
          "SEAT_UNAVAILABLE",
          "预约座位已不可用，带入积分已返还",
        );
        continue;
      }

      try {
        const activated = await activateBuyInHold(reservation.operationId);
        if (!activated) throw new Error("HOLD_NOT_FOUND");

        const { seat } = room.activatePendingSeatReservation(
          reservation.userId,
        );
        room.removeSpectator(reservation.userId);
        if (seat.connected) {
          this.clearPendingDisconnectTimer(reservation.userId);
          this.sendVoiceToken(
            reservation.userId,
            reservation.username,
            room.id,
          );
        }
        this.gateway.sendToUser(
          reservation.userId,
          "room:queue-join:activated",
          { roomId: room.id, seatIndex: seat.index },
        );
      } catch {
        await refundBuyInHold(reservation.operationId);
        room.removePendingSeatReservation(reservation.userId);
        room.removeSpectator(reservation.userId);
        this.clearPendingDisconnectTimer(reservation.userId);
        this.sendQueueError(
          reservation.userId,
          "QUEUE_JOIN_FAILED",
          "预约未能激活，带入积分已返还",
        );
      }
    }
  }

  private async cancelPendingReservation(room: Room, userId: string) {
    const reservation = room.findPendingSeatReservation(userId);
    if (!reservation) return false;
    const refunded = await refundBuyInHold(reservation.operationId);
    if (!refunded) return false;
    room.removePendingSeatReservation(userId);
    this.clearPendingDisconnectTimer(userId);
    return true;
  }

  private async cancelAllPendingReservations(room: Room) {
    for (const reservation of [...room.pendingSeatReservations]) {
      const cancelled = await this.cancelPendingReservation(
        room,
        reservation.userId,
      );
      if (!cancelled) {
        console.error(
          `[lobby] failed to refund pending reservation ${reservation.operationId}`,
        );
        continue;
      }
      room.removeSpectator(reservation.userId);
      this.sendQueueError(
        reservation.userId,
        "QUEUE_CANCELLED",
        "牌局已结束，预约已取消，带入积分已返还",
      );
    }
  }

  private async handleHandEnd(room: Room, gen: number) {
    return this.withRoomCommandLock(room.id, () =>
      this.handleHandEndUnsafe(room, gen),
    );
  }

  private async handleHandEndUnsafe(room: Room, gen: number) {
    if (this.engineGeneration.get(room.id) !== gen) return;
    const engine = this.engines.get(room.id);
    if (!engine || room.status !== "playing") return;

    this.destroyEngine(room);
    await this.settleSeatChanges(room);
    if (room.seats.some((seat) => seat.buyInHoldOperationId)) {
      await this.settleActiveHolds(room);
    }
    if (room.pendingSeatReservations.length > 0) {
      await this.activatePendingReservations(room);
    }

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
        this.handleSpectatorJoin(
          userId,
          username,
          spectatingRoom,
          p?.seatIndex,
        );
        return;
      }
      if (spectatingRoom.findPendingSeatReservation(userId)) {
        const cancelled = await this.cancelPendingReservation(
          spectatingRoom,
          userId,
        );
        if (!cancelled) {
          this.sendQueueError(
            userId,
            "REFUND_FAILED",
            "预约退款失败，请稍后重试",
          );
          return;
        }
      }
      spectatingRoom.removeSpectator(userId);
      this.broadcastLobbyList();
      spectatingRoom.broadcast(this.gateway, "room:state", {
        room: spectatingRoom.toDetail(),
      });
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
    if (room.findPendingSeatReservation(userId)) {
      this.gateway.sendToUser(userId, "room:state", {
        room: room.toDetail(),
      });
      this.sendSpectatorSnapshot(userId, room);
      return;
    }
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

  private async handleQueueJoin(
    userId: string,
    username: string,
    payload: unknown,
  ): Promise<void> {
    const p =
      (payload as {
        roomId?: unknown;
        seatIndex?: unknown;
        buyIn?: unknown;
      } | null) ?? {};
    const roomId = this.getRoomIdFromPayload(payload);
    const room = roomManager.getRoom(roomId);
    if (!room) {
      this.sendQueueError(userId, "ROOM_NOT_FOUND", "房间不存在");
      return;
    }

    if (roomManager.findRoomBySpectator(userId) !== room) {
      this.sendQueueError(userId, "NOT_SPECTATOR", "请先进入房间观战");
      return;
    }
    if (room.status !== "playing" || !this.engines.has(room.id)) {
      this.sendQueueError(
        userId,
        "GAME_NOT_IN_PROGRESS",
        "当前没有进行中的牌局",
      );
      return;
    }
    if (
      typeof p.seatIndex !== "number" ||
      !room.isValidSeatIndex(p.seatIndex)
    ) {
      this.sendQueueError(userId, "INVALID_SEAT", "座位号无效");
      return;
    }
    if (room.findPendingSeatReservation(userId)) {
      this.sendQueueError(
        userId,
        "PENDING_JOIN_EXISTS",
        "你已经预约了一个座位",
      );
      return;
    }
    if (
      room.isSeatReserved(p.seatIndex) ||
      room.seats[p.seatIndex].userId !== null
    ) {
      this.sendQueueError(userId, "SEAT_TAKEN", "该座位已被占用");
      return;
    }
    if (
      typeof p.buyIn !== "number" ||
      !Number.isInteger(p.buyIn) ||
      p.buyIn < room.settings.minBuyIn ||
      p.buyIn > room.settings.maxBuyIn
    ) {
      this.sendQueueError(
        userId,
        "INVALID_BUYIN",
        `带入金额需在 ${room.settings.minBuyIn} - ${room.settings.maxBuyIn} 之间`,
      );
      return;
    }

    // The operation ID is only an idempotency key. Keep user and room data out
    // of it so UUID-based identities stay within the database column limit.
    const operationId = `midhand:${randomUUID()}`;
    try {
      await createBuyInHold({
        operationId,
        roomId: room.id,
        userId,
        seatIndex: p.seatIndex,
        amount: p.buyIn,
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code !== "INSUFFICIENT_POINTS") {
        console.error("[lobby] createBuyInHold failed", err);
      }
      this.sendQueueError(
        userId,
        code === "INSUFFICIENT_POINTS"
          ? "INSUFFICIENT_POINTS"
          : "QUEUE_JOIN_FAILED",
        code === "INSUFFICIENT_POINTS" ? "积分不足" : "预约入桌失败",
      );
      return;
    }

    try {
      room.addPendingSeatReservation(
        userId,
        username,
        p.seatIndex,
        p.buyIn,
        operationId,
      );
    } catch (err) {
      let refunded = false;
      try {
        refunded = await refundBuyInHold(operationId);
      } catch (refundError) {
        console.error(
          "[lobby] rejected reservation refund failed",
          refundError,
        );
      }
      if (!refunded) {
        console.error(
          `[lobby] failed to refund rejected reservation ${operationId}`,
        );
      }
      const code = err instanceof Error ? err.message : "";
      this.sendQueueError(
        userId,
        code === "PENDING_JOIN_EXISTS" ? code : "SEAT_TAKEN",
        code === "PENDING_JOIN_EXISTS"
          ? "你已经预约了一个座位"
          : "该座位已被占用",
      );
      return;
    }

    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.broadcastLobbyList();
    this.gateway.sendToUser(userId, "room:queue-join:accepted", {
      roomId: room.id,
      seatIndex: p.seatIndex,
    });
  }

  private async handleCancelQueueJoin(userId: string): Promise<void> {
    const room = roomManager.findRoomByPendingSeatReservation(userId);
    if (!room) {
      this.sendQueueError(
        userId,
        "PENDING_JOIN_NOT_FOUND",
        "没有待激活的座位预约",
      );
      return;
    }
    const reservation = room.findPendingSeatReservation(userId);
    if (!reservation) return;

    try {
      const refunded = await refundBuyInHold(reservation.operationId);
      if (!refunded) {
        this.sendQueueError(
          userId,
          "REFUND_FAILED",
          "预约退款失败，请稍后重试",
        );
        return;
      }
    } catch {
      this.sendQueueError(userId, "REFUND_FAILED", "预约退款失败，请稍后重试");
      return;
    }

    this.clearPendingDisconnectTimer(userId);
    room.removePendingSeatReservation(userId);
    room.broadcast(this.gateway, "room:state", { room: room.toDetail() });
    this.broadcastLobbyList();
    this.gateway.sendToUser(userId, "room:queue-join:cancelled", {
      roomId: room.id,
    });
  }

  private sendQueueError(userId: string, code: string, message: string) {
    this.gateway.sendToUser(userId, "room:error", { code, message });
  }

  private clearPendingDisconnectTimer(userId: string) {
    const timer = this.pendingDisconnectTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.pendingDisconnectTimers.delete(userId);
  }

  private schedulePendingDisconnect(room: Room, userId: string) {
    this.clearPendingDisconnectTimer(userId);
    const timer = setTimeout(() => {
      this.pendingDisconnectTimers.delete(userId);
      void this.withRoomCommandLock(room.id, async () => {
        const currentRoom = this.findRoomForUser(userId);
        if (!currentRoom) return;

        const reservation = currentRoom.findPendingSeatReservation(userId);
        if (reservation && !reservation.connected) {
          const cancelled = await this.cancelPendingReservation(
            currentRoom,
            userId,
          );
          if (cancelled) {
            currentRoom.removeSpectator(userId);
            currentRoom.broadcast(this.gateway, "room:state", {
              room: currentRoom.toDetail(),
            });
            this.broadcastLobbyList();
          }
          return;
        }

        const seat = currentRoom.findSeatByUserId(userId);
        if (seat && !seat.connected) {
          await this.ejectPlayer(currentRoom, userId);
        }
      }).catch((err) => {
        console.error("[lobby] pending disconnect cleanup failed", err);
      });
    }, 60_000);
    this.pendingDisconnectTimers.set(userId, timer);
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
    if (
      !Number.isInteger(buyIn) ||
      buyIn < room.settings.minBuyIn ||
      buyIn > room.settings.maxBuyIn
    ) {
      this.gateway.sendToUser(userId, "room:error", {
        code: "INVALID_BUYIN",
        message: `带入金额需在 ${room.settings.minBuyIn} - ${room.settings.maxBuyIn} 之间`,
      });
      return;
    }

    try {
      if (seat.buyInHoldOperationId) {
        const settled = await settleBuyInHold(
          seat.buyInHoldOperationId,
          seat.chips,
        );
        if (!settled) throw new Error("HOLD_SETTLEMENT_FAILED");
        seat.buyInHoldOperationId = null;
      }
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

    if (
      maxPlayers < 2 ||
      maxPlayers > 9 ||
      maxPlayers < room.playerCount + room.pendingSeatReservations.length
    ) {
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
    const activeHoldByUser = new Map(
      room.seats
        .filter((seat) => seat.userId && seat.buyInHoldOperationId)
        .map((seat) => [seat.userId!, seat.buyInHoldOperationId!] as const),
    );
    const refunds = room.seats
      .filter((seat) => seat.userId && seat.confirmed)
      .map((seat) => ({ userId: seat.userId!, chips: seat.chips }));
    for (const r of refunds) {
      const holdOperationId = activeHoldByUser.get(r.userId);
      if (holdOperationId) await settleBuyInHold(holdOperationId, r.chips);
      else await addPoints(r.userId, r.chips);
    }
    room.clearConfirmations();

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
    const pendingRoom = roomManager.findRoomByPendingSeatReservation(userId);
    if (pendingRoom) {
      const cancelled = await this.cancelPendingReservation(
        pendingRoom,
        userId,
      );
      if (!cancelled) {
        this.sendQueueError(
          userId,
          "REFUND_FAILED",
          "预约退款失败，请稍后重试",
        );
        return;
      }
      pendingRoom.removeSpectator(userId);
      this.broadcastLobbyList();
      pendingRoom.broadcast(this.gateway, "room:state", {
        room: pendingRoom.toDetail(),
      });
      return;
    }

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

    const seat = room.findSeatByUserId(userId);
    const holdOperationId = seat?.buyInHoldOperationId;
    const chips = seat?.chips ?? 0;
    if (holdOperationId) {
      const settled = await settleBuyInHold(holdOperationId, chips);
      if (!settled) throw new Error("HOLD_SETTLEMENT_FAILED");
    }
    const removedChips = room.removePlayer(userId);
    if (!holdOperationId) await addPoints(userId, removedChips);

    if (engine && wasInHand) {
      this.destroyEngine(room);
      await this.settleSeatChanges(room);
      await this.settleActiveHolds(room);
      if (handSettled) await this.activatePendingReservations(room);
      else await this.cancelAllPendingReservations(room);

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
    const pendingRoom = roomManager.findRoomByPendingSeatReservation(userId);
    if (pendingRoom) {
      pendingRoom.markPendingDisconnected(userId);
      this.schedulePendingDisconnect(pendingRoom, userId);
      pendingRoom.broadcast(this.gateway, "room:state", {
        room: pendingRoom.toDetail(),
      });
      return;
    }

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
      this.clearPendingDisconnectTimer(userId);
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
      if (spectatingRoom.findPendingSeatReservation(userId)) {
        this.clearPendingDisconnectTimer(userId);
        spectatingRoom.markPendingReconnected(userId);
      }
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
