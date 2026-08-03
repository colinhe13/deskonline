import { Router, Request, Response } from "express";
import { z } from "zod";
import { register, login, getMe } from "./auth.service.js";
import { authMiddleware, AuthenticatedRequest } from "./auth.middleware.js";

export const authRouter = Router();

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z.string().min(6),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/register", async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
    return;
  }

  try {
    const result = await register(parsed.data.username, parsed.data.password);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "USERNAME_TAKEN") {
      res.status(409).json({ error: "USERNAME_TAKEN" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

authRouter.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
    return;
  }

  try {
    const result = await login(parsed.data.username, parsed.data.password);
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_CREDENTIALS") {
      res.status(401).json({ error: "INVALID_CREDENTIALS" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

authRouter.get(
  "/me",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = await getMe(req.user!.userId);
      res.json({ user });
    } catch {
      res.status(404).json({ error: "USER_NOT_FOUND" });
    }
  },
);
