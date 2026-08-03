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
          :is-winner="isWinner(seat)"
        />
      </div>
      <div class="table-center">
        <CommunityCards :cards="pokerState?.communityCards || []" />
        <PotDisplay :amount="pokerState?.pot || 0" />
        <span class="table-id">#{{ room?.id }}</span>
      </div>
      <ChipFlight :flights="flights" @done="removeFlight" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { RoomDetail, PokerState, SeatInfo, PokerPlayer, HandResultInfo } from "../../stores/game";
import PlayerSeat from "./PlayerSeat.vue";
import CommunityCards from "./CommunityCards.vue";
import PotDisplay from "./PotDisplay.vue";
import ChipFlight, { type ChipFlightItem } from "./ChipFlight.vue";

const props = defineProps<{
  room: RoomDetail | null;
  pokerState: PokerState | null;
  myUserId: string | null;
  handResult: HandResultInfo | null;
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

// 下注筹码飞行动画：座位 bet 增加时，从该座位坐标飞向台面中心。
const flights = ref<ChipFlightItem[]>([]);
let flightSeq = 0;

watch(mergedSeats, (seats, prev) => {
  seats.forEach((seat, i) => {
    const prevBet = prev?.[i]?.bet ?? 0;
    if (seat.bet > prevBet && seat.userId) {
      const pos = seatStyle(seat.index);
      flights.value.push({
        id: ++flightSeq,
        from: { x: parseFloat(pos.left), y: parseFloat(pos.top) },
      });
    }
  });
});

function removeFlight(id: number) {
  flights.value = flights.value.filter((f) => f.id !== id);
}

function isCurrentSeat(seat: MergedSeat): boolean {
  if (!props.pokerState) return false;
  const current = props.pokerState.players[props.pokerState.currentPlayerIndex];
  return current?.userId === seat.userId && seat.userId !== null;
}

function isWinner(seat: MergedSeat): boolean {
  if (!props.handResult || !seat.userId) return false;
  return props.handResult.winners.some((w) => w.userId === seat.userId);
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
  border-radius: 50%;
  background:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncA type='linear' slope='0.05'/></feComponentTransfer></filter><rect width='140' height='140' filter='url(%23n)'/></svg>"),
    radial-gradient(
      ellipse 62% 58% at 50% 42%,
      var(--felt-0) 0%,
      var(--felt-1) 68%,
      #0d3a24 100%
    );
  box-shadow:
    inset 0 0 0 3px rgba(240, 199, 94, 0.2),
    inset 0 0 60px rgba(0, 0, 0, 0.45),
    inset 0 -18px 40px rgba(0, 0, 0, 0.28),
    0 0 0 11px var(--rail-1),
    0 0 0 14px var(--rail-0),
    0 24px 60px rgba(0, 0, 0, 0.55);
}
.seat-position {
  position: absolute;
  transform: translate(-50%, -50%);
}
.seat-position.selectable {
  cursor: pointer;
}
.seat-position.selectable:hover {
  filter: drop-shadow(0 0 8px rgba(240, 199, 94, 0.9));
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
  color: var(--text-faint);
  font-size: var(--fs-sm);
  letter-spacing: 0.1em;
}

@media (max-width: 768px) {
  .table-felt {
    width: 94%;
    aspect-ratio: 1 / 1.05;
    box-shadow:
      inset 0 0 0 2px rgba(240, 199, 94, 0.2),
      inset 0 0 40px rgba(0, 0, 0, 0.45),
      0 0 0 8px var(--rail-1),
      0 0 0 11px var(--rail-0),
      0 18px 40px rgba(0, 0, 0, 0.55);
  }
  .table-center {
    gap: 4px;
  }
  .table-id {
    font-size: 0.65rem;
  }
}
</style>
