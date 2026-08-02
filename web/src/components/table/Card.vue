<template>
  <div class="card" :class="{ 'card-back': !visible }">
    <template v-if="visible && card">
      <span class="card-rank" :style="{ color: suitColor }">{{ card.rank }}</span>
      <span class="card-suit" :style="{ color: suitColor }">{{ suitSymbol }}</span>
    </template>
    <template v-else>
      <span class="card-pattern">🂠</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { SUIT_SYMBOLS, SUIT_COLORS } from "../../utils/cards";

const props = defineProps<{
  card?: { rank: string; suit: string } | null;
  visible?: boolean;
}>();

const suitSymbol = computed(() => (props.card ? SUIT_SYMBOLS[props.card.suit] : ""));
const suitColor = computed(() => (props.card ? SUIT_COLORS[props.card.suit] : "#333"));
</script>

<style scoped>
.card {
  width: 40px;
  height: 56px;
  background: #fff;
  border-radius: 4px;
  border: 1px solid #ccc;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
.card-back {
  background: #2b5797;
  border-color: #1a3a6b;
}
.card-pattern {
  font-size: 1.5rem;
  color: rgba(255, 255, 255, 0.6);
}
.card-rank {
  font-size: 0.9rem;
  line-height: 1;
}
.card-suit {
  font-size: 1.1rem;
  line-height: 1;
}

@media (max-width: 768px) {
  .card {
    width: 32px;
    height: 44px;
  }
  .card-rank {
    font-size: 0.75rem;
  }
  .card-suit {
    font-size: 0.9rem;
  }
}
</style>
