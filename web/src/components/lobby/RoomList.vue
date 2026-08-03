<template>
  <div class="room-list">
    <p v-if="rooms.length === 0" class="empty">
      <span class="empty-suits" aria-hidden="true">♠ ♥ ♦ ♣</span>
      暂无可用房间
    </p>
    <div
      v-for="(room, i) in rooms"
      :key="room.id"
      class="room-card"
      :style="{ '--i': i }"
      @click="$emit('join', room)"
    >
      <span class="room-accent" aria-hidden="true"></span>
      <div class="room-id">#{{ room.id }}</div>
      <div class="room-info">
        <span>{{ room.playerCount }}/{{ room.maxPlayers }} 人</span>
        <span>已确认 {{ room.confirmedCount }}</span>
        <span>盲注 {{ room.smallBlind }}/{{ room.bigBlind }}</span>
        <span>带入 {{ room.minBuyIn }}-{{ room.maxBuyIn }}</span>
      </div>
      <div class="room-status" :class="room.status">
        <span class="status-dot" aria-hidden="true"></span>
        {{ room.status === "waiting" ? "等待中" : "游戏中" }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RoomSummary } from "../../stores/lobby";

defineProps<{ rooms: RoomSummary[] }>();
defineEmits<{ join: [room: RoomSummary] }>();
</script>

<style scoped>
.room-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.empty {
  text-align: center;
  color: var(--text-dim);
  padding: 3rem 1rem;
  font-size: var(--fs-sm);
}
.empty-suits {
  display: block;
  font-size: 2rem;
  letter-spacing: 0.4em;
  color: var(--text-faint);
  margin-bottom: 0.75rem;
}
.room-card {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 1rem 1.2rem;
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  animation: card-in 0.45s var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 60ms);
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.room-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: rgba(240, 199, 94, 0.4);
}
.room-card:active {
  transform: translateY(0) scale(0.99);
}
.room-accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--gold), var(--gold-strong));
  opacity: 0.75;
}
.room-id {
  font-weight: bold;
  color: var(--gold);
  min-width: 3ch;
}
.room-info {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.room-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--fs-xs);
  padding: 0.25rem 0.7rem;
  border-radius: var(--radius-pill);
  font-weight: 600;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.room-status.waiting {
  background: rgba(104, 211, 145, 0.14);
  color: var(--success);
}
.room-status.waiting .status-dot {
  background: var(--success);
  box-shadow: 0 0 6px rgba(104, 211, 145, 0.8);
}
.room-status.playing {
  background: rgba(240, 199, 94, 0.14);
  color: var(--gold);
}
.room-status.playing .status-dot {
  background: var(--gold);
  box-shadow: 0 0 6px rgba(240, 199, 94, 0.8);
}
</style>
