<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h2>房间设置</h2>
      <form @submit.prevent="save">
        <label>
          最大人数
          <select v-model.number="form.maxPlayers">
            <option v-for="n in [2, 3, 4, 5, 6, 7, 8, 9]" :key="n" :value="n">
              {{ n }}
            </option>
          </select>
        </label>
        <label>
          小盲注
          <input v-model.number="form.smallBlind" type="number" min="1" />
        </label>
        <label>
          大盲注
          <input v-model.number="form.bigBlind" type="number" min="2" />
        </label>
        <label>
          最小带入
          <input v-model.number="form.minBuyIn" type="number" min="1" />
        </label>
        <label>
          最大带入
          <input v-model.number="form.maxBuyIn" type="number" min="1" />
        </label>
        <p class="hint">修改设置后，所有玩家需要重新确认带入金额。</p>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" @click="$emit('close')">
            取消
          </button>
          <button type="submit" class="btn-primary">保存</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";

export interface SettingsForm {
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
}

const props = defineProps<{ settings: SettingsForm }>();
const emit = defineEmits<{ close: []; save: [form: SettingsForm] }>();

const form = reactive<SettingsForm>({ ...props.settings });

function save() {
  emit("save", { ...form });
}
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
  margin-bottom: 1rem;
  color: var(--gold);
  letter-spacing: 0.05em;
}
.modal label {
  display: block;
  margin-bottom: 0.75rem;
  font-size: var(--fs-sm);
  color: var(--text);
}
.modal input,
.modal select {
  display: block;
  width: 100%;
  margin-top: 0.3rem;
  padding: 0.55rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-md);
  color: var(--text);
}
.modal input:focus,
.modal select:focus {
  outline: none;
  border-color: var(--gold);
  box-shadow: 0 0 0 3px rgba(240, 199, 94, 0.16);
}
.hint {
  font-size: var(--fs-xs);
  color: var(--text-dim);
  margin: 0.5rem 0;
}
.modal-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
.modal-actions button {
  flex: 1;
  min-height: 44px;
  padding: 0.6rem;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: 600;
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    background var(--dur-fast);
}
.modal-actions button:hover {
  transform: translateY(-1px);
}
.modal-actions button:active {
  transform: scale(0.97);
}
.btn-ghost {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-dim);
  border: 1px solid var(--glass-border) !important;
}
.btn-ghost:hover {
  color: var(--text);
}
.btn-primary {
  background: linear-gradient(160deg, var(--gold), var(--gold-strong));
  color: #1c1304;
  box-shadow: var(--shadow-sm);
}
.btn-primary:hover {
  box-shadow: var(--shadow-glow-gold);
}
</style>
