<template>
  <div class="table-page">
    <header class="table-header">
      <button @click="leaveRoom">离开</button>
      <span>房间 #{{ game.room?.id }}</span>
      <div class="header-right">
        <VoicePanel />
        <button v-if="isHost && game.room?.status === 'waiting'" @click="startGame">
          开始游戏
        </button>
      </div>
    </header>
    <main class="table-main">
      <PokerTable :room="game.room" :poker-state="game.pokerState" :my-user-id="game.myUserId" />
    </main>

    <ActionBar
      v-if="game.isMyTurn"
      :actions="game.availableActions"
      :time-left="timeLeft"
      @action="handleAction"
    />

    <div v-if="game.handResult" class="hand-result-overlay">
      <div class="hand-result-card">
        <h3>本手结束</h3>
        <div v-for="w in game.handResult.winners" :key="w.userId" class="winner-row">
          <span>{{ winnerName(w.userId) }}</span>
          <span class="winner-amount">+{{ w.amount }}</span>
        </div>
      </div>
    </div>

    <div v-if="reconnecting" class="reconnect-overlay">正在重新连接...</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useGameStore } from "../stores/game";
import { useWebSocket } from "../composables/useWebSocket";
import PokerTable from "../components/table/PokerTable.vue";
import ActionBar from "../components/table/ActionBar.vue";
import VoicePanel from "../components/voice/VoicePanel.vue";
import type { RoomDetail, PokerState, ActionOption, HandResultInfo } from "../stores/game";

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();
const { isReconnecting: reconnecting, send, onMessage, offMessage } = useWebSocket();

const timeLeft = ref(30);
let turnTimer: ReturnType<typeof setInterval> | null = null;

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

function handlePokerUpdate(payload: unknown) {
  const p = payload as { state: PokerState; availableActions: ActionOption[] };
  game.setPokerState(p.state, p.availableActions);
  game.setHandResult(null);

  if (p.availableActions.length > 0) {
    startTurnTimer();
  } else {
    stopTurnTimer();
  }
}

function handleHandResult(payload: unknown) {
  game.setHandResult(payload as HandResultInfo);
  stopTurnTimer();
  setTimeout(() => game.setHandResult(null), 4000);
}

function startTurnTimer() {
  stopTurnTimer();
  timeLeft.value = 30;
  turnTimer = setInterval(() => {
    timeLeft.value = Math.max(0, timeLeft.value - 1);
  }, 1000);
}

function stopTurnTimer() {
  if (turnTimer) {
    clearInterval(turnTimer);
    turnTimer = null;
  }
}

function winnerName(userId: string): string {
  const player = game.pokerState?.players.find((p) => p.userId === userId);
  return player?.username || userId;
}

function handleAction(type: string, amount?: number) {
  send("poker:action", { action: type, amount });
  stopTurnTimer();
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
  game.setMyUserId(auth.user?.id ?? null);
  onMessage("room:state", handleRoomState);
  onMessage("poker:update", handlePokerUpdate);
  onMessage("poker:hand_result", handleHandResult);
});

onUnmounted(() => {
  stopTurnTimer();
  offMessage("room:state", handleRoomState);
  offMessage("poker:update", handlePokerUpdate);
  offMessage("poker:hand_result", handleHandResult);
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
.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.table-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  padding-bottom: 90px;
}
.hand-result-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.hand-result-card {
  background: #fff;
  border-radius: 12px;
  padding: 1.5rem 2rem;
  min-width: 240px;
  text-align: center;
}
.hand-result-card h3 {
  color: #1a472a;
  margin-bottom: 0.75rem;
}
.winner-row {
  display: flex;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 0.25rem 0;
  font-size: 0.95rem;
}
.winner-amount {
  color: #d69e2e;
  font-weight: bold;
}
.reconnect-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: #d69e2e;
  color: #fff;
  text-align: center;
  padding: 0.5rem;
  z-index: 60;
  font-size: 0.85rem;
}
</style>
