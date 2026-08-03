import express from "express";
import { createServer } from "http";
import { config } from "./config.js";
import { authRouter } from "./auth/auth.router.js";
import { createLeaderboardRouter } from "./leaderboard/leaderboard.router.js";
import { WebSocketGateway } from "./ws/gateway.js";
import { ensureAiAccounts } from "./ai/accounts.js";

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);

const server = createServer(app);
const gateway = new WebSocketGateway(server);
app.use("/api/leaderboard", createLeaderboardRouter(gateway));

// AI pool accounts must exist before any ai:add can be served.
ensureAiAccounts().catch((err) => {
  console.error("[ai] failed to ensure AI accounts", err);
});

server.listen(config.port, () => {
  console.log(`Game server listening on port ${config.port}`);
});

export { app, server, gateway };
