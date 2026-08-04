import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface SeatInfo {
  index: number;
  userId: string | null;
  username: string | null;
  chips: number;
  buyIn: number;
  connected: boolean;
  confirmed: boolean;
  isAi?: boolean;
}

export interface SpectatorInfo {
  userId: string;
  username: string;
}

export interface PendingSeatReservationInfo {
  userId: string;
  username: string;
  seatIndex: number;
  status: "pending";
}

export interface RoomDetail {
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
  autoResume?: boolean;
  pendingSeatReservationCount?: number;
  seats: SeatInfo[];
  spectators: SpectatorInfo[];
  pendingSeatReservations: PendingSeatReservationInfo[];
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
  isAi?: boolean;
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
  handNames: Record<string, string>;
  reason: "fold" | "showdown";
}

export const useGameStore = defineStore("game", () => {
  const room = ref<RoomDetail | null>(null);
  const pokerState = ref<PokerState | null>(null);
  const availableActions = ref<ActionOption[]>([]);
  const handResult = ref<HandResultInfo | null>(null);
  const myUserId = ref<string | null>(null);

  const isSpectator = computed(
    () =>
      !!myUserId.value &&
      !!room.value?.spectators?.some((s) => s.userId === myUserId.value),
  );

  const myPendingSeatReservation = computed(() =>
    room.value?.pendingSeatReservations?.find(
      (reservation) => reservation.userId === myUserId.value,
    ),
  );

  const isMyTurn = computed(
    () =>
      room.value?.status === "playing" &&
      !isSpectator.value &&
      availableActions.value.length > 0,
  );

  const currentPlayer = computed(() => {
    if (!pokerState.value) return null;
    return (
      pokerState.value.players[pokerState.value.currentPlayerIndex] || null
    );
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
    isSpectator,
    myPendingSeatReservation,
    isMyTurn,
    currentPlayer,
    setRoom,
    setPokerState,
    setHandResult,
    setMyUserId,
  };
});
