import { Router, Response } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../auth/auth.middleware.js";
import { WebSocketGateway } from "../ws/gateway.js";
import { getLeaderboard } from "./leaderboard.service.js";

export function createLeaderboardRouter(gateway: WebSocketGateway): Router {
  const router = Router();

  router.get(
    "/",
    authMiddleware,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const entries = await getLeaderboard(gateway.getTableChipsByUserId());
        res.json({ entries });
      } catch {
        res.status(500).json({ error: "INTERNAL_ERROR" });
      }
    },
  );

  return router;
}
