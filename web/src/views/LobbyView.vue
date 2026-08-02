<template>
  <div class="lobby-page">
    <header class="lobby-header">
      <h1>大厅</h1>
      <div class="user-info">
        <span>{{ auth.user?.username }}</span>
        <button @click="auth.logout()">退出</button>
      </div>
    </header>
    <main class="lobby-content">
      <p class="placeholder">房间列表（Phase 2 实现）</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
</script>

<style scoped>
.lobby-page {
  min-height: 100vh;
  background: #f5f5f5;
}
.lobby-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: #1a472a;
  color: #fff;
}
.lobby-header h1 {
  margin: 0;
  font-size: 1.25rem;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.user-info button {
  padding: 0.4rem 0.8rem;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.lobby-content {
  padding: 2rem;
}
.placeholder {
  color: #999;
  text-align: center;
}
</style>
