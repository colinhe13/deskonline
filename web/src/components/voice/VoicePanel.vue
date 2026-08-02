<template>
  <div class="voice-panel" :class="{ connected: voice.isConnected.value }">
    <button class="mute-btn" @click="voice.toggleMute()" :title="voice.isMuted.value ? '取消静音' : '静音'">
      {{ voice.isMuted.value ? "🔇" : "🎤" }}
    </button>
    <span class="voice-status">{{ voice.isConnected.value ? "语音已连接" : "语音未连接" }}</span>
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
  background: rgba(0, 0, 0, 0.6);
  border-radius: 20px;
}
.mute-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.2rem;
}
.voice-status {
  font-size: 0.7rem;
  color: #aaa;
}
.connected .voice-status {
  color: #68d391;
}
</style>
