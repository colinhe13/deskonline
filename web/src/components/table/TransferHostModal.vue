<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h2>移交房主</h2>
      <p class="hint">选择一名玩家接任房主：</p>
      <div class="player-list">
        <button
          v-for="p in candidates"
          :key="p.index"
          class="player-btn"
          @click="$emit('transfer', p.userId!)"
        >
          {{ p.username }}
        </button>
        <p v-if="candidates.length === 0" class="empty">没有其他玩家可移交</p>
      </div>
      <div class="modal-actions">
        <button type="button" @click="$emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SeatInfo } from "../../stores/game";

const props = defineProps<{ seats: SeatInfo[]; myUserId: string | null }>();
defineEmits<{ close: []; transfer: [userId: string] }>();

const candidates = computed(() =>
  props.seats.filter((s) => s.userId && s.userId !== props.myUserId),
);
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: #fff;
  border-radius: 12px;
  padding: 1.5rem;
  width: 90%;
  max-width: 360px;
}
.modal h2 {
  margin-bottom: 0.5rem;
  color: #1a472a;
}
.hint {
  font-size: 0.85rem;
  color: #666;
  margin-bottom: 0.75rem;
}
.player-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.player-btn {
  padding: 0.6rem;
  background: #f0f4f0;
  border: 1px solid #d0dcd0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  text-align: left;
}
.player-btn:hover {
  background: #e0ece0;
}
.empty {
  color: #999;
  font-size: 0.85rem;
  text-align: center;
}
.modal-actions {
  display: flex;
}
.modal-actions button {
  flex: 1;
  padding: 0.6rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  background: #eee;
}
</style>
