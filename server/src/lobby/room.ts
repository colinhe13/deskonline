import { WebSocketGateway } from "../ws/gateway.js";

export interface RoomConfig {
  id: string;
  hostId: string;
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
  connected: boolean;
}

export type RoomStatus = "waiting" | "playing";

export class Room {
  readonly config: RoomConfig;
  seats: Seat[];
  status: RoomStatus = "waiting";

  constructor(config: RoomConfig) {
    this.config = config;
    this.seats = Array.from({ length: config.maxPlayers }, (_, i) => ({
      index: i,
      userId: null,
      username: null,
      chips: 0,
      connected: false,
    }));
  }

  get playerCount(): number {
    return this.seats.filter((s) => s.userId !== null).length;
  }

  get isFull(): boolean {
    return this.playerCount >= this.config.maxPlayers;
  }

  get connectedUserIds(): string[] {
    return this.seats.filter((s) => s.userId && s.connected).map((s) => s.userId!);
  }

  findSeatByUserId(userId: string): Seat | undefined {
    return this.seats.find((s) => s.userId === userId);
  }

  addPlayer(userId: string, username: string, buyIn: number): Seat {
    const seat = this.seats.find((s) => s.userId === null);
    if (!seat) throw new Error("ROOM_FULL");
    seat.userId = userId;
    seat.username = username;
    seat.chips = buyIn;
    seat.connected = true;
    return seat;
  }

  removePlayer(userId: string): number {
    const seat = this.findSeatByUserId(userId);
    if (!seat) throw new Error("PLAYER_NOT_FOUND");
    const chips = seat.chips;
    seat.userId = null;
    seat.username = null;
    seat.chips = 0;
    seat.connected = false;
    return chips;
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
      id: this.config.id,
      hostId: this.config.hostId,
      playerCount: this.playerCount,
      maxPlayers: this.config.maxPlayers,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      status: this.status,
    };
  }

  toDetail() {
    return {
      ...this.toSummary(),
      seats: this.seats.map((s) => ({
        index: s.index,
        userId: s.userId,
        username: s.username,
        chips: s.chips,
        connected: s.connected,
      })),
    };
  }
}
