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
          <span class="player-avatar" aria-hidden="true">{{
            p.username?.charAt(0).toUpperCase()
          }}</span>
          {{ p.username }}
        </button>
        <p v-if="candidates.length === 0" class="empty">没有其他玩家可移交</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-ghost" @click="$emit('close')">
          取消
        </button>
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
  props.seats.filter((s) => s.userId && s.userId !== props.myUserId && !s.isAi),
);
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(4, 10, 7, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: var(--z-modal);
}
.modal {
  background: linear-gradient(
    170deg,
    rgba(26, 48, 36, 0.95),
    rgba(12, 28, 19, 0.96)
  );
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 1.6rem 1.5rem;
  width: 90%;
  max-width: 360px;
  box-shadow: var(--shadow-lg);
}
.modal h2 {
  margin-bottom: 0.5rem;
  color: var(--gold);
  letter-spacing: 0.05em;
}
.hint {
  font-size: var(--fs-sm);
  color: var(--text-dim);
  margin-bottom: 0.75rem;
}
.player-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.player-btn {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  min-height: 44px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--fs-sm);
  text-align: left;
  color: var(--text);
  transition:
    transform var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast),
    background var(--dur-fast);
}
.player-btn:hover {
  transform: translateX(3px);
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(240, 199, 94, 0.4);
}
.player-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--felt-0), var(--felt-1));
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: bold;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.empty {
  color: var(--text-dim);
  font-size: var(--fs-sm);
  text-align: center;
}
.modal-actions {
  display: flex;
}
.modal-actions button {
  flex: 1;
  min-height: 44px;
  padding: 0.6rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: 600;
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-dim);
  transition:
    transform var(--dur-fast) var(--ease-out),
    color var(--dur-fast);
}
.modal-actions button:hover {
  transform: translateY(-1px);
  color: var(--text);
}
.modal-actions button:active {
  transform: scale(0.97);
}
</style>
