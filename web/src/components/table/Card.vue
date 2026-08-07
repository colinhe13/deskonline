<template>
  <div
    class="card"
    :class="[{ 'card-face-down': !visible }, animClass]"
    :style="cardStyle"
  >
    <div class="card-inner">
      <div class="card-front">
        <template v-if="visible && card">
          <span class="card-rank">{{ card.rank }}</span>
          <span class="card-suit">{{ suitSymbol }}</span>
        </template>
      </div>
      <div class="card-back-face">
        <span class="card-pattern">🂠</span>
      </div>
    </div>
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

const suitSymbol = computed(() =>
  props.card ? SUIT_SYMBOLS[props.card.suit] : "",
);
const animClass = computed(() =>
  props.effect === "flip" ? "card-flip" : "card-deal",
);
const cardStyle = computed(() => {
  const style: Record<string, string> = {};
  if (props.visible && props.card) {
    style["--card-color"] = SUIT_COLORS[props.card.suit];
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
  border-radius: 6px;
  perspective: 200px;
  flex-shrink: 0;
}
.card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  transition: transform 0.45s var(--ease-out);
}
.card-face-down .card-inner {
  transform: rotateY(180deg);
}
.card-front,
.card-back-face {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: #fff;
  overflow: hidden;
}
.card-front {
  background:
    linear-gradient(
      160deg,
      rgba(255, 255, 255, 0.35) 0%,
      rgba(255, 255, 255, 0) 42%
    ),
    var(--card-color, #2563eb);
  border: 1px solid rgba(0, 0, 0, 0.3);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
.card-front::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 1px solid rgba(255, 255, 255, 0.28);
  pointer-events: none;
}
.card-back-face {
  transform: rotateY(180deg);
  background:
    repeating-linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.05) 0 3px,
      transparent 3px 6px
    ),
    linear-gradient(160deg, var(--card-back-0), var(--card-back-1));
  border: 1px solid var(--card-back-1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
.card-pattern {
  font-size: 1.5rem;
  color: rgba(255, 255, 255, 0.65);
}
.card-rank {
  font-size: 0.9rem;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}
.card-suit {
  font-size: 1.1rem;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

.card-deal .card-inner {
  animation: card-deal-in 0.35s var(--ease-out) both;
}
.card-flip .card-inner {
  animation: card-flip-in 0.45s var(--ease-out) both;
}
@keyframes card-deal-in {
  from {
    opacity: 0;
    transform: translateY(-16px) scale(0.7);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1) rotateY(0deg);
  }
}
@keyframes card-flip-in {
  from {
    opacity: 0;
    transform: rotateY(180deg) scale(0.9);
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
