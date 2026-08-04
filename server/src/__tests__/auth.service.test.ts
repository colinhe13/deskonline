import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$12$hashedpassword"),
    compare: vi.fn(),
  },
}));

vi.mock("../config.js", () => ({
  config: {
    jwtSecret: "test-secret-key-for-testing-only",
    registerCode: "214",
  },
}));

import {
  generateToken,
  verifyToken,
  verifyActiveToken,
} from "../auth/auth.service.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db/client.js";
import { register, login, logout } from "../auth/auth.service.js";

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    username: "alice",
    password: "$2a$12$hashedpassword",
    points: 10000,
    isAi: false,
    sessionVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("auth.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateToken / verifyToken", () => {
    it("generates a versioned token that can be verified", () => {
      const token = generateToken({
        userId: "u1",
        username: "alice",
        sessionVersion: 4,
      });
      const payload = verifyToken(token);
      expect(payload.userId).toBe("u1");
      expect(payload.username).toBe("alice");
      expect(payload.sessionVersion).toBe(4);
    });

    it("throws on invalid token", () => {
      expect(() => verifyToken("invalid.token.here")).toThrow();
    });

    it("rejects a legacy token without a session version", () => {
      const token = jwt.sign(
        { userId: "u1", username: "alice" },
        "test-secret-key-for-testing-only",
      );
      expect(() => verifyToken(token)).toThrow("INVALID_TOKEN");
    });
  });

  describe("verifyActiveToken", () => {
    it("accepts a token matching the database version", async () => {
      const token = generateToken({
        userId: "u1",
        username: "alice",
        sessionVersion: 3,
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(
        makeUser({ sessionVersion: 3 }),
      );

      await expect(verifyActiveToken(token)).resolves.toEqual({
        userId: "u1",
        username: "alice",
        sessionVersion: 3,
      });
    });

    it("rejects a token from an older login", async () => {
      const token = generateToken({
        userId: "u1",
        username: "alice",
        sessionVersion: 2,
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(
        makeUser({ sessionVersion: 3 }),
      );

      await expect(verifyActiveToken(token)).rejects.toThrow("SESSION_INVALID");
    });
  });

  describe("register", () => {
    it("registers a new user with the initial session version", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockResolvedValue(makeUser());

      const result = await register("alice", "password123", "214");
      const payload = verifyToken(result.token);
      expect(result.user.username).toBe("alice");
      expect(result.user.points).toBe(10000);
      expect(payload.sessionVersion).toBe(0);
      expect(bcrypt.hash).toHaveBeenCalledWith("password123", 12);
    });

    it("throws USERNAME_TAKEN if user exists", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser());

      await expect(register("alice", "password123", "214")).rejects.toThrow(
        "USERNAME_TAKEN",
      );
    });

    it("rejects a wrong register code before touching the database", async () => {
      await expect(register("alice", "password123", "999")).rejects.toThrow(
        "REGISTER_CODE_INVALID",
      );
      await expect(register("alice", "password123", "")).rejects.toThrow(
        "REGISTER_CODE_INVALID",
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("atomically rotates the session version", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser());
      vi.mocked(bcrypt.compare).mockResolvedValue(true);
      vi.mocked(prisma.user.update).mockResolvedValue(
        makeUser({ points: 9500, sessionVersion: 7 }),
      );

      const result = await login("alice", "password123");
      const payload = verifyToken(result.token);
      expect(result.user.username).toBe("alice");
      expect(payload.sessionVersion).toBe(7);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "u1" },
          data: { sessionVersion: { increment: 1 } },
        }),
      );
    });

    it("throws INVALID_CREDENTIALS for wrong password", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser());
      vi.mocked(bcrypt.compare).mockResolvedValue(false);

      await expect(login("alice", "wrongpass")).rejects.toThrow(
        "INVALID_CREDENTIALS",
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("throws INVALID_CREDENTIALS for a non-existent user", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(login("nobody", "pass")).rejects.toThrow(
        "INVALID_CREDENTIALS",
      );
    });
  });

  describe("logout", () => {
    it("invalidates only the currently active session version", async () => {
      vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 });

      await expect(logout("u1", 7)).resolves.toBe(8);
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "u1", sessionVersion: 7 },
        data: { sessionVersion: { increment: 1 } },
      });
    });

    it("rejects a stale logout so it cannot invalidate a newer session", async () => {
      vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 0 });

      await expect(logout("u1", 6)).rejects.toThrow("SESSION_INVALID");
    });
  });
});
