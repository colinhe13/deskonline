import axios from "axios";

type UnauthorizedHandler = (token: string | null) => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();

export function onUnauthorized(handler: UnauthorizedHandler) {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

const baseURL = import.meta.env.VITE_API_BASE || "";

export const http = axios.create({
  baseURL,
  timeout: 10000,
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || "";
    const isPublicAuthRequest = /\/auth\/(login|register)$/.test(url);
    if (err.response?.status === 401 && !isPublicAuthRequest) {
      const authorization = err.config?.headers?.Authorization;
      const token =
        typeof authorization === "string" && authorization.startsWith("Bearer ")
          ? authorization.slice(7)
          : localStorage.getItem("token");
      if (unauthorizedHandlers.size === 0) {
        localStorage.removeItem("token");
        window.location.href = "/login";
      } else {
        for (const handler of [...unauthorizedHandlers]) {
          handler(token);
        }
      }
    }
    return Promise.reject(err);
  },
);
