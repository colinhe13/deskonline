import { defineStore } from "pinia";
import { ref } from "vue";

export interface SeatInfo {
  index: number;
  userId: string | null;
  username: string | null;
  chips: number;
  connected: boolean;
}

export interface RoomDetail {
  id: string;
  hostId: string;
  playerCount: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  status: string;
  seats: SeatInfo[];
}

export const useGameStore = defineStore("game", () => {
  const room = ref<RoomDetail | null>(null);

  function setRoom(newRoom: RoomDetail | null) {
    room.value = newRoom;
  }

  return { room, setRoom };
});
