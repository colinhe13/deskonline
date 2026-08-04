import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db/client.js";
import { config } from "../config.js";

export interface JwtPayload {
  userId: string;
  username: string;
  sessionVersion: number;
}

export async function register(
  username: string,
  password: string,
  registerCode: string,
) {
  if (registerCode !== config.registerCode) {
    throw new Error("REGISTER_CODE_INVALID");
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw new Error("USERNAME_TAKEN");
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { username, password: hashed },
  });

  const token = generateToken({
    userId: user.id,
    username: user.username,
    sessionVersion: user.sessionVersion,
  });
  return {
    token,
    user: { id: user.id, username: user.username, points: user.points },
  };
}

export async function login(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw new Error("INVALID_CREDENTIALS");
  }

  // Increment atomically so concurrent logins cannot both remain valid.
  const activeUser = await prisma.user.update({
    where: { id: user.id },
    data: { sessionVersion: { increment: 1 } },
    select: {
      id: true,
      username: true,
      points: true,
      sessionVersion: true,
    },
  });

  const token = generateToken({
    userId: activeUser.id,
    username: activeUser.username,
    sessionVersion: activeUser.sessionVersion,
  });
  return {
    token,
    user: {
      id: activeUser.id,
      username: activeUser.username,
      points: activeUser.points,
    },
    sessionVersion: activeUser.sessionVersion,
  };
}

export async function logout(userId: string, sessionVersion: number) {
  const result = await prisma.user.updateMany({
    where: { id: userId, sessionVersion },
    data: { sessionVersion: { increment: 1 } },
  });
  if (result.count !== 1) {
    throw new Error("SESSION_INVALID");
  }
  return sessionVersion + 1;
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }
  return { id: user.id, username: user.username, points: user.points };
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    typeof decoded.userId !== "string" ||
    typeof decoded.username !== "string" ||
    !Number.isInteger(decoded.sessionVersion)
  ) {
    throw new Error("INVALID_TOKEN");
  }
  return {
    userId: decoded.userId,
    username: decoded.username,
    sessionVersion: decoded.sessionVersion,
  };
}

export async function verifyActiveToken(token: string): Promise<JwtPayload> {
  const payload = verifyToken(token);
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { sessionVersion: true },
  });
  if (!user || user.sessionVersion !== payload.sessionVersion) {
    throw new Error("SESSION_INVALID");
  }
  return payload;
}
