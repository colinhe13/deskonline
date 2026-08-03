<template>
  <div class="table-page">
    <header class="table-header">
      <button v-if="!isSpectator" @click="leaveRoom">离开</button>
      <span class="room-no">房间 #{{ game.room?.id }}</span>
      <div class="header-right">
        <VoicePanel v-if="VOICE_ENABLED" />
        <button
          v-if="isHost"
          class="add-ai-btn"
          :disabled="isRoomFull"
          @click="addAi"
        >
          添加 AI
        </button>
        <template v-if="isHost && game.room?.status === 'waiting'">
          <button @click="showSettings = true">设置</button>
          <button @click="showTransfer = true">移交房主</button>
          <button class="start-btn" :disabled="!canStart" @click="startGame">
            开始游戏
          </button>
        </template>
      </div>
    </header>

    <p
      v-if="game.room?.status === 'waiting' && !canStart && isHost"
      class="start-hint"
    >
      至少需要 2 名玩家确认带入后才能开始（已确认
      {{ game.room?.confirmedCount ?? 0 }}）
    </p>
    <p
      v-if="game.room?.status === 'waiting' && game.room.autoResume"
      class="pause-hint"
    >
      牌局暂停：等待输光玩家重新带入
    </p>

    <div v-if="isSpectator" class="spectate-banner">
      <span class="spectate-badge">观战中</span>
      <span v-if="canSitFromSpectate" class="spectate-hint">
        点击空座位即可入座
      </span>
      <span v-else class="spectate-hint">本手牌结束后可入座</span>
      <button class="spectate-leave" @click="leaveRoom">退出观战</button>
    </div>

    <p v-if="spectatorNames.length > 0" class="spectator-list">
      观战者：{{ spectatorNames.join("、") }}
    </p>

    <main class="table-main">
      <PokerTable
        :room="game.room"
        :poker-state="game.pokerState"
        :my-user-id="game.myUserId"
        :hand-result="game.handResult"
        :is-viewer-host="isHost"
        @sit="handleSitDown"
        @remove-ai="removeAi"
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

    <Transition name="modal">
      <RoomSettingsModal
        v-if="showSettings"
        :settings="settingsForm"
        @close="showSettings = false"
        @save="saveSettings"
      />
    </Transition>

    <Transition name="modal">
      <TransferHostModal
        v-if="showTransfer"
        :seats="game.room?.seats ?? []"
        :my-user-id="game.myUserId"
        @close="showTransfer = false"
        @transfer="transferHost"
      />
    </Transition>

    <div v-if="game.handResult" class="hand-result-banner">
      <div
        v-for="w in game.handResult.winners"
        :key="w.userId"
        class="winner-block"
      >
        <span class="winner-name">{{ winnerName(w.userId) }}</span>
        <span class="winner-hand">
          {{
            game.handResult.reason === "showdown"
              ? game.handResult.handNames[w.userId] || ""
              : "其他玩家弃牌"
          }}
        </span>
        <span class="winner-amount">+{{ w.amount }}</span>
      </div>
      <button v-if="canRevealCards" class="reveal-btn" @click="revealMyCards">
        展示手牌
      </button>
    </div>

    <Transition name="toast">
      <div v-if="errorMsg" class="error-toast">{{ errorMsg }}</div>
    </Transition>
    <Transition name="reconnect">
      <div v-if="reconnecting" class="reconnect-overlay">正在重新连接...</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
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
import type {
  RoomDetail,
  PokerState,
  ActionOption,
  HandResultInfo,
} from "../stores/game";

const auth = useAuthStore();
const game = useGameStore();
const route = useRoute();
const router = useRouter();
const {
  isReconnecting: reconnecting,
  send,
  isOpen,
  onMessage,
  offMessage,
} = useWebSocket();

const showSettings = ref(false);
const showTransfer = ref(false);
const errorMsg = ref("");
const revealedMine = ref(false);
let errorTimer: ReturnType<typeof setTimeout> | null = null;

const isHost = computed(
  () => game.room?.hostId != null && game.room.hostId === game.myUserId,
);
const mySeat = computed(() =>
  game.room?.seats.find((s) => s.userId === game.myUserId),
);
const isSpectator = computed(
  () =>
    !!game.myUserId &&
    !!game.room?.spectators?.some((s) => s.userId === game.myUserId),
);
const spectatorNames = computed(
  () =>
    game.room?.spectators
      ?.filter((s) => s.userId !== game.myUserId)
      .map((s) => s.username) ?? [],
);
const canStart = computed(() => (game.room?.confirmedCount ?? 0) >= 2);
const isRoomFull = computed(
  () => !!game.room && game.room.playerCount >= game.room.maxPlayers,
);
const canSitFromSpectate = computed(
  () => game.room?.status === "waiting" && !isRoomFull.value,
);
const needConfirmBuyIn = computed(
  () =>
    game.room?.status === "waiting" && mySeat.value && !mySeat.value.confirmed,
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

function handleSitDown(seatIndex: number) {
  if (isSpectator.value && game.room) {
    send("room:join", { roomId: game.room.id, seatIndex });
  } else {
    send("room:move-seat", { seatIndex });
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

function addAi() {
  send("ai:add", {});
}

function removeAi(targetUserId: string) {
  send("ai:remove", { targetUserId });
}

function handleReconnectSuccess(payload: unknown) {
  const p = payload as { roomId?: string };
  if (p.roomId && route.params.id !== p.roomId) {
    router.replace("/table/" + p.roomId);
  }
}

// Not seated anywhere: entering the table URL directly (or after the 60s
// eject window) should behave like the lobby entry — join the target room.
function handleReconnectFailed() {
  const roomId = route.params.id;
  if (typeof roomId === "string" && roomId) {
    send("room:join", { roomId });
  }
}

onMounted(() => {
  game.setMyUserId(auth.user?.id ?? null);
  onMessage("room:state", handleRoomState);
  onMessage("poker:update", handlePokerUpdate);
  onMessage("poker:hand_result", handleHandResult);
  onMessage("room:error", handleRoomError);
  onMessage("reconnect:success", handleReconnectSuccess);
  onMessage("reconnect:failed", handleReconnectFailed);
  // The global onopen already requests a snapshot; if the socket was open
  // before this view mounted, request it here so the state is never stale.
  if (isOpen()) {
    send("reconnect", {});
  }
});

onUnmounted(() => {
  if (errorTimer) clearTimeout(errorTimer);
  offMessage("room:state", handleRoomState);
  offMessage("poker:update", handlePokerUpdate);
  offMessage("poker:hand_result", handleHandResult);
  offMessage("room:error", handleRoomError);
  offMessage("reconnect:success", handleReconnectSuccess);
  offMessage("reconnect:failed", handleReconnectFailed);
});
</script>

<style scoped>
.table-page {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(
      85% 55% at 50% 30%,
      var(--felt-0) 0%,
      rgba(34, 112, 74, 0) 60%
    ),
    radial-gradient(130% 100% at 50% 0%, var(--bg-1) 0%, var(--bg-0) 62%);
}
.table-header {
  position: relative;
  z-index: 20;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 1.2rem;
  color: var(--text);
  font-size: var(--fs-sm);
  background: rgba(10, 28, 18, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--glass-border);
}
.table-header button {
  padding: 0.4rem 0.85rem;
  min-height: 44px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-out),
    background var(--dur-fast),
    border-color var(--dur-fast);
}
.table-header button:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(240, 199, 94, 0.4);
  transform: translateY(-1px);
}
.table-header button:active {
  transform: scale(0.96);
}
.room-no {
  color: var(--text-dim);
  letter-spacing: 0.06em;
}
.start-btn {
  background: linear-gradient(
    160deg,
    var(--gold),
    var(--gold-strong)
  ) !important;
  color: #1c1304 !important;
  font-weight: 600;
  border-color: transparent !important;
}
.start-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
}
.add-ai-btn {
  background: linear-gradient(160deg, #4a90d9, #8b5cf6) !important;
  color: #fff !important;
  font-weight: 600;
  border-color: transparent !important;
}
.add-ai-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.start-hint {
  text-align: center;
  color: var(--gold-soft);
  font-size: var(--fs-xs);
  padding: 0.35rem 1rem;
  background: rgba(0, 0, 0, 0.25);
}
.pause-hint {
  text-align: center;
  color: var(--text);
  font-size: var(--fs-xs);
  padding: 0.35rem 1rem;
  background: rgba(240, 199, 94, 0.18);
  border-bottom: 1px solid rgba(240, 199, 94, 0.3);
}
.spectate-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.4rem 1rem;
  font-size: var(--fs-xs);
  background: rgba(74, 144, 217, 0.18);
  border-bottom: 1px solid rgba(74, 144, 217, 0.35);
  color: var(--text);
}
.spectate-badge {
  padding: 0.15rem 0.6rem;
  border-radius: var(--radius-pill);
  background: rgba(74, 144, 217, 0.35);
  color: #cfe6ff;
  font-weight: 600;
}
.spectate-hint {
  color: var(--text-dim);
}
.spectate-leave {
  padding: 0.25rem 0.7rem;
  min-height: 32px;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition:
    color var(--dur-fast),
    border-color var(--dur-fast);
}
.spectate-leave:hover {
  color: var(--text);
  border-color: var(--gold);
}
.spectator-list {
  text-align: center;
  color: var(--text-faint);
  font-size: var(--fs-xs);
  padding: 0.25rem 1rem 0;
  margin: 0;
}
.table-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  padding-bottom: 110px;
}
@media (max-width: 768px) {
  .table-main {
    padding-bottom: 100px;
  }
  .table-header {
    padding: 0.55rem 0.75rem;
    gap: 0.5rem;
  }
  .table-header button {
    padding: 0.35rem 0.6rem;
    min-height: 44px;
    font-size: var(--fs-sm);
  }
  .room-no {
    font-size: var(--fs-xs);
  }
  .header-right {
    gap: 0.35rem;
  }
  .hand-result-banner {
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
  }
  .winner-name,
  .winner-amount {
    font-size: var(--fs-md);
  }
  .winner-hand {
    font-size: var(--fs-xs);
  }
  .reveal-btn {
    min-height: 40px;
    padding: 0.3rem 0.8rem;
  }
}
.hand-result-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-banner);
  background: linear-gradient(
    180deg,
    rgba(10, 26, 17, 0.94),
    rgba(10, 26, 17, 0.88)
  );
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(240, 199, 94, 0.3);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  color: var(--text);
  padding: 0.55rem 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  flex-wrap: wrap;
  overflow: hidden;
  animation: banner-drop 0.5s var(--ease-spring) both;
}
.hand-result-banner::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 55%;
  background: linear-gradient(
    105deg,
    transparent,
    rgba(255, 255, 255, 0.1),
    transparent
  );
  animation: banner-shine 2.6s ease-in-out infinite;
  pointer-events: none;
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
@keyframes banner-shine {
  0% {
    left: -60%;
  }
  60%,
  100% {
    left: 115%;
  }
}
.winner-block {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  position: relative;
}
.winner-name {
  font-size: 1.1rem;
  font-weight: bold;
  color: var(--gold);
}
.winner-hand {
  font-size: var(--fs-sm);
  color: var(--gold-soft);
}
.winner-amount {
  font-size: 1.1rem;
  color: var(--success);
  font-weight: bold;
}
.reveal-btn {
  padding: 0.35rem 0.95rem;
  min-height: 44px;
  background: linear-gradient(160deg, var(--gold), var(--gold-strong));
  color: #1c1304;
  font-weight: 600;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.reveal-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-glow-gold);
}
.reveal-btn:active {
  transform: scale(0.96);
}
.error-toast {
  position: fixed;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(160deg, var(--danger), #a93226);
  color: var(--text);
  padding: 0.6rem 1.2rem;
  border-radius: var(--radius-md);
  z-index: var(--z-toast);
  font-size: var(--fs-sm);
  box-shadow: var(--shadow-md);
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
.reconnect-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-reconnect);
  background: linear-gradient(160deg, var(--gold), var(--gold-strong));
  color: #1c1304;
  text-align: center;
  padding: 0.5rem;
  font-size: var(--fs-sm);
  font-weight: 600;
  box-shadow: var(--shadow-md);
}
.reconnect-enter-active,
.reconnect-leave-active {
  transition: transform var(--dur-base) var(--ease-out);
}
.reconnect-enter-from,
.reconnect-leave-to {
  transform: translateY(-100%);
}
</style>
