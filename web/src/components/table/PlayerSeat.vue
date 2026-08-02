<template>
  <div class="player-seat" :class="{ occupied: seat.userId, disconnected: !seat.connected }">
    <template v-if="seat.userId">
      <div class="avatar">{{ seat.username?.charAt(0).toUpperCase() }}</div>
      <div class="seat-info">
        <span class="seat-name">
          {{ seat.username }}
          <span v-if="isHost" class="host-badge">房主</span>
        </span>
        <span class="seat-chips">{{ seat.chips }}</span>
      </div>
      <div v-if="!seat.connected" class="dc-badge">断线</div>
    </template>
    <template v-else>
      <div class="avatar empty">空</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { SeatInfo } from "../../stores/game";

defineProps<{ seat: SeatInfo; isHost: boolean }>();
</script>

<style scoped>
.player-seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 64px;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #1a472a;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1rem;
}
.avatar.empty {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
}
.seat-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.7rem;
  color: #fff;
}
.seat-name {
  display: flex;
  align-items: center;
  gap: 2px;
}
.host-badge {
  background: #ffd700;
  color: #333;
  font-size: 0.55rem;
  padding: 0 3px;
  border-radius: 3px;
}
.seat-chips {
  color: #ffd700;
  font-weight: bold;
}
.dc-badge {
  font-size: 0.6rem;
  background: #e53e3e;
  color: #fff;
  padding: 0 4px;
  border-radius: 3px;
}
.disconnected .avatar {
  opacity: 0.5;
}
</style>
