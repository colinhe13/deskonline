<template>
  <router-view v-slot="{ Component }">
    <Transition name="page" mode="out-in">
      <component :is="Component" />
    </Transition>
  </router-view>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useWebSocket } from "./composables/useWebSocket";
import { useVoice } from "./composables/useVoice";
import { useAuthStore } from "./stores/auth";
import { VOICE_ENABLED } from "./utils/featureFlags";

const ws = useWebSocket();
const voice = useVoice();
const auth = useAuthStore();

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
    auth.fetchMe();
  }
  if (VOICE_ENABLED) {
    ws.onMessage("voice:token", handleVoiceToken);
    ws.onMessage("voice:disconnect", handleVoiceDisconnect);
  }
});

onUnmounted(() => {
  if (VOICE_ENABLED) {
    ws.offMessage("voice:token", handleVoiceToken);
    ws.offMessage("voice:disconnect", handleVoiceDisconnect);
  }
});
</script>
