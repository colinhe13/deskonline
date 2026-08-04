import express from "express";
import { createServer } from "http";
import { config } from "./config.js";
import { authRouter } from "./auth/auth.router.js";
import { createLeaderboardRouter } from "./leaderboard/leaderboard.router.js";
import { WebSocketGateway } from "./ws/gateway.js";
import { ensureAiAccounts } from "./ai/accounts.js";
import { recoverUnsettledBuyInHolds } from "./points/points.service.js";

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);

const server = createServer(app);
const gateway = new WebSocketGateway(server);
app.use("/api/leaderboard", createLeaderboardRouter(gateway));

async function startServer() {
  try {
    const recovered = await recoverUnsettledBuyInHolds();
    if (recovered > 0) {
      console.info(`[points] recovered ${recovered} unsettled buy-in holds`);
    }
  } catch (err) {
    console.error("[points] failed to recover buy-in holds", err);
  }

  // AI pool accounts must exist before any ai:add can be served.
  try {
    await ensureAiAccounts();
  } catch (err) {
    console.error("[ai] failed to ensure AI accounts", err);
  }

  server.listen(config.port, () => {
    console.log(`Game server listening on port ${config.port}`);
  });
}

void startServer();

export { app, server, gateway };
