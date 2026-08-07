<template>
  <div class="pot-display">
    <div class="chip-stack" aria-hidden="true">
      <span class="chip chip-a"></span>
      <span class="chip chip-b"></span>
      <span class="chip chip-c"></span>
    </div>
    <span class="pot-label">底池</span>
    <span class="pot-amount">{{ displayAmount }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useCountUp } from "../../composables/useCountUp";

const props = defineProps<{ amount: number }>();
const displayAmount = useCountUp(computed(() => props.amount));
</script>

<style scoped>
.pot-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--text);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.chip-stack {
  position: relative;
  width: 32px;
  height: 18px;
  margin-bottom: 3px;
}
.chip {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px dashed rgba(0, 0, 0, 0.35);
  box-shadow:
    inset 0 0 4px rgba(255, 255, 255, 0.45),
    0 1px 3px rgba(0, 0, 0, 0.45);
}
.chip-a {
  left: 1px;
  top: 6px;
  background: radial-gradient(
    circle at 50% 50%,
    var(--gold-strong) 0 38%,
    var(--gold) 40% 100%
  );
}
.chip-b {
  left: 8px;
  top: 3px;
  background: radial-gradient(circle at 50% 50%, #fff 0 38%, #dfe3e8 40% 100%);
}
.chip-c {
  left: 15px;
  top: 0;
  background: radial-gradient(
    circle at 50% 50%,
    var(--success) 0 38%,
    #2f855a 40% 100%
  );
}
.pot-label {
  font-size: var(--fs-xs);
  opacity: 0.7;
  letter-spacing: 0.08em;
}
.pot-amount {
  font-size: 1.2rem;
  font-weight: bold;
  color: var(--gold);
}
</style>
