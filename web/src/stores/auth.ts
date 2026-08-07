import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { http, onUnauthorized } from "../utils/http";
import router from "../router";
import {
  useWebSocket,
  type SessionInvalidation,
} from "../composables/useWebSocket";
import { useVoice } from "../composables/useVoice";

interface UserInfo {
  id: string;
  username: string;
  points: number;
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("token"));
  const user = ref<UserInfo | null>(null);
  const webSocket = useWebSocket();
  const voice = useVoice();

  const isAuthenticated = computed(() => !!token.value);

  function clearLocalAuth(invalidatedToken?: string) {
    const storedToken = localStorage.getItem("token");
    if (invalidatedToken && storedToken === invalidatedToken) {
      localStorage.removeItem("token");
    }
    token.value = null;
    user.value = null;
  }

  function forceLogout(event: SessionInvalidation) {
    if (event.token && token.value && event.token !== token.value) return;
    webSocket.disconnect();
    voice.disconnect();
    clearLocalAuth(event.token);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("auth:forced-logout", "1");
    }
    if (router.currentRoute.value.name !== "login") {
      void router.push({
        name: "login",
        query: { reason: event.reason },
      });
    }
  }

  webSocket.onSessionInvalidated(forceLogout);
  onUnauthorized((invalidatedToken) => {
    forceLogout({
      reason: "invalid",
      token: invalidatedToken ?? "",
    });
  });

  async function login(username: string, password: string) {
    const res = await http.post("/api/auth/login", { username, password });
    webSocket.disconnect();
    token.value = res.data.token;
    user.value = res.data.user;
    localStorage.setItem("token", res.data.token);
    sessionStorage.removeItem("auth:forced-logout");
    webSocket.connect();
    router.push("/lobby");
  }

  async function register(
    username: string,
    password: string,
    registerCode: string,
  ) {
    const res = await http.post("/api/auth/register", {
      username,
      password,
      registerCode,
    });
    webSocket.disconnect();
    token.value = res.data.token;
    user.value = res.data.user;
    localStorage.setItem("token", res.data.token);
    sessionStorage.removeItem("auth:forced-logout");
    webSocket.connect();
    router.push("/lobby");
  }

  async function fetchMe() {
    try {
      const res = await http.get("/api/auth/me");
      user.value = res.data.user;
    } catch {
      // The 401 interceptor already performed forced logout. Network errors
      // still use the existing local logout fallback.
      if (token.value) await logout();
    }
  }

  async function logout() {
    const currentToken = token.value;
    webSocket.disconnect();
    voice.disconnect();
    try {
      if (currentToken) {
        await http.post("/api/auth/logout", undefined, {
          headers: { Authorization: `Bearer ${currentToken}` },
        });
      }
    } catch {
      // Local logout must still complete if the server is unavailable.
    }
    clearLocalAuth(currentToken ?? undefined);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("auth:forced-logout");
    }
    if (router.currentRoute.value.name !== "login") {
      await router.push("/login");
    }
  }

  return { token, user, isAuthenticated, login, register, logout, fetchMe };
});
