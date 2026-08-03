<template>
  <div class="login-page">
    <div class="decor" aria-hidden="true">
      <span class="orb orb-1"></span>
      <span class="orb orb-2"></span>
      <span class="suit suit-1">♠</span>
      <span class="suit suit-2">♥</span>
      <span class="suit suit-3">♦</span>
      <span class="suit suit-4">♣</span>
    </div>
    <div class="login-card">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">♠</span>
        <h1>Texas Poker</h1>
      </div>
      <div class="brand-line"></div>
      <form @submit.prevent="handleSubmit">
        <div class="field">
          <input
            v-model="username"
            type="text"
            placeholder="用户名"
            autocomplete="username"
          />
        </div>
        <div class="field">
          <input
            v-model="password"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
          />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" :disabled="loading" class="submit-btn">
          <span v-if="loading" class="btn-spinner" aria-hidden="true"></span>
          {{ loading ? "" : isRegister ? "注册" : "登录" }}
        </button>
      </form>
      <p class="toggle">
        <a href="#" @click.prevent="isRegister = !isRegister">
          {{ isRegister ? "已有账号？去登录" : "没有账号？去注册" }}
        </a>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const username = ref("");
const password = ref("");
const isRegister = ref(false);
const loading = ref(false);
const error = ref("");

async function handleSubmit() {
  error.value = "";
  if (!username.value || !password.value) {
    error.value = "请填写用户名和密码";
    return;
  }
  loading.value = true;
  try {
    if (isRegister.value) {
      await auth.register(username.value, password.value);
    } else {
      await auth.login(username.value, password.value);
    }
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } };
    const code = e.response?.data?.error;
    if (code === "USERNAME_TAKEN") error.value = "用户名已被占用";
    else if (code === "INVALID_CREDENTIALS") error.value = "用户名或密码错误";
    else if (code === "VALIDATION_ERROR")
      error.value = "输入格式不正确（用户名3-32位字母数字下划线，密码至少6位）";
    else error.value = "网络错误，请重试";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(
      90% 70% at 50% -10%,
      var(--felt-0) 0%,
      rgba(34, 112, 74, 0) 55%
    ),
    radial-gradient(130% 100% at 50% 0%, var(--bg-1) 0%, var(--bg-0) 62%);
}

.decor {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.35;
  animation: orb-drift 14s ease-in-out infinite alternate;
}
.orb-1 {
  width: 340px;
  height: 340px;
  left: -80px;
  top: -60px;
  background: var(--gold);
}
.orb-2 {
  width: 300px;
  height: 300px;
  right: -90px;
  bottom: -70px;
  background: var(--info);
  animation-delay: -6s;
}

.suit {
  position: absolute;
  font-size: 7rem;
  line-height: 1;
  color: var(--gold);
  opacity: 0.08;
  animation: suit-float 16s ease-in-out infinite alternate;
}
.suit-1 {
  left: 8%;
  top: 14%;
  transform: rotate(-18deg);
}
.suit-2 {
  right: 10%;
  top: 22%;
  color: var(--danger);
  animation-delay: -4s;
  transform: rotate(14deg);
}
.suit-3 {
  left: 14%;
  bottom: 16%;
  color: var(--danger);
  animation-delay: -8s;
  transform: rotate(12deg);
}
.suit-4 {
  right: 14%;
  bottom: 12%;
  animation-delay: -12s;
  transform: rotate(-10deg);
}

@keyframes orb-drift {
  from {
    transform: translate(0, 0) scale(1);
  }
  to {
    transform: translate(40px, 30px) scale(1.12);
  }
}
@keyframes suit-float {
  from {
    transform: translateY(0) rotate(-12deg);
  }
  to {
    transform: translateY(-28px) rotate(12deg);
  }
}

.login-card {
  position: relative;
  z-index: 1;
  width: 90%;
  max-width: 360px;
  background: var(--glass-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 2.25rem 2rem;
  box-shadow: var(--shadow-lg);
  animation: card-in 0.5s var(--ease-spring) both;
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}
.brand-mark {
  font-size: 1.5rem;
  color: var(--gold);
}
.login-card h1 {
  text-align: center;
  margin: 0;
  font-size: var(--fs-lg);
  letter-spacing: 0.06em;
  color: var(--text);
}
.brand-line {
  width: 64px;
  height: 2px;
  margin: 0.9rem auto 1.6rem;
  border-radius: var(--radius-pill);
  background: linear-gradient(90deg, transparent, var(--gold), transparent);
}

.field {
  margin-bottom: 0.9rem;
}
.field input {
  width: 100%;
  padding: 0.75rem 0.9rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  color: var(--text);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.field input::placeholder {
  color: var(--text-dim);
}
.field input:focus {
  outline: none;
  border-color: var(--gold);
  box-shadow: 0 0 0 3px rgba(240, 199, 94, 0.18);
}

.submit-btn {
  width: 100%;
  padding: 0.75rem;
  margin-top: 0.4rem;
  background: linear-gradient(160deg, var(--gold), var(--gold-strong));
  color: #1c1304;
  font-weight: 600;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  box-shadow: var(--shadow-sm);
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    filter var(--dur-fast) var(--ease-out);
}
.submit-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-glow-gold);
}
.submit-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}
.submit-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(28, 19, 4, 0.3);
  border-top-color: #1c1304;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error {
  color: var(--danger);
  font-size: var(--fs-sm);
  margin-bottom: 0.6rem;
  text-align: center;
}

.toggle {
  text-align: center;
  margin-top: 1.2rem;
}
.toggle a {
  color: var(--gold-soft);
  text-decoration: none;
  font-size: var(--fs-sm);
  transition: color var(--dur-fast);
}
.toggle a:hover {
  color: var(--gold);
}
@media (max-width: 480px) {
  .login-card {
    padding: 1.75rem 1.25rem;
  }
  .suit {
    font-size: 5rem;
  }
}
</style>
