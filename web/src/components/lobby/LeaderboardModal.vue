<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h2>积分排行榜</h2>
      <p class="board-note">
        今日变化 = 当日积分余额净变动（北京时间 0 点起算）
      </p>
      <p v-if="loading" class="board-status">加载中…</p>
      <p v-else-if="error" class="board-status error">{{ error }}</p>
      <ol v-else class="board">
        <li
          v-for="entry in entries"
          :key="entry.userId"
          class="board-row"
          :class="{ 'top-rank': entry.rank <= 3 }"
        >
          <span class="rank">{{ entry.rank }}</span>
          <span class="name">
            {{ entry.username }}
            <span v-if="entry.isAi" class="ai-badge">AI</span>
          </span>
          <span class="daily" :class="dailyClass(entry.dailyDelta)">
            {{ formatDaily(entry.dailyDelta) }}
          </span>
          <span class="total">{{ entry.total }}</span>
        </li>
      </ol>
      <div class="modal-actions">
        <button type="button" class="btn-ghost" @click="$emit('close')">
          关闭
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { http } from "../../utils/http";

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  isAi: boolean;
  total: number;
  dailyDelta: number;
}

defineEmits<{ close: [] }>();

function formatDaily(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function dailyClass(delta: number): string {
  if (delta > 0) return "daily-up";
  if (delta < 0) return "daily-down";
  return "daily-flat";
}

const entries = ref<LeaderboardEntry[]>([]);
const loading = ref(true);
const error = ref("");

onMounted(async () => {
  try {
    const res = await http.get("/api/leaderboard");
    entries.value = res.data.entries;
  } catch {
    error.value = "排行榜加载失败，请重试";
  } finally {
    loading.value = false;
  }
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
  max-width: 420px;
  box-shadow: var(--shadow-lg);
}
.modal h2 {
  margin-bottom: 1rem;
  color: var(--gold);
  letter-spacing: 0.05em;
}
.board-status {
  text-align: center;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  padding: 1.5rem 0;
}
.board-status.error {
  color: var(--danger);
}
.board {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 55vh;
  overflow-y: auto;
}
.board-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.6rem;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  color: var(--text);
}
.board-row:nth-child(odd) {
  background: rgba(0, 0, 0, 0.22);
}
.board-row.top-rank .rank {
  color: var(--gold);
  font-weight: 700;
}
.rank {
  width: 2.2ch;
  text-align: center;
  color: var(--text-dim);
  flex: none;
}
.name {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-badge {
  flex: none;
  font-size: var(--fs-xs);
  padding: 0.05rem 0.4rem;
  border-radius: var(--radius-pill);
  background: rgba(139, 92, 246, 0.3);
  color: #d8c7ff;
  border: 1px solid rgba(139, 92, 246, 0.5);
}
.total {
  font-weight: 600;
  color: var(--gold-soft);
}
.daily {
  flex: none;
  width: 6.5ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-xs);
}
.daily-up {
  color: var(--success);
}
.daily-down {
  color: var(--danger);
}
.daily-flat {
  color: var(--text-dim);
}
.board-note {
  margin: -0.6rem 0 0.8rem;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.modal-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
.modal-actions button {
  flex: 1;
  min-height: 44px;
  padding: 0.6rem;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: 600;
  transition:
    transform var(--dur-fast) var(--ease-out),
    background var(--dur-fast);
}
.btn-ghost {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-dim);
  border: 1px solid var(--glass-border) !important;
}
.btn-ghost:hover {
  color: var(--text);
}
</style>
