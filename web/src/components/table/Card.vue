<template>
  <div class="card" :class="[{ 'card-back': !visible }, animClass]" :style="cardStyle">
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

const props = withDefaults(
  defineProps<{
    card?: { rank: string; suit: string } | null;
    visible?: boolean;
    effect?: "deal" | "flip";
    delay?: number;
  }>(),
  { effect: "deal", delay: 0 },
);

const suitSymbol = computed(() => (props.card ? SUIT_SYMBOLS[props.card.suit] : ""));
const animClass = computed(() => (props.effect === "flip" ? "card-flip" : "card-deal"));
const cardStyle = computed(() => {
  const style: Record<string, string> = {};
  if (props.visible && props.card) {
    style.backgroundColor = SUIT_COLORS[props.card.suit];
  }
  if (props.delay > 0) {
    style.animationDelay = `${props.delay}s`;
  }
  return style;
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

.card-deal {
  animation: card-deal-in 0.35s ease both;
}
.card-flip {
  animation: card-flip-in 0.45s ease both;
}
@keyframes card-deal-in {
  from {
    opacity: 0;
    transform: translateY(-16px) scale(0.7);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes card-flip-in {
  from {
    opacity: 0;
    transform: rotateY(90deg) scale(0.9);
  }
  to {
    opacity: 1;
    transform: rotateY(0deg) scale(1);
  }
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
