<template>
  <div class="table-page">
    <header class="table-header">
      <button @click="leaveRoom">离开</button>
      <span>房间 #{{ game.room?.id }}</span>
      <button v-if="isHost && game.room?.status === 'waiting'" @click="startGame">
        开始游戏
      </button>
    </header>
    <main class="table-main">
      <PokerTable :room="game.room" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useGameStore } from "../stores/game";
import { useWebSocket } from "../composables/useWebSocket";
import PokerTable from "../components/table/PokerTable.vue";
import type { RoomDetail } from "../stores/game";

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();
const { connect, disconnect, send, onMessage, offMessage } = useWebSocket();

const isHost = computed(() => game.room?.hostId === auth.user?.id);

function handleRoomState(payload: unknown) {
  const p = payload as { room: RoomDetail | null; reason?: string };
  if (p.room) {
    game.setRoom(p.room);
  } else {
    game.setRoom(null);
    router.push("/lobby");
  }
}

function leaveRoom() {
  send("room:leave", {});
  game.setRoom(null);
  router.push("/lobby");
}

function startGame() {
  send("room:start", {});
}

onMounted(() => {
  connect();
  onMessage("room:state", handleRoomState);
});

onUnmounted(() => {
  offMessage("room:state", handleRoomState);
  disconnect();
});
</script>

<style scoped>
.table-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1a472a;
}
.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.5rem;
  color: #fff;
  font-size: 0.9rem;
}
.table-header button {
  padding: 0.4rem 0.8rem;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.table-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
</style>
