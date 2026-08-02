import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("../views/LoginView.vue"),
    },
    {
      path: "/lobby",
      name: "lobby",
      component: () => import("../views/LobbyView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/table/:id",
      name: "table",
      component: () => import("../views/TableView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/",
      redirect: "/lobby",
    },
  ],
});

router.beforeEach((to) => {
  const token = localStorage.getItem("token");
  if (to.meta.requiresAuth && !token) {
    return { name: "login" };
  }
  if (to.name === "login" && token) {
    return { name: "lobby" };
  }
});

export default router;
