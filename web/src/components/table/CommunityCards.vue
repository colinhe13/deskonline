<template>
  <div class="community-cards">
    <Card
      v-for="(card, i) in cards"
      :key="i"
      :card="card"
      :visible="true"
      effect="flip"
      :delay="i * 0.08"
    />
    <div v-for="i in emptySlots" :key="'empty-' + i" class="card-slot"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Card from "./Card.vue";

const props = defineProps<{ cards: { rank: string; suit: string }[] }>();
const emptySlots = computed(() => Math.max(0, 5 - props.cards.length));
</script>

<style scoped>
.community-cards {
  display: flex;
  gap: 6px;
  justify-content: center;
  min-height: 56px;
  align-items: center;
}
.card-slot {
  width: 40px;
  height: 56px;
  border: 1px dashed rgba(244, 241, 232, 0.28);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.14);
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.25);
}
@media (max-width: 768px) {
  .community-cards {
    min-height: 44px;
  }
  .card-slot {
    width: 32px;
    height: 44px;
  }
}
</style>
