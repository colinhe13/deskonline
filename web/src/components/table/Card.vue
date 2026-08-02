<template>
  <div class="card" :class="{ 'card-back': !visible }" :style="cardStyle">
    <template v-if="visible && card">
      <span class="card-rank">{{ card.rank }}</span>
      <span class="card-suit">{{ suitSymbol }}</span>
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
const cardStyle = computed(() => {
  if (props.visible && props.card) {
    return { backgroundColor: SUIT_COLORS[props.card.suit] };
  }
  return {};
});
</script>

<style scoped>
.card {
  width: 40px;
  height: 56px;
  background: #fff;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
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
