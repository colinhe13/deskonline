import { defineStore } from "pinia";
import { ref, computed } from "vue";

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

export interface PokerCard {
  rank: string;
  suit: string;
}

export interface PokerPlayer {
  userId: string;
  username: string;
  seatIndex: number;
  chips: number;
  bet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  cards: PokerCard[];
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
}

export interface PokerState {
  phase: string;
  communityCards: PokerCard[];
  pot: number;
  players: PokerPlayer[];
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  minRaise: number;
  handNumber: number;
}

export interface ActionOption {
  type: string;
  amount?: number;
  min?: number;
  max?: number;
}

export interface HandResultInfo {
  winners: { userId: string; amount: number }[];
  showdownCards: Record<string, PokerCard[]>;
}

export const useGameStore = defineStore("game", () => {
  const room = ref<RoomDetail | null>(null);
  const pokerState = ref<PokerState | null>(null);
  const availableActions = ref<ActionOption[]>([]);
  const handResult = ref<HandResultInfo | null>(null);
  const myUserId = ref<string | null>(null);

  const isMyTurn = computed(() => availableActions.value.length > 0);

  const currentPlayer = computed(() => {
    if (!pokerState.value) return null;
    return pokerState.value.players[pokerState.value.currentPlayerIndex] || null;
  });

  function setRoom(newRoom: RoomDetail | null) {
    room.value = newRoom;
    if (!newRoom) {
      pokerState.value = null;
      availableActions.value = [];
      handResult.value = null;
    }
  }

  function setPokerState(state: PokerState, actions: ActionOption[]) {
    pokerState.value = state;
    availableActions.value = actions;
  }

  function setHandResult(result: HandResultInfo | null) {
    handResult.value = result;
  }

  function setMyUserId(id: string | null) {
    myUserId.value = id;
  }

  return {
    room,
    pokerState,
    availableActions,
    handResult,
    myUserId,
    isMyTurn,
    currentPlayer,
    setRoom,
    setPokerState,
    setHandResult,
    setMyUserId,
  };
});
