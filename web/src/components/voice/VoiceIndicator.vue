<template>
  <div class="voice-indicator" :class="{ speaking, muted }">
    <span v-if="muted" class="muted-icon">🔇</span>
    <span v-else-if="speaking" class="speaking-ring"></span>
  </div>
</template>

<script setup lang="ts">
defineProps<{ speaking: boolean; muted: boolean }>();
</script>

<style scoped>
.voice-indicator {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
}
.muted-icon {
  font-size: 0.6rem;
}
.speaking-ring {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #68d391;
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(104, 211, 145, 0.6); }
  70% { box-shadow: 0 0 0 6px rgba(104, 211, 145, 0); }
  100% { box-shadow: 0 0 0 0 rgba(104, 211, 145, 0); }
}
</style>
