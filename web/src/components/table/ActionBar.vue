<template>
  <div class="action-bar" v-if="actions.length > 0">
    <div v-if="!showRaisePanel" class="actions">
      <button
        v-if="foldAction"
        class="action-btn btn-fold"
        @click="handleAction(foldAction)"
      >
        弃牌
      </button>
      <button
        v-if="callAction"
        class="action-btn btn-call"
        @click="handleAction(callAction)"
      >
        {{ callAction.type === "check" ? "过牌" : `跟注 (${callAction.amount})` }}
      </button>
      <button
        v-if="raiseAction"
        class="action-btn btn-raise"
        @click="openRaisePanel"
      >
        加注
      </button>
      <button
        v-if="!raiseAction && allInAction"
        class="action-btn btn-allin"
        @click="handleAction(allInAction)"
      >
        全下 ({{ allInAction.amount }})
      </button>
    </div>

    <Transition name="raise-panel">
      <div v-if="showRaisePanel" class="raise-panel">
        <div class="actions">
          <button class="action-btn btn-cancel" @click="closeRaisePanel">取消</button>
          <button
            v-if="showThirdPot"
            class="action-btn btn-raise"
            :class="{ selected: selected === 'third' }"
            @click="selectQuick('third')"
          >
            1/3 ({{ thirdCommit }})
          </button>
          <button
            v-if="showHalfPot"
            class="action-btn btn-raise"
            :class="{ selected: selected === 'half' }"
            @click="selectQuick('half')"
          >
            1/2 ({{ halfCommit }})
          </button>
          <button
            v-if="showAllInQuick"
            class="action-btn btn-allin"
            :class="{ selected: selected === 'allin' }"
            @click="selectQuick('allin')"
          >
            全下 ({{ chips }})
          </button>
        </div>
        <div class="raise-control">
          <input
            type="range"
            :min="raiseMin"
            :max="raiseMax"
            v-model.number="raiseAmount"
            @input="selected = 'manual'"
          />
          <span class="raise-value">{{ raiseAmount }}</span>
          <button class="action-btn btn-raise" @click="confirmBet">
            下注 ({{ raiseAmount }})
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { PokerState } from "../../stores/game";
import { quickCommit, canQuickBet } from "../../utils/quickBet";

interface ActionOption {
  type: string;
  amount?: number;
  min?: number;
  max?: number;
}

type QuickSelection = "third" | "half" | "allin" | "manual";

const props = defineProps<{
  actions: ActionOption[];
  pokerState: PokerState | null;
  myUserId: string | null;
}>();
const emit = defineEmits<{ action: [type: string, amount?: number] }>();

const showRaisePanel = ref(false);
const raiseAmount = ref(0);
const selected = ref<QuickSelection>("manual");

const me = computed(
  () => props.pokerState?.players.find((p) => p.userId === props.myUserId) ?? null,
);
const chips = computed(() => me.value?.chips ?? 0);
const playerBet = computed(() => me.value?.bet ?? 0);
const pot = computed(() => props.pokerState?.pot ?? 0);
const bigBlind = computed(() => props.pokerState?.bigBlind ?? 0);
const currentBet = computed(() => props.pokerState?.currentBet ?? 0);
const minRaise = computed(() => props.pokerState?.minRaise ?? 0);

const foldAction = computed(() => props.actions.find((a) => a.type === "fold"));
const callAction = computed(() =>
  props.actions.find((a) => a.type === "call" || a.type === "check"),
);
const raiseAction = computed(() => props.actions.find((a) => a.type === "raise"));
const allInAction = computed(() => props.actions.find((a) => a.type === "allin"));
const raiseMin = computed(() => raiseAction.value?.min || 0);
const raiseMax = computed(() => raiseAction.value?.max || 0);

const betContext = computed(() => ({
  pot: pot.value,
  bigBlind: bigBlind.value,
  chips: chips.value,
  playerBet: playerBet.value,
  currentBet: currentBet.value,
  minRaise: minRaise.value,
}));

const thirdCommit = computed(() => quickCommit(betContext.value, 1 / 3));
const halfCommit = computed(() => quickCommit(betContext.value, 1 / 2));
const showThirdPot = computed(() => canQuickBet(betContext.value, 1 / 3));
const showHalfPot = computed(() => canQuickBet(betContext.value, 1 / 2));
const showAllInQuick = computed(
  () => !!raiseAction.value && !!allInAction.value && chips.value > 0,
);

function openRaisePanel() {
  raiseAmount.value = raiseMin.value;
  selected.value = "manual";
  showRaisePanel.value = true;
}

function closeRaisePanel() {
  showRaisePanel.value = false;
}

function selectQuick(kind: Exclude<QuickSelection, "manual">) {
  selected.value = kind;
  if (kind === "allin") {
    raiseAmount.value = chips.value;
  } else if (kind === "third") {
    raiseAmount.value = thirdCommit.value;
  } else {
    raiseAmount.value = halfCommit.value;
  }
}

function confirmBet() {
  if (selected.value === "allin") {
    emit("action", "allin", chips.value);
  } else {
    emit("action", "raise", raiseAmount.value);
  }
  showRaisePanel.value = false;
}

function handleAction(action: ActionOption) {
  emit("action", action.type, action.amount);
}
</script>

<style scoped>
.action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: var(--z-actionbar);
  background: rgba(8, 20, 14, 0.88);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-top: 1px solid var(--glass-border);
  box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.35);
  padding: 0.85rem 1rem;
  padding-bottom: calc(0.85rem + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.actions {
  display: flex;
  gap: 0.55rem;
  justify-content: center;
  flex-wrap: wrap;
}
.action-btn {
  padding: 0.7rem 1.35rem;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  font-weight: 600;
  cursor: pointer;
  min-height: 44px;
  color: var(--text);
  box-shadow: var(--shadow-sm);
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    filter var(--dur-fast) var(--ease-out);
}
.action-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.08);
}
.action-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.96);
}
.action-btn.selected {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
  box-shadow: var(--shadow-glow-gold);
}
.btn-fold { background: linear-gradient(160deg, #e05252, #b23a3a); }
.btn-check,
.btn-cancel { background: linear-gradient(160deg, #5a6572, #434c56); }
.btn-call { background: linear-gradient(160deg, var(--info), #2f6aa8); }
.btn-raise { background: linear-gradient(160deg, var(--gold), var(--gold-strong)); color: #1c1304; }
.btn-allin { background: linear-gradient(160deg, var(--allin), #6d3fce); }
.raise-panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.raise-panel-enter-active,
.raise-panel-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.raise-panel-enter-from,
.raise-panel-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
.raise-control {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  justify-content: center;
}
.raise-control input {
  flex: 1;
  max-width: 220px;
}
.raise-value {
  color: var(--gold);
  font-weight: bold;
  min-width: 52px;
  text-align: center;
  font-size: var(--fs-md);
}
</style>
