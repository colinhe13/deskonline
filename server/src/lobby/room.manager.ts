import { Room, RoomConfig } from "./room.js";

function generateRoomId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  createRoom(config: Omit<RoomConfig, "id">): Room {
    const id = generateRoomId();
    const room = new Room({ ...config, id });
    this.rooms.set(id, room);
    return room;
  }

  destroyRoom(roomId: string) {
    this.rooms.delete(roomId);
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

  listRooms() {
    return [...this.rooms.values()].map((r) => r.toSummary());
  }

  get allRooms(): Room[] {
    return [...this.rooms.values()];
  }
}

export const roomManager = new RoomManager();
