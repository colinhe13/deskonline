import { Request, Response, NextFunction } from "express";
import { verifyActiveToken, JwtPayload } from "./auth.service.js";

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const token = header.slice(7);
    req.user = await verifyActiveToken(token);
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN" });
  }
}
