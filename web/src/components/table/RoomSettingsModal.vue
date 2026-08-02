<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h2>房间设置</h2>
      <form @submit.prevent="save">
        <label>
          最大人数
          <select v-model.number="form.maxPlayers">
            <option v-for="n in [2, 3, 4, 5, 6, 7, 8, 9]" :key="n" :value="n">{{ n }}</option>
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
          <button type="button" @click="$emit('close')">取消</button>
          <button type="submit">保存</button>
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
  margin-bottom: 1rem;
  color: #1a472a;
}
.modal label {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
  color: #333;
}
.modal input,
.modal select {
  display: block;
  width: 100%;
  margin-top: 0.25rem;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}
.hint {
  font-size: 0.75rem;
  color: #999;
  margin: 0.5rem 0;
}
.modal-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
.modal-actions button {
  flex: 1;
  padding: 0.6rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
}
.modal-actions button:first-child {
  background: #eee;
}
.modal-actions button:last-child {
  background: #1a472a;
  color: #fff;
}
</style>
