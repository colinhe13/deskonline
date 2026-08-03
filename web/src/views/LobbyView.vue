<template>
  <div class="lobby-page">
    <header class="lobby-header">
      <h1>大厅</h1>
      <div class="user-info">
        <span class="user-name">{{ auth.user?.username }}</span>
        <span class="points-pill">
          <span class="chip-icon" aria-hidden="true"></span>
          <span class="points">{{ displayPoints }}</span>
        </span>
        <button class="logout-btn" @click="auth.logout()">退出</button>
      </div>
    </header>
    <main class="lobby-content">
      <RoomList :rooms="lobby.rooms" @join="joinRoom" />
    </main>
    <Transition name="toast">
      <div v-if="toastMsg" class="lobby-toast" :class="toastKind">
        {{ toastMsg }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useLobbyStore } from "../stores/lobby";
import { useGameStore } from "../stores/game";
import { useWebSocket } from "../composables/useWebSocket";
import { useCountUp } from "../composables/useCountUp";
import RoomList from "../components/lobby/RoomList.vue";
import type { RoomSummary } from "../stores/lobby";
import type { RoomDetail } from "../stores/game";

const auth = useAuthStore();
const lobby = useLobbyStore();
const game = useGameStore();
const router = useRouter();
const { send, onMessage, offMessage } = useWebSocket();

const displayPoints = useCountUp(computed(() => auth.user?.points ?? 0));

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

const toastMsg = ref("");
const toastKind = ref<"error" | "info">("info");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, kind: "error" | "info") {
  toastMsg.value = message;
  toastKind.value = kind;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = ""), 3000);
}

function handleRoomError(payload: unknown) {
  const p = payload as { message?: string };
  showToast(p.message || "操作失败", "error");
}

onMounted(() => {
  onMessage("room:list", handleRoomList);
  onMessage("room:state", handleRoomState);
  onMessage("room:error", handleRoomError);
  send("room:list:request", {});
});

onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer);
  offMessage("room:list", handleRoomList);
  offMessage("room:state", handleRoomState);
  offMessage("room:error", handleRoomError);
});
</script>

<style scoped>
.lobby-page {
  min-height: 100dvh;
  background:
    radial-gradient(
      90% 60% at 50% -10%,
      var(--felt-0) 0%,
      rgba(34, 112, 74, 0) 55%
    ),
    radial-gradient(130% 100% at 50% 0%, var(--bg-1) 0%, var(--bg-0) 62%);
}
.lobby-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.9rem 2rem;
  background: rgba(10, 28, 18, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--glass-border);
}
.lobby-header h1 {
  margin: 0;
  font-size: var(--fs-lg);
  letter-spacing: 0.08em;
  color: var(--text);
}
.user-info {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  font-size: var(--fs-sm);
}
.user-name {
  color: var(--text-dim);
}
.points-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.75rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(240, 199, 94, 0.35);
  border-radius: var(--radius-pill);
  color: var(--gold);
  font-weight: 600;
}
.chip-icon {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: radial-gradient(
    circle at center,
    var(--gold-strong) 0 38%,
    var(--gold) 40% 100%
  );
  border: 2px dashed rgba(0, 0, 0, 0.4);
  box-shadow: 0 0 6px rgba(240, 199, 94, 0.5);
}
.points {
  min-width: 2ch;
  text-align: right;
}
.logout-btn {
  padding: 0.4rem 0.9rem;
  min-height: 44px;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition:
    color var(--dur-fast),
    border-color var(--dur-fast),
    background var(--dur-fast);
}
.logout-btn:hover {
  color: var(--text);
  border-color: var(--gold);
  background: rgba(240, 199, 94, 0.1);
}
.lobby-content {
  padding: 1.5rem 2rem;
  max-width: 800px;
  margin: 0 auto;
}
.lobby-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.6rem 1.2rem;
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  color: var(--text);
  z-index: var(--z-toast);
  box-shadow: var(--shadow-md);
}
.lobby-toast.error {
  background: linear-gradient(160deg, var(--danger), #a93226);
}
.lobby-toast.info {
  background: linear-gradient(160deg, #2a5a8c, #4a90d9);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 16px);
}

@media (max-width: 768px) {
  .lobby-header {
    padding: 0.75rem 1rem;
  }
  .user-name {
    display: none;
  }
  .lobby-content {
    padding: 1rem;
  }
}

@media (max-width: 480px) {
  .lobby-header {
    padding: 0.6rem 0.75rem;
  }
  .lobby-header h1 {
    font-size: var(--fs-md);
  }
  .user-info {
    gap: 0.5rem;
  }
  .points-pill {
    padding: 0.25rem 0.6rem;
    font-size: var(--fs-xs);
  }
  .logout-btn {
    min-height: 40px;
    padding: 0.3rem 0.7rem;
    font-size: var(--fs-xs);
  }
  .lobby-content {
    padding: 0.75rem;
  }
  .room-info {
    gap: 0.6rem;
    font-size: var(--fs-xs);
  }
}
</style>
