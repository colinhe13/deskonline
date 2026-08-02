import { defineStore } from "pinia";
import { ref } from "vue";

export interface RoomSummary {
  id: string;
  hostId: string | null;
  playerCount: number;
  confirmedCount: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  status: string;
}

export const useLobbyStore = defineStore("lobby", () => {
  const rooms = ref<RoomSummary[]>([]);

  function updateRooms(newRooms: RoomSummary[]) {
    rooms.value = newRooms;
  }

  return { rooms, updateRooms };
});
