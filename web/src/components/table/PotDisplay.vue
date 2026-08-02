<template>
  <div class="pot-display">
    <span class="pot-label">底池</span>
    <span class="pot-amount">{{ amount }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{ amount: number }>();
</script>

<style scoped>
.pot-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #fff;
}
.pot-label {
  font-size: 0.7rem;
  opacity: 0.7;
}
.pot-amount {
  font-size: 1.2rem;
  font-weight: bold;
  color: #ffd700;
}
</style>
