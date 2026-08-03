<template>
  <div class="voice-panel" :class="{ connected: voice.isConnected.value }">
    <button
      class="mute-btn"
      @click="voice.toggleMute()"
      :title="voice.isMuted.value ? '取消静音' : '静音'"
    >
      {{ voice.isMuted.value ? "🔇" : "🎤" }}
    </button>
    <span class="voice-status">
      <span class="status-dot" aria-hidden="true"></span>
      {{ voice.isConnected.value ? "语音已连接" : "语音未连接" }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { useVoice } from "../../composables/useVoice";

const voice = useVoice();

defineExpose({ voice });
</script>

<style scoped>
.voice-panel {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.8rem;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.mute-btn {
  background: none;
  border: none;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0.2rem;
  min-width: 28px;
  min-height: 28px;
  border-radius: 50%;
  transition: background var(--dur-fast);
}
.mute-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.voice-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
}
.connected .status-dot {
  background: var(--success);
  animation: dot-pulse 1.6s ease-in-out infinite;
}
.connected .voice-status {
  color: var(--success);
}
@keyframes dot-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(104, 211, 145, 0.5);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(104, 211, 145, 0);
  }
}
</style>
