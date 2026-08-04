<template>
  <div class="confirm-buyin">
    <div class="confirm-card">
      <h3>{{ title || "确认带入金额" }}</h3>
      <p class="range-hint">范围 {{ minBuyIn }} - {{ maxBuyIn }}</p>
      <input
        type="range"
        :min="minBuyIn"
        :max="maxBuyIn"
        :step="step"
        v-model.number="amount"
        class="slider"
      />
      <div class="amount-row">
        <input
          type="number"
          :min="minBuyIn"
          :max="maxBuyIn"
          v-model.number="amount"
          class="amount-input"
        />
        <button class="confirm-btn" :disabled="!valid" @click="confirm">
          {{ submitLabel || "确认带入" }}
        </button>
      </div>
      <p v-if="!valid" class="error">
        金额需在 {{ minBuyIn }} - {{ maxBuyIn }} 之间
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

const props = defineProps<{
  minBuyIn: number;
  maxBuyIn: number;
  title?: string;
  submitLabel?: string;
}>();
const emit = defineEmits<{ confirm: [amount: number] }>();

const amount = ref(props.minBuyIn);
const step = computed(() =>
  Math.max(1, Math.floor((props.maxBuyIn - props.minBuyIn) / 100)),
);
const valid = computed(
  () =>
    Number.isInteger(amount.value) &&
    amount.value >= props.minBuyIn &&
    amount.value <= props.maxBuyIn,
);

function confirm() {
  if (valid.value) emit("confirm", amount.value);
}
</script>

<style scoped>
.confirm-buyin {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: var(--z-actionbar);
  background: rgba(8, 20, 14, 0.88);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-top: 1px solid var(--glass-border);
  padding: 1rem;
  padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  display: flex;
  justify-content: center;
  animation: sheet-in 0.35s var(--ease-spring) both;
}
@keyframes sheet-in {
  from {
    opacity: 0;
    transform: translateY(100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.confirm-card {
  width: 100%;
  max-width: 420px;
  color: var(--text);
  text-align: center;
}
.confirm-card h3 {
  margin-bottom: 0.25rem;
  letter-spacing: 0.05em;
}
.range-hint {
  font-size: var(--fs-sm);
  color: var(--text-dim);
  margin-bottom: 0.75rem;
}
.slider {
  width: 100%;
  margin-bottom: 0.75rem;
}
.amount-row {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  align-items: center;
}
.amount-input {
  width: 120px;
  padding: 0.55rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: rgba(0, 0, 0, 0.35);
  color: var(--text);
  font-size: var(--fs-md);
  text-align: center;
}
.amount-input:focus {
  outline: none;
  border-color: var(--gold);
}
.confirm-btn {
  padding: 0.6rem 1.2rem;
  min-height: 44px;
  background: linear-gradient(160deg, var(--gold), var(--gold-strong));
  color: #1c1304;
  font-weight: 600;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.confirm-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-glow-gold);
}
.confirm-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: var(--danger);
  font-size: var(--fs-sm);
  margin-top: 0.5rem;
}
</style>
