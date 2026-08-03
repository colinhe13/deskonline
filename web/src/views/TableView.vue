<template>
  <div class="table-page">
    <header class="table-header">
      <button @click="leaveRoom">离开</button>
      <span>房间 #{{ game.room?.id }}</span>
      <div class="header-right">
        <VoicePanel v-if="VOICE_ENABLED" />
        <template v-if="isHost && game.room?.status === 'waiting'">
          <button @click="showSettings = true">设置</button>
          <button @click="showTransfer = true">移交房主</button>
          <button class="start-btn" :disabled="!canStart" @click="startGame">开始游戏</button>
        </template>
      </div>
    </header>

    <p v-if="game.room?.status === 'waiting' && !canStart && isHost" class="start-hint">
      至少需要 2 名玩家确认带入后才能开始（已确认 {{ game.room?.confirmedCount ?? 0 }}）
    </p>

    <main class="table-main">
      <PokerTable
        :room="game.room"
        :poker-state="game.pokerState"
        :my-user-id="game.myUserId"
        :hand-result="game.handResult"
        @sit="moveSeat"
      />
    </main>

    <ActionBar
      v-if="game.isMyTurn"
      :actions="game.availableActions"
      :poker-state="game.pokerState"
      :my-user-id="game.myUserId"
      @action="handleAction"
    />

    <ConfirmBuyIn
      v-if="needConfirmBuyIn"
      :min-buy-in="game.room!.minBuyIn"
      :max-buy-in="game.room!.maxBuyIn"
      @confirm="confirmBuyIn"
    />

    <RoomSettingsModal
      v-if="showSettings"
      :settings="settingsForm"
      @close="showSettings = false"
      @save="saveSettings"
    />

    <TransferHostModal
      v-if="showTransfer"
      :seats="game.room?.seats ?? []"
      :my-user-id="game.myUserId"
      @close="showTransfer = false"
      @transfer="transferHost"
    />

    <div v-if="game.handResult" class="hand-result-banner">
      <div v-for="w in game.handResult.winners" :key="w.userId" class="winner-block">
        <span class="winner-name">{{ winnerName(w.userId) }}</span>
        <span class="winner-hand">
          {{ game.handResult.reason === "showdown" ? game.handResult.handNames[w.userId] || "" : "其他玩家弃牌" }}
        </span>
        <span class="winner-amount">+{{ w.amount }}</span>
      </div>
      <button v-if="canRevealCards" class="reveal-btn" @click="revealMyCards">
        展示手牌
      </button>
    </div>

    <div v-if="errorMsg" class="error-toast">{{ errorMsg }}</div>
    <div v-if="reconnecting" class="reconnect-overlay">正在重新连接...</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useGameStore } from "../stores/game";
import { useWebSocket } from "../composables/useWebSocket";
import { VOICE_ENABLED } from "../utils/featureFlags";
import PokerTable from "../components/table/PokerTable.vue";
import ActionBar from "../components/table/ActionBar.vue";
import VoicePanel from "../components/voice/VoicePanel.vue";
import ConfirmBuyIn from "../components/table/ConfirmBuyIn.vue";
import RoomSettingsModal from "../components/table/RoomSettingsModal.vue";
import TransferHostModal from "../components/table/TransferHostModal.vue";
import type { RoomDetail, PokerState, ActionOption, HandResultInfo } from "../stores/game";

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();
const { isReconnecting: reconnecting, send, onMessage, offMessage } = useWebSocket();

const showSettings = ref(false);
const showTransfer = ref(false);
const errorMsg = ref("");
const revealedMine = ref(false);
let errorTimer: ReturnType<typeof setTimeout> | null = null;

const isHost = computed(() => game.room?.hostId != null && game.room.hostId === game.myUserId);
const mySeat = computed(() => game.room?.seats.find((s) => s.userId === game.myUserId));
const canStart = computed(() => (game.room?.confirmedCount ?? 0) >= 2);
const needConfirmBuyIn = computed(
  () => game.room?.status === "waiting" && mySeat.value && !mySeat.value.confirmed,
);

const settingsForm = computed(() => ({
  maxPlayers: game.room?.maxPlayers ?? 9,
  smallBlind: game.room?.smallBlind ?? 1,
  bigBlind: game.room?.bigBlind ?? 2,
  minBuyIn: game.room?.minBuyIn ?? 150,
  maxBuyIn: game.room?.maxBuyIn ?? 750,
}));

const canRevealCards = computed(
  () =>
    !!game.handResult &&
    game.handResult.reason === "fold" &&
    game.handResult.winners.some((w) => w.userId === game.myUserId) &&
    !revealedMine.value,
);

function revealMyCards() {
  send("poker:reveal", {});
  revealedMine.value = true;
}

function showError(message: string) {
  errorMsg.value = message;
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (errorMsg.value = ""), 3000);
}

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
  // Only clear the winner banner when a new hand begins (preflop). The engine
  // re-broadcasts a "settled" state right after showdown, which must not wipe
  // the result display.
  if (p.state.phase === "preflop") {
    game.setHandResult(null);
    revealedMine.value = false;
  }
}

function handleHandResult(payload: unknown) {
  game.setHandResult(payload as HandResultInfo);
  setTimeout(() => game.setHandResult(null), 5000);
}

function handleRoomError(payload: unknown) {
  const p = payload as { message?: string };
  showError(p.message || "操作失败");
}

function winnerName(userId: string): string {
  const player = game.pokerState?.players.find((p) => p.userId === userId);
  return player?.username || userId;
}

function handleAction(type: string, amount?: number) {
  send("poker:action", { action: type, amount });
}

function confirmBuyIn(amount: number) {
  send("room:confirm", { buyIn: amount });
}

function saveSettings(form: {
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
}) {
  send("room:update-settings", form);
  showSettings.value = false;
}

function transferHost(targetUserId: string) {
  send("room:transfer-host", { targetUserId });
  showTransfer.value = false;
}

function moveSeat(seatIndex: number) {
  send("room:move-seat", { seatIndex });
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
  onMessage("room:error", handleRoomError);
});

onUnmounted(() => {
  if (errorTimer) clearTimeout(errorTimer);
  offMessage("room:state", handleRoomState);
  offMessage("poker:update", handlePokerUpdate);
  offMessage("poker:hand_result", handleHandResult);
  offMessage("room:error", handleRoomError);
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
.start-btn {
  background: #d69e2e !important;
}
.start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.start-hint {
  text-align: center;
  color: #fbd38d;
  font-size: 0.8rem;
  padding: 0 1rem;
}
.table-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  padding-bottom: 90px;
}
.hand-result-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  padding: 0.5rem 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  flex-wrap: wrap;
  z-index: 45;
  animation: banner-drop 0.3s ease both;
}
.winner-block {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.winner-name {
  font-size: 1.1rem;
  font-weight: bold;
  color: #ffd700;
}
.winner-hand {
  font-size: 0.9rem;
  color: #fbd38d;
}
.winner-amount {
  font-size: 1.1rem;
  color: #68d391;
  font-weight: bold;
}
.reveal-btn {
  padding: 0.35rem 0.9rem;
  background: #d69e2e;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}
.reveal-btn:hover {
  background: #b7791f;
}
@keyframes banner-drop {
  from {
    opacity: 0;
    transform: translateY(-100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.error-toast {
  position: fixed;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  background: #e53e3e;
  color: #fff;
  padding: 0.6rem 1.2rem;
  border-radius: 6px;
  z-index: 70;
  font-size: 0.85rem;
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
