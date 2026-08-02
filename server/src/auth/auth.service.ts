import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db/client.js";
import { config } from "../config.js";

export interface JwtPayload {
  userId: string;
  username: string;
}

export async function register(username: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw new Error("USERNAME_TAKEN");
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { username, password: hashed },
  });

  const token = generateToken({ userId: user.id, username: user.username });
  return { token, user: { id: user.id, username: user.username, points: user.points } };
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

  const token = generateToken({ userId: user.id, username: user.username });
  return { token, user: { id: user.id, username: user.username, points: user.points } };
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
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}
