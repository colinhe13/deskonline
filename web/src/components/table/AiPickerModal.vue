<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-picker-title"
    >
      <h2 id="ai-picker-title">选择 AI</h2>
      <p class="hint">选择要加入本桌的 AI 玩家</p>

      <div v-if="options.length" class="ai-options">
        <button
          v-for="option in options"
          :key="option.username"
          type="button"
          class="ai-option"
          :disabled="!option.available"
          @click="$emit('select', option.username)"
        >
          <span class="option-main">
            <span class="option-name">{{ option.username }}</span>
            <span class="option-style">
              {{ option.displayName }} · {{ option.styleLabel }}
            </span>
          </span>
          <span v-if="option.available" class="option-state">可添加</span>
          <span v-else class="option-state">已在本桌</span>
        </button>
      </div>
      <p v-else class="empty">暂无可用 AI</p>

      <div class="modal-actions">
        <button type="button" class="btn-ghost" @click="$emit('close')">
          取消
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AiAccountOption } from "../../stores/game";

defineProps<{
  options: AiAccountOption[];
}>();

defineEmits<{
  close: [];
  select: [username: string];
}>();
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(4, 10, 7, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.modal {
  width: min(92vw, 390px);
  padding: 1.4rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  background: linear-gradient(
    170deg,
    rgba(26, 48, 36, 0.97),
    rgba(12, 28, 19, 0.98)
  );
  box-shadow: var(--shadow-lg);
}
.modal h2 {
  margin-bottom: 0.3rem;
  color: var(--gold);
  letter-spacing: 0.05em;
}
.hint,
.empty {
  margin-bottom: 1rem;
  color: var(--text-dim);
  font-size: var(--fs-sm);
}
.ai-options {
  display: grid;
  gap: 0.55rem;
  max-height: min(52vh, 330px);
  overflow-y: auto;
}
.ai-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 54px;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-out),
    background var(--dur-fast),
    border-color var(--dur-fast);
}
.ai-option:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(240, 199, 94, 0.55);
  background: rgba(240, 199, 94, 0.12);
}
.ai-option:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.option-main {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
}
.option-name {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.option-style {
  color: var(--text-dim);
  font-size: var(--fs-xs);
}
.option-state {
  flex: 0 0 auto;
  color: var(--gold-soft);
  font-size: var(--fs-xs);
}
.modal-actions {
  display: flex;
  margin-top: 1rem;
}
.modal-actions button {
  flex: 1;
  min-height: 44px;
  padding: 0.6rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-dim);
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
}
.modal-actions button:hover {
  color: var(--text);
}
</style>
