<template>
  <p v-if="names.length > 0" class="spectator-list">
    观战者：{{ names.join("、") }}
  </p>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SpectatorInfo } from "../../stores/game";

const props = defineProps<{
  spectators: SpectatorInfo[];
  myUserId: string | null;
}>();

// The current user's own spectator state is shown by the "观战中" banner,
// so the list must exclude them to avoid a duplicate entry.
const names = computed(() =>
  props.spectators
    .filter((spectator) => spectator.userId !== props.myUserId)
    .map((spectator) => spectator.username),
);
</script>

<style scoped>
.spectator-list {
  text-align: center;
  color: var(--text-faint);
  font-size: var(--fs-xs);
  padding: 0.25rem 1rem 0;
  margin: 0;
}
</style>
