<template>
  <div
    class="player-seat"
    :class="{
      occupied: seat.userId,
      folded: seat.folded,
      current: isCurrent,
      'is-me': isMe,
      winner: isWinner,
    }"
  >
    <template v-if="seat.userId">
      <div class="cards-row">
        <Card v-for="(card, i) in seat.cards" :key="i" :card="card" :visible="true" />
      </div>
      <div class="avatar-wrap">
        <div class="avatar" :style="avatarStyle">{{ seat.username?.charAt(0).toUpperCase() }}</div>
        <span v-if="seat.isDealer" class="dealer-btn">D</span>
      </div>
      <div class="seat-info">
        <span class="seat-name">
          {{ seat.username }}
          <span v-if="isHost" class="host-badge">房主</span>
          <span v-if="isMe" class="me-badge">我</span>
        </span>
        <span class="seat-chips">{{ seat.chips }}</span>
      </div>
      <div v-if="seat.bet > 0" class="seat-bet">{{ seat.bet }}</div>
      <div v-if="!seat.confirmed" class="unconfirmed-badge">待确认</div>
      <div v-if="seat.folded" class="fold-badge">弃牌</div>
      <div v-if="seat.allIn" class="allin-badge">ALL IN</div>
      <div v-if="!seat.connected" class="dc-badge">断线</div>
    </template>
    <template v-else>
      <div class="avatar empty">空</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Card from "./Card.vue";

interface SeatView {
  index: number;
  userId: string | null;
  username: string | null;
  chips: number;
  buyIn: number;
  connected: boolean;
  confirmed: boolean;
  bet: number;
  folded: boolean;
  allIn: boolean;
  isDealer: boolean;
  cards: { rank: string; suit: string }[];
}

const props = defineProps<{
  seat: SeatView;
  isHost: boolean;
  isMe: boolean;
  isCurrent: boolean;
  isWinner: boolean;
}>();

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #e05252, #7f2b2b)",
  "linear-gradient(135deg, #4a90d9, #2a5a8c)",
  "linear-gradient(135deg, #8b5cf6, #4c2a8a)",
  "linear-gradient(135deg, #2a9d8f, #15625a)",
  "linear-gradient(135deg, #f0c75e, #a87a1e)",
  "linear-gradient(135deg, #e76f51, #8c3a26)",
];

const avatarStyle = computed(() => {
  const name = props.seat.username ?? "";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return {
    background: AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length],
  };
});
</script>

<style scoped>
.player-seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 74px;
  position: relative;
}
.cards-row {
  display: flex;
  gap: 3px;
  min-height: 56px;
}
.avatar-wrap {
  position: relative;
}
.avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--felt-0), var(--felt-1));
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.05rem;
  border: 2px solid rgba(255, 255, 255, 0.25);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  transition: border-color var(--dur-fast);
}
.current .avatar {
  border-color: var(--gold);
  animation: current-avatar-pulse 1.6s var(--ease-out) infinite;
}
@keyframes current-avatar-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px rgba(240, 199, 94, 0.2);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(240, 199, 94, 0.5);
  }
}
.winner .avatar {
  border-color: var(--gold);
  background: linear-gradient(135deg, var(--gold), var(--gold-strong)) !important;
  animation: winner-avatar-pulse 1.1s ease-in-out infinite;
}
@keyframes winner-avatar-pulse {
  0%,
  100% {
    box-shadow: 0 0 6px rgba(240, 199, 94, 0.55);
  }
  50% {
    box-shadow: 0 0 18px rgba(240, 199, 94, 1);
  }
}
.winner :deep(.card-front) {
  animation: winner-card-pulse 1.1s ease-in-out infinite;
}
@keyframes winner-card-pulse {
  0%,
  100% {
    box-shadow: 0 0 6px rgba(240, 199, 94, 0.45);
    outline: 2px solid rgba(240, 199, 94, 0.55);
    outline-offset: 1px;
  }
  50% {
    box-shadow: 0 0 14px rgba(240, 199, 94, 0.95);
    outline: 2px solid var(--gold);
    outline-offset: 1px;
  }
}
.is-me .avatar {
  border-color: var(--info);
}
.avatar.empty {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-faint);
  font-size: var(--fs-sm);
  border: 2px dashed var(--glass-border);
  box-shadow: none;
}
.dealer-btn {
  position: absolute;
  top: -5px;
  right: -7px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 40%, #fff, #e8e8e8);
  color: #333;
  font-size: 0.65rem;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #bbb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.seat-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: var(--fs-xs);
  color: var(--text);
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-pill);
  padding: 0.18rem 0.55rem;
  max-width: 96px;
}
.seat-name {
  display: flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.host-badge {
  background: var(--gold);
  color: #333;
  font-size: 0.55rem;
  padding: 0 3px;
  border-radius: 3px;
  flex-shrink: 0;
}
.me-badge {
  background: var(--info);
  color: var(--text);
  font-size: 0.55rem;
  padding: 0 3px;
  border-radius: 3px;
  flex-shrink: 0;
}
.seat-chips {
  color: var(--gold);
  font-weight: bold;
}
.seat-bet {
  background: rgba(0, 0, 0, 0.65);
  border: 1px solid rgba(240, 199, 94, 0.45);
  color: var(--gold);
  font-size: 0.65rem;
  font-weight: bold;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.fold-badge,
.allin-badge,
.dc-badge,
.unconfirmed-badge {
  font-size: 0.6rem;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  color: var(--text);
}
.fold-badge {
  background: rgba(160, 174, 192, 0.35);
}
.unconfirmed-badge {
  background: rgba(160, 174, 192, 0.25);
}
.allin-badge {
  background: var(--allin);
}
.dc-badge {
  background: var(--danger);
}
.folded {
  opacity: 0.45;
}

@media (max-width: 768px) {
  .player-seat {
    min-width: 54px;
    gap: 2px;
  }
  .cards-row {
    min-height: 44px;
    gap: 1px;
  }
  .avatar {
    width: 30px;
    height: 30px;
    font-size: 0.8rem;
    border-width: 1.5px;
  }
  .dealer-btn {
    width: 14px;
    height: 14px;
    font-size: 0.55rem;
    top: -4px;
    right: -5px;
  }
  .seat-info {
    font-size: 0.55rem;
    padding: 0.1rem 0.4rem;
  }
  .host-badge,
  .me-badge {
    font-size: 0.45rem;
    padding: 0 2px;
  }
  .seat-chips {
    font-size: 0.6rem;
  }
  .seat-bet {
    font-size: 0.55rem;
    padding: 0 5px;
  }
  .fold-badge,
  .allin-badge,
  .dc-badge,
  .unconfirmed-badge {
    font-size: 0.5rem;
    padding: 0 3px;
  }
}
</style>
