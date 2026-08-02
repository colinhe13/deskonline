<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useWebSocket } from "./composables/useWebSocket";
import { useVoice } from "./composables/useVoice";

const ws = useWebSocket();
const voice = useVoice();

function handleVoiceToken(payload: unknown) {
  const p = payload as { token: string; url: string };
  voice.connect(p.url, p.token);
}

function handleVoiceDisconnect() {
  voice.disconnect();
}

onMounted(() => {
  if (localStorage.getItem("token")) {
    ws.connect();
  }
  ws.onMessage("voice:token", handleVoiceToken);
  ws.onMessage("voice:disconnect", handleVoiceDisconnect);
});

onUnmounted(() => {
  ws.offMessage("voice:token", handleVoiceToken);
  ws.offMessage("voice:disconnect", handleVoiceDisconnect);
});
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>
