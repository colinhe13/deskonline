import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { http } from "../utils/http";
import router from "../router";

interface UserInfo {
  id: string;
  username: string;
  points: number;
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("token"));
  const user = ref<UserInfo | null>(null);

  const isAuthenticated = computed(() => !!token.value);

  async function login(username: string, password: string) {
    const res = await http.post("/api/auth/login", { username, password });
    token.value = res.data.token;
    user.value = res.data.user;
    localStorage.setItem("token", res.data.token);
    router.push("/lobby");
  }

  async function register(username: string, password: string) {
    const res = await http.post("/api/auth/register", { username, password });
    token.value = res.data.token;
    user.value = res.data.user;
    localStorage.setItem("token", res.data.token);
    router.push("/lobby");
  }

  function logout() {
    token.value = null;
    user.value = null;
    localStorage.removeItem("token");
    router.push("/login");
  }

  return { token, user, isAuthenticated, login, register, logout };
});
