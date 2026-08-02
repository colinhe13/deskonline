<template>
  <div class="confirm-buyin">
    <div class="confirm-card">
      <h3>确认带入金额</h3>
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
        <input type="number" :min="minBuyIn" :max="maxBuyIn" v-model.number="amount" class="amount-input" />
        <button class="confirm-btn" :disabled="!valid" @click="confirm">确认带入</button>
      </div>
      <p v-if="!valid" class="error">金额需在 {{ minBuyIn }} - {{ maxBuyIn }} 之间</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

const props = defineProps<{ minBuyIn: number; maxBuyIn: number }>();
const emit = defineEmits<{ confirm: [amount: number] }>();

const amount = ref(props.minBuyIn);
const step = computed(() => Math.max(1, Math.floor((props.maxBuyIn - props.minBuyIn) / 100)));
const valid = computed(() => amount.value >= props.minBuyIn && amount.value <= props.maxBuyIn);

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
  background: rgba(0, 0, 0, 0.9);
  padding: 1rem;
  display: flex;
  justify-content: center;
  z-index: 40;
}
.confirm-card {
  width: 100%;
  max-width: 420px;
  color: #fff;
  text-align: center;
}
.confirm-card h3 {
  margin-bottom: 0.25rem;
}
.range-hint {
  font-size: 0.8rem;
  color: #aaa;
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
  padding: 0.5rem;
  border-radius: 6px;
  border: none;
  font-size: 1rem;
  text-align: center;
}
.confirm-btn {
  padding: 0.6rem 1.2rem;
  background: #d69e2e;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
}
.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: #fc8181;
  font-size: 0.8rem;
  margin-top: 0.5rem;
}
</style>
