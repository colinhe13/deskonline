<template>
  <div class="room-list">
    <p v-if="rooms.length === 0" class="empty">暂无可用房间</p>
    <div v-for="room in rooms" :key="room.id" class="room-card" @click="$emit('join', room)">
      <div class="room-id">#{{ room.id }}</div>
      <div class="room-info">
        <span>{{ room.playerCount }}/{{ room.maxPlayers }} 人</span>
        <span>已确认 {{ room.confirmedCount }}</span>
        <span>盲注 {{ room.smallBlind }}/{{ room.bigBlind }}</span>
        <span>带入 {{ room.minBuyIn }}-{{ room.maxBuyIn }}</span>
      </div>
      <div class="room-status" :class="room.status">
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
  color: #999;
  padding: 2rem;
}
.room-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: #fff;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.2s;
}
.room-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.room-id {
  font-weight: bold;
  color: #1a472a;
}
.room-info {
  display: flex;
  gap: 1rem;
  font-size: 0.85rem;
  color: #666;
}
.room-status {
  font-size: 0.8rem;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
}
.room-status.waiting {
  background: #e6f7e6;
  color: #1a472a;
}
.room-status.playing {
  background: #fff3e0;
  color: #e65100;
}
</style>
