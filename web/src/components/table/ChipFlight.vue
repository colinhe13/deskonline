<template>
  <div class="chip-flight-layer" aria-hidden="true">
    <span
      v-for="f in flights"
      :key="f.id"
      class="flight-chip"
      :style="chipStyle(f)"
      @transitionend="emit('done', f.id)"
    ></span>
  </div>
</template>

<script setup lang="ts">
import { nextTick, watch } from "vue";

export interface ChipFlightItem {
  id: number;
  from: { x: number; y: number };
  to?: { x: number; y: number } | null;
  flying?: boolean;
}

const props = defineProps<{ flights: ChipFlightItem[] }>();
const emit = defineEmits<{ done: [id: number] }>();

// 新筹码挂载在起点后，下一帧再切换到台面中心，触发 CSS transition 飞行。
watch(
  () => props.flights.length,
  async () => {
    await nextTick();
    props.flights.forEach((f) => {
      if (!f.to) {
        f.to = { x: 50, y: 50 };
        f.flying = true;
      }
    });
  },
);

function chipStyle(f: ChipFlightItem) {
  const pos = f.to ?? f.from;
  return {
    left: `${pos.x}%`,
    top: `${pos.y}%`,
    transform: f.flying
      ? "translate(-50%, -50%) scale(0.6)"
      : "translate(-50%, -50%)",
    opacity: f.flying ? 0 : 1,
  };
}
</script>

<style scoped>
.chip-flight-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
.flight-chip {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 50%,
    var(--gold-strong) 0 38%,
    var(--gold) 40% 100%
  );
  border: 2px dashed rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  transition:
    left 0.6s var(--ease-out),
    top 0.6s var(--ease-out),
    opacity 0.55s var(--ease-out),
    transform 0.55s var(--ease-out);
  will-change: left, top;
}
</style>
