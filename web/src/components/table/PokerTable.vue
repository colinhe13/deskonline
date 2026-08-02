<template>
  <div class="poker-table">
    <div class="table-felt">
      <div
        v-for="seat in mergedSeats"
        :key="seat.index"
        class="seat-position"
        :class="{ selectable: !seat.userId && canMoveSeats }"
        :style="seatStyle(seat.index)"
        @click="onSeatClick(seat)"
      >
        <PlayerSeat
          :seat="seat"
          :is-host="seat.userId === room?.hostId"
          :is-me="seat.userId === myUserId"
          :is-current="isCurrentSeat(seat)"
        />
      </div>
      <div class="table-center">
        <CommunityCards :cards="pokerState?.communityCards || []" />
        <PotDisplay :amount="pokerState?.pot || 0" />
        <span class="table-id">#{{ room?.id }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RoomDetail, PokerState, SeatInfo, PokerPlayer } from "../../stores/game";
import PlayerSeat from "./PlayerSeat.vue";
import CommunityCards from "./CommunityCards.vue";
import PotDisplay from "./PotDisplay.vue";

const props = defineProps<{
  room: RoomDetail | null;
  pokerState: PokerState | null;
  myUserId: string | null;
}>();

const emit = defineEmits<{ sit: [seatIndex: number] }>();

const canMoveSeats = computed(
  () =>
    props.room?.status === "waiting" &&
    !!props.myUserId &&
    !!props.room?.seats.some((s) => s.userId === props.myUserId),
);

function onSeatClick(seat: MergedSeat) {
  if (!seat.userId && canMoveSeats.value) {
    emit("sit", seat.index);
  }
}

interface MergedSeat extends SeatInfo {
  bet: number;
  folded: boolean;
  allIn: boolean;
  isDealer: boolean;
  cards: { rank: string; suit: string }[];
}

const mergedSeats = computed<MergedSeat[]>(() => {
  const seats = props.room?.seats || [];
  return seats.map((seat) => {
    const player: PokerPlayer | undefined = props.pokerState?.players.find(
      (p) => p.userId === seat.userId,
    );
    return {
      ...seat,
      chips: player ? player.chips : seat.chips,
      bet: player?.bet || 0,
      folded: player?.folded || false,
      allIn: player?.allIn || false,
      isDealer: player?.isDealer || false,
      cards: player?.cards || [],
    };
  });
});

function isCurrentSeat(seat: MergedSeat): boolean {
  if (!props.pokerState) return false;
  const current = props.pokerState.players[props.pokerState.currentPlayerIndex];
  return current?.userId === seat.userId && seat.userId !== null;
}

function seatStyle(index: number) {
  const total = props.room?.maxPlayers || 9;
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  const rx = 42;
  const ry = 38;
  const x = 50 + rx * Math.cos(angle);
  const y = 50 + ry * Math.sin(angle);
  return {
    left: `${x}%`,
    top: `${y}%`,
  };
}
</script>

<style scoped>
.poker-table {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.table-felt {
  position: relative;
  width: 90%;
  max-width: 800px;
  aspect-ratio: 1.6;
  background: #2d6b3f;
  border-radius: 50%;
  border: 8px solid #5c3d1e;
  box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.3);
}
.seat-position {
  position: absolute;
  transform: translate(-50%, -50%);
}
.seat-position.selectable {
  cursor: pointer;
}
.seat-position.selectable:hover {
  filter: drop-shadow(0 0 8px rgba(255, 215, 0, 0.9));
}
.table-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.table-id {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.8rem;
}

@media (max-width: 768px) {
  .table-felt {
    width: 94%;
    aspect-ratio: 1 / 1.05;
  }
  .table-center {
    gap: 4px;
  }
  .table-id {
    font-size: 0.65rem;
  }
}
</style>
