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
      <span v-if="myPendingReservation" class="spectate-hint">
        已预约 {{ myPendingReservation.seatIndex + 1 }} 号座位，本手结束后入座
      </span>
      <span v-else-if="canSitFromSpectate" class="spectate-hint">
        点击空座位即可入座
      </span>
      <span
        v-else-if="game.room?.status === 'playing' && !isRoomFull"
        class="spectate-hint"
      >
        点击空座预约下一手入座
      </span>
      <span v-else-if="game.room?.status === 'playing'" class="spectate-hint">
        当前没有可预约的空座
      </span>
      <span v-else class="spectate-hint">本手牌结束后可入座</span>
      <button
        v-if="myPendingReservation"
        class="spectate-cancel"
        :disabled="queueCancelling"
        @click="cancelQueueJoin"
      >
        {{ queueCancelling ? "取消中..." : "取消预约" }}
      </button>
      <button class="spectate-leave" @click="leaveRoom">退出观战</button>
    </div>

    <SpectatorList
      :spectators="game.room?.spectators ?? []"
      :my-user-id="game.myUserId"
    />

    <div class="table-body">
      <main class="table-main">
        <PokerTable
          :room="game.room"
          :poker-state="game.pokerState"
          :my-user-id="game.myUserId"
          :hand-result="game.handResult"
          :is-viewer-host="isHost"
          @sit="handleSitDown"
          @remove-ai="removeAi"
          @show-profile="(uid) => (profileUserId = uid)"
        />
      </main>

      <div
        class="chat-container"
        :class="{ open: chatOpen, 'has-new': chatStore.unreadCount > 0 }"
      >
        <div class="chat-drawer-header">
          <span>房间聊天</span>
          <button class="chat-close" @click="chatOpen = false">收起</button>
        </div>
        <ChatPanel
          class="chat-panel-slot"
          :my-user-id="game.myUserId"
          @send="sendChat"
        />
      </div>
    </div>

    <button
      class="chat-toggle"
      type="button"
      :aria-expanded="chatOpen"
      @click="toggleChat"
    >
      聊天
      <span v-if="chatStore.unreadCount > 0" class="chat-badge">{{
        unreadLabel
      }}</span>
    </button>

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

    <ConfirmBuyIn
      v-if="showQueueBuyIn"
      :min-buy-in="game.room!.minBuyIn"
      :max-buy-in="game.room!.maxBuyIn"
      title="预约下一手带入"
      submit-label="确认预约"
      @confirm="queueJoin"
    />

    <Transition name="modal">
      <AiPickerModal
        v-if="showAiPicker"
        :options="game.aiOptions"
        @close="showAiPicker = false"
        @select="selectAi"
      />
    </Transition>

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

    <Transition name="modal">
      <PlayerProfileModal
        v-if="profileUserId && profileSeat"
        :username="profileSeat.username ?? profileUserId"
        :is-ai="!!profileSeat.isAi"
        :profile="profileView"
        @close="profileUserId = null"
      />
    </Transition>

    <div v-if="game.handResult" class="hand-result-banner">
      <div class="banner-main">
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
        <div
          v-for="r in game.handResult.refunds ?? []"
          :key="'refund-' + r.userId"
          class="refund-block"
        >
          <span class="refund-name">{{ winnerName(r.userId) }}</span>
          <span class="refund-text">收回未跟注筹码</span>
          <span class="refund-amount">+{{ r.amount }}</span>
        </div>
      </div>
      <div v-if="showdownComparison.length" class="banner-comparison">
        <span
          v-for="c in showdownComparison"
          :key="c.userId"
          class="comparison-item"
          :class="{ 'is-winner': c.isWinner }"
        >
          {{ c.name }}：{{ c.handName }}
        </span>
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
import { useChatStore } from "../stores/chat";
import { useProfilesStore } from "../stores/profiles";
import { useWebSocket } from "../composables/useWebSocket";
import { VOICE_ENABLED } from "../utils/featureFlags";
import PokerTable from "../components/table/PokerTable.vue";
import ActionBar from "../components/table/ActionBar.vue";
import VoicePanel from "../components/voice/VoicePanel.vue";
import ConfirmBuyIn from "../components/table/ConfirmBuyIn.vue";
import RoomSettingsModal from "../components/table/RoomSettingsModal.vue";
import TransferHostModal from "../components/table/TransferHostModal.vue";
import PlayerProfileModal from "../components/table/PlayerProfileModal.vue";
import AiPickerModal from "../components/table/AiPickerModal.vue";
import SpectatorList from "../components/table/SpectatorList.vue";
import ChatPanel from "../components/chat/ChatPanel.vue";
import type { ChatMessage } from "../types/protocol";
import type { ProfileView } from "../stores/profiles";
import type {
  AiAccountOption,
  RoomDetail,
  PokerState,
  ActionOption,
  HandResultInfo,
} from "../stores/game";

const auth = useAuthStore();
const game = useGameStore();
const chatStore = useChatStore();
const profilesStore = useProfilesStore();
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
const showAiPicker = ref(false);
const profileUserId = ref<string | null>(null);
const profileSeat = computed(() =>
  game.room?.seats.find((s) => s.userId === profileUserId.value),
);
const profileView = computed(
  () =>
    (profileUserId.value && profilesStore.profiles[profileUserId.value]) ||
    null,
);
const errorMsg = ref("");
const chatOpen = ref(false);
let chatHighlightTimer: ReturnType<typeof setTimeout> | null = null;
const unreadLabel = computed(() =>
  chatStore.unreadCount > 99 ? "99+" : String(chatStore.unreadCount),
);
const revealedMine = ref(false);
const selectedSeatForQueue = ref<number | null>(null);
const queueSubmitting = ref(false);
const queueCancelling = ref(false);
let errorTimer: ReturnType<typeof setTimeout> | null = null;
let handResultTimer: ReturnType<typeof setTimeout> | null = null;

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
const canStart = computed(() => (game.room?.confirmedCount ?? 0) >= 2);
const isRoomFull = computed(
  () =>
    !!game.room &&
    game.room.playerCount + (game.room.pendingSeatReservationCount ?? 0) >=
      game.room.maxPlayers,
);
const canSitFromSpectate = computed(
  () =>
    game.room?.status === "waiting" &&
    !isRoomFull.value &&
    !game.myPendingSeatReservation,
);
const myPendingReservation = computed(() => game.myPendingSeatReservation);
const showQueueBuyIn = computed(
  () =>
    selectedSeatForQueue.value !== null &&
    isSpectator.value &&
    game.room?.status === "playing" &&
    !myPendingReservation.value &&
    !queueSubmitting.value,
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
  const p = payload as {
    room: RoomDetail | null;
    reason?: string;
    profiles?: ProfileView[];
    aiOptions?: AiAccountOption[];
  };
  if (p.room) {
    // Chat is real-time only: switching rooms starts a fresh transcript.
    if (game.room?.id != null && game.room.id !== p.room.id) {
      chatStore.clearMessages();
      profilesStore.clearProfiles();
    }
    game.setRoom(p.room);
    game.setAiOptions(p.aiOptions ?? []);
    if (p.profiles) profilesStore.applyProfiles(p.profiles);
  } else {
    chatStore.clearMessages();
    profilesStore.clearProfiles();
    game.setRoom(null);
    router.push("/lobby");
  }
}

function handleProfileUpdate(payload: unknown) {
  const p = payload as { profiles?: ProfileView[] };
  profilesStore.applyProfiles(p.profiles);
}

function handleChatMessage(payload: unknown) {
  const p = payload as { message?: ChatMessage };
  if (!p.message) return;
  const fromSelf = p.message.userId === game.myUserId;
  // When the mobile drawer is open the transcript is already visible, so new
  // messages must not bump the unread badge.
  chatStore.appendMessage(p.message, { unread: !fromSelf && !chatOpen.value });
  if (!fromSelf) {
    // Desktop highlight auto-clears 5s after the latest incoming message;
    // it is also cleared by focusing the chat input (ChatPanel).
    if (chatHighlightTimer) clearTimeout(chatHighlightTimer);
    chatHighlightTimer = setTimeout(() => {
      chatHighlightTimer = null;
      chatStore.markRead();
    }, 5000);
  }
}

function toggleChat() {
  chatOpen.value = !chatOpen.value;
  if (chatOpen.value) {
    chatStore.markRead();
  }
}

function sendChat(text: string) {
  chatStore.clearError();
  send("room:chat:send", { text });
}

function handlePokerUpdate(payload: unknown) {
  const p = payload as { state: PokerState; availableActions: ActionOption[] };
  game.setPokerState(p.state, p.availableActions);
  // Only clear the winner banner when a new hand begins (preflop). The engine
  // re-broadcasts a "settled" state right after showdown, which must not wipe
  // the result display.
  if (p.state.phase === "preflop") {
    if (handResultTimer) {
      clearTimeout(handResultTimer);
      handResultTimer = null;
    }
    game.setHandResult(null);
    revealedMine.value = false;
  }
}

function handleHandResult(payload: unknown) {
  const result = payload as HandResultInfo;
  game.setHandResult(result);
  if (handResultTimer) clearTimeout(handResultTimer);
  handResultTimer = setTimeout(() => {
    handResultTimer = null;
    game.setHandResult(null);
  }, result.displayMs ?? 5000);
}

function handleRoomError(payload: unknown) {
  const p = payload as { code?: string; message?: string };
  queueSubmitting.value = false;
  queueCancelling.value = false;
  if (p.code === "CHAT_EMPTY" || p.code === "CHAT_TOO_LONG") {
    chatStore.setError(p.message || "发送失败");
    return;
  }
  showError(p.message || "操作失败");
}

function winnerName(userId: string): string {
  const player = game.pokerState?.players.find((p) => p.userId === userId);
  return player?.username || userId;
}

const showdownComparison = computed(() => {
  const r = game.handResult;
  if (!r || r.reason !== "showdown") return [];
  const winnerIds = new Set(r.winners.map((w) => w.userId));
  return Object.entries(r.handNames).map(([userId, handName]) => ({
    userId,
    name: winnerName(userId),
    handName,
    isWinner: winnerIds.has(userId),
  }));
});

function handleAction(type: string, amount?: number) {
  send("poker:action", { action: type, amount });
}

function confirmBuyIn(amount: number) {
  send("room:confirm", { buyIn: amount });
}

function queueJoin(amount: number) {
  const seatIndex = selectedSeatForQueue.value;
  if (seatIndex === null || !game.room) return;
  queueSubmitting.value = true;
  send("room:queue-join", {
    roomId: game.room.id,
    seatIndex,
    buyIn: amount,
  });
}

function cancelQueueJoin() {
  if (!myPendingReservation.value) return;
  queueCancelling.value = true;
  send("room:cancel-queue-join", {});
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
    if (game.room.status === "playing") {
      selectedSeatForQueue.value = seatIndex;
      return;
    }
    send("room:join", { roomId: game.room.id, seatIndex });
  } else {
    send("room:move-seat", { seatIndex });
  }
}

function leaveRoom() {
  send("room:leave", {});
  chatStore.clearMessages();
  profilesStore.clearProfiles();
  game.setRoom(null);
  router.push("/lobby");
}

function startGame() {
  send("room:start", {});
}

function addAi() {
  showAiPicker.value = true;
}

function selectAi(aiUsername: string) {
  showAiPicker.value = false;
  send("ai:add", { aiUsername });
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

function handleQueueJoinAccepted() {
  queueSubmitting.value = false;
  selectedSeatForQueue.value = null;
}

function handleQueueJoinCancelled() {
  queueCancelling.value = false;
  selectedSeatForQueue.value = null;
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
  onMessage("room:chat:message", handleChatMessage);
  onMessage("ai:profile:update", handleProfileUpdate);
  onMessage("reconnect:success", handleReconnectSuccess);
  onMessage("reconnect:failed", handleReconnectFailed);
  onMessage("room:queue-join:accepted", handleQueueJoinAccepted);
  onMessage("room:queue-join:cancelled", handleQueueJoinCancelled);
  // The global onopen already requests a snapshot; if the socket was open
  // before this view mounted, request it here so the state is never stale.
  if (isOpen()) {
    send("reconnect", {});
  }
});

onUnmounted(() => {
  if (errorTimer) clearTimeout(errorTimer);
  if (chatHighlightTimer) clearTimeout(chatHighlightTimer);
  offMessage("room:state", handleRoomState);
  offMessage("poker:update", handlePokerUpdate);
  offMessage("poker:hand_result", handleHandResult);
  offMessage("room:error", handleRoomError);
  offMessage("room:chat:message", handleChatMessage);
  offMessage("ai:profile:update", handleProfileUpdate);
  offMessage("reconnect:success", handleReconnectSuccess);
  offMessage("reconnect:failed", handleReconnectFailed);
  offMessage("room:queue-join:accepted", handleQueueJoinAccepted);
  offMessage("room:queue-join:cancelled", handleQueueJoinCancelled);
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
.spectate-cancel {
  padding: 0.25rem 0.7rem;
  min-height: 32px;
  background: rgba(240, 199, 94, 0.12);
  color: var(--gold-soft);
  border: 1px solid rgba(240, 199, 94, 0.35);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.spectate-cancel:disabled {
  opacity: 0.55;
  cursor: wait;
}
.table-body {
  flex: 1;
  display: flex;
  align-items: stretch;
  min-height: 0;
}
.chat-container {
  position: fixed;
  right: 0.9rem;
  bottom: calc(112px + env(safe-area-inset-bottom, 0px));
  width: 300px;
  height: min(420px, calc(100dvh - 15rem));
  min-height: 220px;
  z-index: var(--z-chat);
  display: flex;
  flex-direction: column;
}
.chat-container.has-new :deep(.chat-panel) {
  border-color: var(--gold);
  box-shadow:
    0 0 0 2px rgba(240, 199, 94, 0.35),
    0 0 18px rgba(240, 199, 94, 0.3);
}
.chat-panel-slot {
  flex: 1;
  min-height: 0;
}
.chat-drawer-header {
  display: none;
}
.chat-toggle {
  display: none;
}
.chat-badge {
  position: absolute;
  top: -0.4rem;
  right: -0.4rem;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.3rem;
  border-radius: var(--radius-pill);
  background: var(--danger);
  color: #fff;
  font-size: var(--fs-xs);
  font-weight: 700;
  line-height: 1.25rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
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
    padding-bottom: 120px;
  }
  .chat-container {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    height: 50dvh;
    max-height: 50dvh;
    min-height: 0;
    margin: 0;
    z-index: var(--z-chat);
    display: none;
    border-radius: 0;
    background: rgba(10, 28, 18, 0.96);
    border: none;
    border-top: 1px solid var(--glass-border);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .chat-container.open {
    display: flex;
  }
  .chat-container :deep(.chat-panel) {
    border: none;
    border-radius: 0;
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  .chat-drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.45rem 0.75rem;
    color: var(--text);
    font-size: var(--fs-sm);
    border-bottom: 1px solid var(--glass-border);
  }
  .chat-close {
    padding: 0.3rem 0.8rem;
    min-height: 36px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--text);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-pill);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .chat-toggle {
    display: block;
    position: fixed;
    right: 0.9rem;
    bottom: calc(96px + env(safe-area-inset-bottom));
    z-index: var(--z-chat);
    padding: 0.55rem 1rem;
    min-height: 44px;
    background: linear-gradient(160deg, var(--gold), var(--gold-strong));
    color: #1c1304;
    font-weight: 600;
    font-size: var(--fs-sm);
    border: none;
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-md);
    cursor: pointer;
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
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
.banner-main {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1.5rem;
  flex-wrap: wrap;
  position: relative;
}
.refund-block {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}
.refund-name {
  font-size: var(--fs-sm);
  color: var(--text-dim);
  font-weight: 600;
}
.refund-text {
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.refund-amount {
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.banner-comparison {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: var(--fs-sm);
}
.comparison-item {
  color: var(--text-dim);
}
.comparison-item.is-winner {
  color: var(--gold);
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
