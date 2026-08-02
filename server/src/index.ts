import express from "express";
import { createServer } from "http";
import { config } from "./config.js";
import { authRouter } from "./auth/auth.router.js";
import { WebSocketGateway } from "./ws/gateway.js";

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);

const server = createServer(app);
const gateway = new WebSocketGateway(server);

server.listen(config.port, () => {
  console.log(`Game server listening on port ${config.port}`);
});

export { app, server, gateway };
