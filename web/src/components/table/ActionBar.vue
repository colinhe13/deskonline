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
        {{
          callAction.type === "check" ? "过牌" : `跟注 (${callAction.amount})`
        }}
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
          <button class="action-btn btn-cancel" @click="closeRaisePanel">
            取消
          </button>
          <template v-if="isPreflop">
            <button
              v-if="showMinRaise"
              class="action-btn btn-raise"
              :class="{ selected: selected === 'minRaise' }"
              @click="selectQuick('minRaise')"
            >
              最小加注 ({{ minRaiseCommit }})
            </button>
            <button
              v-if="showTwoPointFiveBb"
              class="action-btn btn-raise"
              :class="{ selected: selected === 'twoPointFiveBb' }"
              @click="selectQuick('twoPointFiveBb')"
            >
              2.5BB ({{ twoPointFiveBbCommit }})
            </button>
            <button
              v-if="showThreeBb"
              class="action-btn btn-raise"
              :class="{ selected: selected === 'threeBb' }"
              @click="selectQuick('threeBb')"
            >
              3BB ({{ threeBbCommit }})
            </button>
            <button
              v-if="showFourBb"
              class="action-btn btn-raise"
              :class="{ selected: selected === 'fourBb' }"
              @click="selectQuick('fourBb')"
            >
              4BB ({{ fourBbCommit }})
            </button>
          </template>
          <template v-else>
            <button
              v-if="showThirdPot"
              class="action-btn btn-raise"
              :class="{ selected: selected === 'third' }"
              @click="selectQuick('third')"
            >
              1/3池 ({{ thirdCommit }})
            </button>
            <button
              v-if="showHalfPot"
              class="action-btn btn-raise"
              :class="{ selected: selected === 'half' }"
              @click="selectQuick('half')"
            >
              1/2池 ({{ halfCommit }})
            </button>
            <button
              v-if="showTwoThirdsPot"
              class="action-btn btn-raise"
              :class="{ selected: selected === 'twoThirds' }"
              @click="selectQuick('twoThirds')"
            >
              2/3池 ({{ twoThirdsCommit }})
            </button>
            <button
              v-if="showPotSize"
              class="action-btn btn-raise"
              :class="{ selected: selected === 'pot' }"
              @click="selectQuick('pot')"
            >
              满池 ({{ potCommit }})
            </button>
          </template>
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
            type="number"
            :min="raiseMin"
            :max="raiseMax"
            step="1"
            inputmode="numeric"
            aria-label="下注金额"
            :value="inputValue"
            @input="handleManualInput"
          />
          <button
            class="action-btn btn-raise"
            :disabled="!canConfirmBet"
            @click="confirmBet"
          >
            确认加注 ({{ confirmAmountLabel }})
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { PokerState } from "../../stores/game";
import {
  quickCommit,
  canQuickBet,
  targetCommit,
  bbTarget,
  canTargetBet,
  parseIntegerAmount,
} from "../../utils/quickBet";

interface ActionOption {
  type: string;
  amount?: number;
  min?: number;
  max?: number;
}

type QuickFraction = "third" | "half" | "twoThirds" | "pot";
type PreflopQuick = "minRaise" | "twoPointFiveBb" | "threeBb" | "fourBb";
type QuickPreset = QuickFraction | PreflopQuick;
type QuickSelection = QuickPreset | "allin" | "manual";

const props = defineProps<{
  actions: ActionOption[];
  pokerState: PokerState | null;
  myUserId: string | null;
}>();
const emit = defineEmits<{ action: [type: string, amount?: number] }>();

const showRaisePanel = ref(false);
const raiseAmount = ref("");
const selected = ref<QuickSelection>("manual");

const me = computed(
  () =>
    props.pokerState?.players.find((p) => p.userId === props.myUserId) ?? null,
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
const raiseAction = computed(() =>
  props.actions.find((a) => a.type === "raise"),
);
const allInAction = computed(() =>
  props.actions.find((a) => a.type === "allin"),
);
const raiseMin = computed(() => raiseAction.value?.min || 0);
const raiseMax = computed(() => raiseAction.value?.max || 0);
const isPreflop = computed(() => props.pokerState?.phase === "preflop");

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
const twoThirdsCommit = computed(() => quickCommit(betContext.value, 2 / 3));
const potCommit = computed(() => quickCommit(betContext.value, 1));
const showThirdPot = computed(() => canQuickBet(betContext.value, 1 / 3));
const showHalfPot = computed(() => canQuickBet(betContext.value, 1 / 2));
const showTwoThirdsPot = computed(() => canQuickBet(betContext.value, 2 / 3));
const showPotSize = computed(() => canQuickBet(betContext.value, 1));
const minRaiseTarget = computed(() => currentBet.value + minRaise.value);
const minRaiseCommit = computed(() =>
  targetCommit(betContext.value, minRaiseTarget.value),
);
const twoPointFiveBbTarget = computed(() => bbTarget(bigBlind.value, 2.5));
const threeBbTarget = computed(() => bbTarget(bigBlind.value, 3));
const fourBbTarget = computed(() => bbTarget(bigBlind.value, 4));
const twoPointFiveBbCommit = computed(() =>
  targetCommit(betContext.value, twoPointFiveBbTarget.value),
);
const threeBbCommit = computed(() =>
  targetCommit(betContext.value, threeBbTarget.value),
);
const fourBbCommit = computed(() =>
  targetCommit(betContext.value, fourBbTarget.value),
);
const showMinRaise = computed(
  () =>
    !!raiseAction.value && canTargetBet(betContext.value, minRaiseTarget.value),
);
const showTwoPointFiveBb = computed(
  () =>
    !!raiseAction.value &&
    canTargetBet(betContext.value, twoPointFiveBbTarget.value),
);
const showThreeBb = computed(
  () =>
    !!raiseAction.value && canTargetBet(betContext.value, threeBbTarget.value),
);
const showFourBb = computed(
  () =>
    !!raiseAction.value && canTargetBet(betContext.value, fourBbTarget.value),
);
const showAllInQuick = computed(
  () => !!raiseAction.value && !!allInAction.value && chips.value > 0,
);

function presetCommit(kind: QuickPreset): number {
  switch (kind) {
    case "third":
      return thirdCommit.value;
    case "half":
      return halfCommit.value;
    case "twoThirds":
      return twoThirdsCommit.value;
    case "pot":
      return potCommit.value;
    case "minRaise":
      return minRaiseCommit.value;
    case "twoPointFiveBb":
      return twoPointFiveBbCommit.value;
    case "threeBb":
      return threeBbCommit.value;
    case "fourBb":
      return fourBbCommit.value;
  }
}

const selectedAmount = computed<number | null>(() => {
  if (selected.value === "allin") return chips.value;
  if (selected.value === "manual") return parseIntegerAmount(raiseAmount.value);
  return presetCommit(selected.value);
});

const inputValue = computed(() => {
  if (selected.value === "manual") return raiseAmount.value;
  const amount = selectedAmount.value;
  return amount === null ? "" : String(amount);
});

const confirmAmountLabel = computed(() => inputValue.value || "—");

const canConfirmBet = computed(() => {
  if (selected.value === "allin") {
    return !!allInAction.value && chips.value > 0;
  }
  const amount = selectedAmount.value;
  return (
    !!raiseAction.value &&
    amount !== null &&
    amount >= raiseMin.value &&
    amount <= raiseMax.value
  );
});

function openRaisePanel() {
  raiseAmount.value = String(raiseMin.value);
  selected.value = "manual";
  showRaisePanel.value = true;
}

function closeRaisePanel() {
  showRaisePanel.value = false;
}

function selectQuick(kind: Exclude<QuickSelection, "manual">) {
  selected.value = kind;
  if (kind === "allin") {
    raiseAmount.value = String(chips.value);
  } else {
    raiseAmount.value = String(presetCommit(kind));
  }
}

function handleManualInput(event: Event) {
  const target = event.target as HTMLInputElement;
  raiseAmount.value = target.value;
  selected.value = "manual";
}

function confirmBet() {
  if (!canConfirmBet.value) return;
  if (selected.value === "allin") {
    emit("action", "allin", chips.value);
  } else {
    const amount = selectedAmount.value;
    if (amount === null) return;
    emit("action", "raise", amount);
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
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: none;
}
.action-btn.selected {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
  box-shadow: var(--shadow-glow-gold);
}
.btn-fold {
  background: linear-gradient(160deg, #e05252, #b23a3a);
}
.btn-check,
.btn-cancel {
  background: linear-gradient(160deg, #5a6572, #434c56);
}
.btn-call {
  background: linear-gradient(160deg, var(--info), #2f6aa8);
}
.btn-raise {
  background: linear-gradient(160deg, var(--gold), var(--gold-strong));
  color: #1c1304;
}
.btn-allin {
  background: linear-gradient(160deg, var(--allin), #6d3fce);
}
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
  width: 120px;
  max-width: 220px;
  min-height: 44px;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.35);
  color: var(--text);
  text-align: center;
  font-size: var(--fs-md);
}
.raise-control input:focus {
  outline: none;
  border-color: var(--gold);
  box-shadow: var(--shadow-glow-gold);
}

@media (max-width: 480px) {
  .action-bar {
    padding: 0.85rem 0.75rem;
    padding-bottom: calc(0.85rem + env(safe-area-inset-bottom));
  }
  .actions {
    gap: 0.65rem;
  }
  .actions .action-btn {
    flex: 1 1 0;
    min-width: 0;
    padding: 0.8rem 0.4rem;
    min-height: 48px;
    font-size: var(--fs-md);
    white-space: nowrap;
  }
  .raise-panel .actions {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }
  .raise-control input {
    min-height: 48px;
    max-width: 180px;
  }
}
</style>
