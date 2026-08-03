import { Room, RoomSettings } from "./room.js";

const SYSTEM_ROOM_ID = "main";

const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 9,
  smallBlind: 1,
  bigBlind: 2,
  minBuyIn: 150,
  maxBuyIn: 750,
};

export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  constructor() {
    const systemRoom = new Room(SYSTEM_ROOM_ID, { ...DEFAULT_SETTINGS });
    this.rooms.set(SYSTEM_ROOM_ID, systemRoom);
  }

  getSystemRoom(): Room {
    return this.rooms.get(SYSTEM_ROOM_ID)!;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  findRoomByPlayer(userId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.findSeatByUserId(userId)) return room;
    }
    return undefined;
  }

  findRoomBySpectator(userId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.isSpectator(userId)) return room;
    }
    return undefined;
  }

  listRooms() {
    return [...this.rooms.values()].map((r) => r.toSummary());
  }
}

export const roomManager = new RoomManager();
