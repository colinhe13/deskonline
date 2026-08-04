<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h2>
        {{ username }}
        <span v-if="isAi" class="ai-badge">AI</span>
      </h2>

      <template v-if="isAi">
        <p class="placeholder">AI 玩家按 GTO 基准策略决策，不积累画像。</p>
      </template>
      <template v-else-if="!profile">
        <p class="placeholder">暂无观察数据。</p>
      </template>
      <template v-else-if="!profile.ready">
        <p class="placeholder">AI 观察中（已观察 {{ profile.hands }} 手）</p>
      </template>
      <template v-else>
        <div class="stats-grid">
          <div v-for="item in statItems" :key="item.label" class="stat-cell">
            <span class="stat-value">{{ item.value }}</span>
            <span class="stat-label">{{ item.label }}</span>
          </div>
        </div>
        <p v-if="profile.note" class="note">{{ profile.note }}</p>
        <p class="disclaimer">AI 观察，仅供娱乐</p>
      </template>

      <div class="modal-actions">
        <button type="button" class="btn-ghost" @click="$emit('close')">
          关闭
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ProfileView } from "../../stores/profiles";

const props = defineProps<{
  username: string;
  isAi: boolean;
  profile: ProfileView | null;
}>();
defineEmits<{ close: [] }>();

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${v}%`;
}

const statItems = computed(() => {
  const s = props.profile?.stats;
  if (!s) return [];
  return [
    { label: "入池率 VPIP", value: pct(s.vpip) },
    { label: "翻前加注率 PFR", value: pct(s.pfr) },
    { label: "三注率 3-Bet", value: pct(s.threeBet) },
    { label: "翻后激进度 AF", value: s.af == null ? "—" : String(s.af) },
    { label: "面对加注弃牌率", value: pct(s.foldToRaise) },
    { label: "进摊牌率 WTSD", value: pct(s.wtsd) },
  ];
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(4, 10, 7, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: var(--z-modal);
}
.modal {
  background: linear-gradient(
    170deg,
    rgba(26, 48, 36, 0.95),
    rgba(12, 28, 19, 0.96)
  );
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 1.6rem 1.5rem;
  width: 90%;
  max-width: 360px;
  box-shadow: var(--shadow-lg);
}
.modal h2 {
  margin-bottom: 0.75rem;
  color: var(--gold);
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.ai-badge {
  background: linear-gradient(135deg, #4a90d9, #8b5cf6);
  color: #fff;
  font-size: 0.6rem;
  padding: 0.05rem 0.35rem;
  border-radius: var(--radius-pill);
}
.placeholder {
  color: var(--text-dim);
  font-size: var(--fs-sm);
  margin-bottom: 1rem;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.9rem;
}
.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.5rem 0.25rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}
.stat-value {
  color: var(--gold);
  font-weight: 700;
  font-size: var(--fs-md);
  font-variant-numeric: tabular-nums;
}
.stat-label {
  color: var(--text-dim);
  font-size: 0.58rem;
  text-align: center;
}
.note {
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.5;
  padding: 0.6rem 0.75rem;
  background: rgba(240, 199, 94, 0.1);
  border: 1px solid rgba(240, 199, 94, 0.28);
  border-radius: var(--radius-md);
  margin-bottom: 0.6rem;
}
.disclaimer {
  color: var(--text-faint);
  font-size: 0.58rem;
  text-align: right;
  margin-bottom: 0.9rem;
}
.modal-actions {
  display: flex;
}
.modal-actions button {
  flex: 1;
  min-height: 44px;
  padding: 0.6rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: 600;
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-dim);
  transition:
    transform var(--dur-fast) var(--ease-out),
    color var(--dur-fast);
}
.modal-actions button:hover {
  transform: translateY(-1px);
  color: var(--text);
}
.modal-actions button:active {
  transform: scale(0.97);
}
</style>
