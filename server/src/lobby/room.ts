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

  findSeatByUserId(userId: string): Seat | undefined {
    return this.seats.find((s) => s.userId === userId);
  }

  confirmedSeats(): Seat[] {
    return this.seats.filter((s) => s.userId !== null && s.confirmed);
  }

  addPlayer(userId: string, username: string): Seat {
    if (this.isFull) throw new Error("ROOM_FULL");
    const seat = this.seats.find((s) => s.userId === null)!;
    seat.userId = userId;
    seat.username = username;
    seat.chips = 0;
    seat.buyIn = 0;
    seat.connected = true;
    seat.confirmed = false;
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

    from.userId = null;
    from.username = null;
    from.chips = 0;
    from.buyIn = 0;
    from.confirmed = false;
    from.connected = false;
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

  // Confirmed seats that ran out of chips become unconfirmed so the player can
  // rebuy (frontend shows the buy-in prompt via confirmed === false).
  // Returns true if any seat was marked.
  markBusted(): boolean {
    let marked = false;
    for (const seat of this.seats) {
      if (seat.userId && seat.confirmed && seat.chips === 0) {
        seat.confirmed = false;
        seat.buyIn = 0;
        marked = true;
      }
    }
    return marked;
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
    gateway.broadcast(this.connectedUserIds, type, payload);
  }

  toSummary() {
    return {
      id: this.id,
      hostId: this.hostId,
      playerCount: this.playerCount,
      confirmedCount: this.confirmedCount,
      maxPlayers: this.settings.maxPlayers,
      smallBlind: this.settings.smallBlind,
      bigBlind: this.settings.bigBlind,
      minBuyIn: this.settings.minBuyIn,
      maxBuyIn: this.settings.maxBuyIn,
      status: this.status,
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
      })),
    };
  }
}
