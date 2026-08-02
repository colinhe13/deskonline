<template>
  <div
    class="player-seat"
    :class="{
      occupied: seat.userId,
      folded: seat.folded,
      current: isCurrent,
      'is-me': isMe,
    }"
  >
    <template v-if="seat.userId">
      <div class="cards-row">
        <Card v-for="(card, i) in seat.cards" :key="i" :card="card" :visible="true" />
      </div>
      <div class="avatar-wrap">
        <div class="avatar">{{ seat.username?.charAt(0).toUpperCase() }}</div>
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
import Card from "./Card.vue";

interface SeatView {
  index: number;
  userId: string | null;
  username: string | null;
  chips: number;
  connected: boolean;
  bet: number;
  folded: boolean;
  allIn: boolean;
  isDealer: boolean;
  cards: { rank: string; suit: string }[];
}

defineProps<{ seat: SeatView; isHost: boolean; isMe: boolean; isCurrent: boolean }>();
</script>

<style scoped>
.player-seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 70px;
  position: relative;
}
.cards-row {
  display: flex;
  gap: 2px;
  min-height: 44px;
}
.avatar-wrap {
  position: relative;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #1a472a;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1rem;
  border: 2px solid transparent;
}
.current .avatar {
  border-color: #ffd700;
  box-shadow: 0 0 10px rgba(255, 215, 0, 0.7);
}
.is-me .avatar {
  border-color: #63b3ed;
}
.avatar.empty {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
}
.dealer-btn {
  position: absolute;
  top: -4px;
  right: -6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  color: #1a472a;
  font-size: 0.6rem;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #ccc;
}
.seat-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.7rem;
  color: #fff;
}
.seat-name {
  display: flex;
  align-items: center;
  gap: 2px;
}
.host-badge {
  background: #ffd700;
  color: #333;
  font-size: 0.55rem;
  padding: 0 3px;
  border-radius: 3px;
}
.me-badge {
  background: #63b3ed;
  color: #fff;
  font-size: 0.55rem;
  padding: 0 3px;
  border-radius: 3px;
}
.seat-chips {
  color: #ffd700;
  font-weight: bold;
}
.seat-bet {
  background: rgba(0, 0, 0, 0.6);
  color: #ffd700;
  font-size: 0.65rem;
  font-weight: bold;
  padding: 1px 6px;
  border-radius: 8px;
}
.fold-badge,
.allin-badge,
.dc-badge {
  font-size: 0.6rem;
  padding: 0 4px;
  border-radius: 3px;
  color: #fff;
}
.fold-badge {
  background: #718096;
}
.allin-badge {
  background: #805ad5;
}
.dc-badge {
  background: #e53e3e;
}
.folded {
  opacity: 0.45;
}
</style>
