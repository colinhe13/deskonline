<template>
  <div class="community-cards">
    <Card v-for="(card, i) in cards" :key="i" :card="card" :visible="true" />
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
}
.card-slot {
  width: 40px;
  height: 56px;
  border: 1px dashed rgba(255, 255, 255, 0.3);
  border-radius: 4px;
}
@media (max-width: 768px) {
  .card-slot {
    width: 32px;
    height: 44px;
  }
}
</style>
