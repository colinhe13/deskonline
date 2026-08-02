<template>
  <div class="login-page">
    <div class="login-card">
      <h1>Texas Poker</h1>
      <form @submit.prevent="handleSubmit">
        <div class="field">
          <input v-model="username" type="text" placeholder="用户名" autocomplete="username" />
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
        <button type="submit" :disabled="loading">
          {{ loading ? "..." : isRegister ? "注册" : "登录" }}
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
    else if (code === "VALIDATION_ERROR") error.value = "输入格式不正确（用户名3-32位字母数字下划线，密码至少6位）";
    else error.value = "网络错误，请重试";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a472a;
}
.login-card {
  background: #fff;
  border-radius: 12px;
  padding: 2rem;
  width: 90%;
  max-width: 360px;
}
.login-card h1 {
  text-align: center;
  margin-bottom: 1.5rem;
  color: #1a472a;
}
.field {
  margin-bottom: 1rem;
}
.field input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
}
button {
  width: 100%;
  padding: 0.75rem;
  background: #1a472a;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.error {
  color: #e53e3e;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}
.toggle {
  text-align: center;
  margin-top: 1rem;
}
.toggle a {
  color: #1a472a;
  text-decoration: none;
}
</style>
