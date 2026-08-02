<template>
  <div class="lobby-page">
    <header class="lobby-header">
      <h1>大厅</h1>
      <div class="user-info">
        <span>{{ auth.user?.username }} | {{ auth.user?.points }} 分</span>
        <button @click="auth.logout()">退出</button>
      </div>
    </header>
    <main class="lobby-content">
      <RoomList :rooms="lobby.rooms" @join="joinRoom" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useLobbyStore } from "../stores/lobby";
import { useGameStore } from "../stores/game";
import { useWebSocket } from "../composables/useWebSocket";
import RoomList from "../components/lobby/RoomList.vue";
import type { RoomSummary } from "../stores/lobby";
import type { RoomDetail } from "../stores/game";

const auth = useAuthStore();
const lobby = useLobbyStore();
const game = useGameStore();
const router = useRouter();
const { send, onMessage, offMessage } = useWebSocket();

function handleRoomList(payload: unknown) {
  const p = payload as { rooms: RoomSummary[] };
  lobby.updateRooms(p.rooms);
}

function handleRoomState(payload: unknown) {
  const p = payload as { room: RoomDetail | null; reason?: string };
  if (p.room) {
    game.setRoom(p.room);
    game.setMyUserId(auth.user?.id ?? null);
    router.push(`/table/${p.room.id}`);
  }
}

function joinRoom(room: RoomSummary) {
  send("room:join", { roomId: room.id });
}

onMounted(() => {
  onMessage("room:list", handleRoomList);
  onMessage("room:state", handleRoomState);
  send("room:list:request", {});
});

onUnmounted(() => {
  offMessage("room:list", handleRoomList);
  offMessage("room:state", handleRoomState);
});
</script>

<style scoped>
.lobby-page {
  min-height: 100vh;
  background: #f0f4f0;
}
.lobby-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: #1a472a;
  color: #fff;
}
.lobby-header h1 {
  margin: 0;
  font-size: 1.25rem;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-size: 0.9rem;
}
.user-info button {
  padding: 0.4rem 0.8rem;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.lobby-content {
  padding: 1.5rem 2rem;
  max-width: 800px;
  margin: 0 auto;
}
</style>
