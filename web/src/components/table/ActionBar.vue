<template>
  <div class="action-bar" v-if="actions.length > 0">
    <div class="timer" v-if="timeLeft > 0">
      <div class="timer-fill" :style="{ width: (timeLeft / 30) * 100 + '%' }"></div>
    </div>
    <div class="actions">
      <button
        v-for="action in actions"
        :key="action.type"
        class="action-btn"
        :class="'btn-' + action.type"
        @click="handleAction(action)"
      >
        {{ actionLabel(action) }}
      </button>
    </div>
    <div v-if="showRaiseSlider" class="raise-control">
      <input
        type="range"
        :min="raiseMin"
        :max="raiseMax"
        v-model.number="raiseAmount"
      />
      <span class="raise-value">{{ raiseAmount }}</span>
      <button class="action-btn btn-raise" @click="confirmRaise">确认加注</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

interface ActionOption {
  type: string;
  amount?: number;
  min?: number;
  max?: number;
}

const props = defineProps<{ actions: ActionOption[]; timeLeft: number }>();
const emit = defineEmits<{ action: [type: string, amount?: number] }>();

const showRaiseSlider = ref(false);
const raiseAmount = ref(0);

const raiseAction = computed(() => props.actions.find((a) => a.type === "raise"));
const raiseMin = computed(() => raiseAction.value?.min || 0);
const raiseMax = computed(() => raiseAction.value?.max || 0);

function actionLabel(action: ActionOption): string {
  switch (action.type) {
    case "fold": return "弃牌";
    case "check": return "过牌";
    case "call": return `跟注 ${action.amount}`;
    case "raise": return "加注";
    case "allin": return `全押 ${action.amount}`;
    default: return action.type;
  }
}

function handleAction(action: ActionOption) {
  if (action.type === "raise") {
    raiseAmount.value = action.min || 0;
    showRaiseSlider.value = !showRaiseSlider.value;
    return;
  }
  emit("action", action.type, action.amount);
}

function confirmRaise() {
  emit("action", "raise", raiseAmount.value);
  showRaiseSlider.value = false;
}
</script>

<style scoped>
.action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.9);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.timer {
  height: 4px;
  background: #333;
  border-radius: 2px;
  overflow: hidden;
}
.timer-fill {
  height: 100%;
  background: #ffd700;
  transition: width 1s linear;
}
.actions {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  flex-wrap: wrap;
}
.action-btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
  min-height: 44px;
}
.btn-fold { background: #e53e3e; color: #fff; }
.btn-check { background: #4a5568; color: #fff; }
.btn-call { background: #3182ce; color: #fff; }
.btn-raise { background: #d69e2e; color: #fff; }
.btn-allin { background: #805ad5; color: #fff; }
.raise-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
}
.raise-control input {
  flex: 1;
  max-width: 200px;
}
.raise-value {
  color: #ffd700;
  font-weight: bold;
  min-width: 50px;
  text-align: center;
}
</style>
