<template>
  <div class="action-bar" v-if="actions.length > 0">
    <div class="actions">
      <button
        v-if="foldAction"
        class="action-btn btn-fold"
        @click="handleAction(foldAction)"
      >
        {{ actionLabel(foldAction) }}
      </button>
      <button
        v-if="callAction"
        class="action-btn btn-call"
        @click="handleAction(callAction)"
      >
        {{ actionLabel(callAction) }}
      </button>
      <button
        v-if="showThirdPot"
        class="action-btn btn-raise"
        @click="emit('action', 'raise', thirdPotAmount)"
      >
        1/3
      </button>
      <button
        v-if="showHalfPot"
        class="action-btn btn-raise"
        @click="emit('action', 'raise', halfPotAmount)"
      >
        1/2
      </button>
      <button
        v-if="raiseAction"
        class="action-btn btn-raise"
        @click="handleAction(raiseAction)"
      >
        {{ actionLabel(raiseAction) }}
      </button>
      <button
        v-if="allInAction"
        class="action-btn btn-allin"
        @click="handleAction(allInAction)"
      >
        {{ actionLabel(allInAction) }}
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

const props = defineProps<{
  actions: ActionOption[];
  pot: number;
  bigBlind: number;
  chips: number;
}>();
const emit = defineEmits<{ action: [type: string, amount?: number] }>();

const showRaiseSlider = ref(false);
const raiseAmount = ref(0);

const foldAction = computed(() => props.actions.find((a) => a.type === "fold"));
const callAction = computed(() =>
  props.actions.find((a) => a.type === "call" || a.type === "check"),
);
const raiseAction = computed(() => props.actions.find((a) => a.type === "raise"));
const allInAction = computed(() => props.actions.find((a) => a.type === "allin"));
const raiseMin = computed(() => raiseAction.value?.min || 0);
const raiseMax = computed(() => raiseAction.value?.max || 0);

const quickBetAmount = (fraction: number) =>
  props.bigBlind > 0
    ? Math.floor((props.pot * fraction) / props.bigBlind) * props.bigBlind
    : 0;

const thirdPotAmount = computed(() => quickBetAmount(1 / 3));
const halfPotAmount = computed(() => quickBetAmount(1 / 2));

const canQuickBet = (amount: number) =>
  !!raiseAction.value && amount >= raiseMin.value && props.chips >= amount;

const showThirdPot = computed(() => canQuickBet(thirdPotAmount.value));
const showHalfPot = computed(() => canQuickBet(halfPotAmount.value));

function actionLabel(action: ActionOption): string {
  switch (action.type) {
    case "fold": return "弃牌";
    case "check": return "过牌";
    case "call": return `跟注 ${action.amount}`;
    case "raise": return "加注";
    case "allin": return `全下 ${action.amount}`;
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
