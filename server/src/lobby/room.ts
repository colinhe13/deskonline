import { WebSocketGateway } from "../ws/gateway.js";

export const MAX_CAPACITY = 9;

export interface RoomSettings {
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
}

export interface Seat {
  index: number;
  userId: string | null;
  username: string | null;
  chips: number;
  buyIn: number;
  connected: boolean;
  confirmed: boolean;
  isAi: boolean;
}

export interface Spectator {
  userId: string;
  username: string;
}

export type RoomStatus = "waiting" | "playing";

export class Room {
  readonly id: string;
  hostId: string | null = null;
  settings: RoomSettings;
  seats: Seat[];
  status: RoomStatus = "waiting";
  entryOrder: string[] = [];
  // Set when the table pauses because a player busted; cleared when the game auto-resumes.
  autoResume = false;
  // Players (AI) removed mid-hand; they leave once the current hand settles.
  pendingLeaveUserIds: string[] = [];
  // Users watching the table without occupying a seat.
  spectators: Spectator[] = [];
  // Seat index of the last dealer, kept across engine rebuilds so the button
  // rotation survives hand-boundary reconstruction.
  dealerSeatIndex: number | null = null;

  constructor(id: string, settings: RoomSettings) {
    this.id = id;
    this.settings = settings;
    this.seats = Array.from({ length: MAX_CAPACITY }, (_, i) => ({
      index: i,
      userId: null,
      username: null,
      chips: 0,
      buyIn: 0,
      connected: false,
      confirmed: false,
      isAi: false,
    }));
  }

  get playerCount(): number {
    return this.seats.filter((s) => s.userId !== null).length;
  }

  get confirmedCount(): number {
    return this.seats.filter((s) => s.userId !== null && s.confirmed).length;
  }

  get isFull(): boolean {
    return this.playerCount >= this.settings.maxPlayers;
  }

  get connectedUserIds(): string[] {
    return this.seats
      .filter((s) => s.userId && s.connected)
      .map((s) => s.userId!);
  }

  // Everyone who should receive room broadcasts: seated players with a live
  // connection plus spectators (they hold a WS by construction).
  get broadcastRecipientIds(): string[] {
    return [
      ...this.connectedUserIds,
      ...this.spectators.map((sp) => sp.userId),
    ];
  }

  findSeatByUserId(userId: string): Seat | undefined {
    return this.seats.find((s) => s.userId === userId);
  }

  confirmedSeats(): Seat[] {
    return this.seats.filter((s) => s.userId !== null && s.confirmed);
  }

  humanSeats(): Seat[] {
    return this.seats.filter((s) => s.userId !== null && !s.isAi);
  }

  aiSeats(): Seat[] {
    return this.seats.filter((s) => s.userId !== null && s.isAi);
  }

  hasHuman(): boolean {
    return this.humanSeats().length > 0;
  }

  addSpectator(userId: string, username: string): Spectator {
    const existing = this.spectators.find((sp) => sp.userId === userId);
    if (existing) return existing;
    const spectator: Spectator = { userId, username };
    this.spectators.push(spectator);
    return spectator;
  }

  removeSpectator(userId: string): boolean {
    const before = this.spectators.length;
    this.spectators = this.spectators.filter((sp) => sp.userId !== userId);
    return this.spectators.length < before;
  }

  isSpectator(userId: string): boolean {
    return this.spectators.some((sp) => sp.userId === userId);
  }

  addPlayer(userId: string, username: string, isAi = false): Seat {
    if (this.isFull) throw new Error("ROOM_FULL");
    const seat = this.seats.find((s) => s.userId === null)!;
    seat.userId = userId;
    seat.username = username;
    seat.chips = 0;
    seat.buyIn = 0;
    seat.connected = true;
    seat.confirmed = false;
    seat.isAi = isAi;
    this.entryOrder.push(userId);
    if (this.hostId === null) {
      this.hostId = userId;
    }
    return seat;
  }

  removePlayer(userId: string): number {
    const seat = this.findSeatByUserId(userId);
    if (!seat) throw new Error("PLAYER_NOT_FOUND");
    const chips = seat.chips;
    seat.userId = null;
    seat.username = null;
    seat.chips = 0;
    seat.buyIn = 0;
    seat.connected = false;
    seat.confirmed = false;
    seat.isAi = false;
    this.entryOrder = this.entryOrder.filter((id) => id !== userId);
    if (this.hostId === userId) {
      this.hostId = this.entryOrder[0] ?? null;
    }
    return chips;
  }

  confirmBuyIn(userId: string, amount: number) {
    const seat = this.findSeatByUserId(userId);
    if (!seat) throw new Error("PLAYER_NOT_FOUND");
    seat.buyIn = amount;
    seat.chips = amount;
    seat.confirmed = true;
  }

  moveSeat(userId: string, targetIndex: number): boolean {
    const from = this.findSeatByUserId(userId);
    const to = this.seats[targetIndex];
    if (!from || !to || to.userId !== null || targetIndex === from.index)
      return false;

    to.userId = from.userId;
    to.username = from.username;
    to.chips = from.chips;
    to.buyIn = from.buyIn;
    to.confirmed = from.confirmed;
    to.connected = from.connected;
    to.isAi = from.isAi;

    from.userId = null;
    from.username = null;
    from.chips = 0;
    from.buyIn = 0;
    from.confirmed = false;
    from.connected = false;
    from.isAi = false;
    return true;
  }

  // Resets every confirmed seat; returns the refunds the caller must credit back to points.
  clearConfirmations(): { userId: string; chips: number }[] {
    const refunds: { userId: string; chips: number }[] = [];
    for (const seat of this.seats) {
      if (seat.userId && seat.confirmed) {
        refunds.push({ userId: seat.userId, chips: seat.chips });
        seat.confirmed = false;
        seat.chips = 0;
        seat.buyIn = 0;
      }
    }
    return refunds;
  }

  transferHost(targetUserId: string): boolean {
    if (!this.findSeatByUserId(targetUserId)) return false;
    this.hostId = targetUserId;
    return true;
  }

  markDisconnected(userId: string) {
    const seat = this.findSeatByUserId(userId);
    if (seat) seat.connected = false;
  }

  markReconnected(userId: string) {
    const seat = this.findSeatByUserId(userId);
    if (seat) seat.connected = true;
  }

  broadcast(gateway: WebSocketGateway, type: string, payload: unknown) {
    gateway.broadcast(this.broadcastRecipientIds, type, payload);
  }

  toSummary() {
    return {
      id: this.id,
      hostId: this.hostId,
      playerCount: this.playerCount,
      confirmedCount: this.confirmedCount,
      spectatorCount: this.spectators.length,
      maxPlayers: this.settings.maxPlayers,
      smallBlind: this.settings.smallBlind,
      bigBlind: this.settings.bigBlind,
      minBuyIn: this.settings.minBuyIn,
      maxBuyIn: this.settings.maxBuyIn,
      status: this.status,
      autoResume: this.autoResume,
    };
  }

  toDetail() {
    return {
      ...this.toSummary(),
      seats: this.seats.slice(0, this.settings.maxPlayers).map((s) => ({
        index: s.index,
        userId: s.userId,
        username: s.username,
        chips: s.chips,
        buyIn: s.buyIn,
        connected: s.connected,
        confirmed: s.confirmed,
        isAi: s.isAi,
      })),
      spectators: this.spectators.map((sp) => ({
        userId: sp.userId,
        username: sp.username,
      })),
    };
  }
}
