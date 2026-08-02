<template>
  <div class="poker-table">
    <div class="table-felt">
      <div
        v-for="seat in seats"
        :key="seat.index"
        class="seat-position"
        :style="seatStyle(seat.index)"
      >
        <PlayerSeat :seat="seat" :is-host="seat.userId === room?.hostId" />
      </div>
      <div class="table-center">
        <span class="table-id">#{{ room?.id }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RoomDetail } from "../../stores/game";
import PlayerSeat from "./PlayerSeat.vue";

const props = defineProps<{ room: RoomDetail | null }>();

const seats = computed(() => props.room?.seats || []);

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
.table-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: rgba(255, 255, 255, 0.6);
  font-size: 1.2rem;
  font-weight: bold;
}

@media (max-width: 768px) {
  .table-felt {
    width: 95%;
    aspect-ratio: 1.2;
  }
}
</style>
