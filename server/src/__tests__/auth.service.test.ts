import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
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

import { generateToken, verifyToken } from "../auth/auth.service.js";
import bcrypt from "bcryptjs";
import { prisma } from "../db/client.js";
import { register, login } from "../auth/auth.service.js";

describe("auth.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateToken / verifyToken", () => {
    it("generates a token that can be verified", () => {
      const token = generateToken({ userId: "u1", username: "alice" });
      const payload = verifyToken(token);
      expect(payload.userId).toBe("u1");
      expect(payload.username).toBe("alice");
    });

    it("throws on invalid token", () => {
      expect(() => verifyToken("invalid.token.here")).toThrow();
    });
  });

  describe("register", () => {
    it("registers a new user successfully", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: "u1",
        username: "alice",
        password: "$2a$12$hashedpassword",
        points: 10000,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await register("alice", "password123", "214");
      expect(result.user.username).toBe("alice");
      expect(result.user.points).toBe(10000);
      expect(result.token).toBeTruthy();
      expect(bcrypt.hash).toHaveBeenCalledWith("password123", 12);
    });

    it("throws USERNAME_TAKEN if user exists", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "u1",
        username: "alice",
        password: "hash",
        points: 10000,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(register("alice", "password123", "214")).rejects.toThrow(
        "USERNAME_TAKEN",
      );
    });

    it("rejects a wrong register code before touching the database", async () => {
      await expect(register("alice", "password123", "999")).rejects.toThrow(
        "REGISTER_CODE_INVALID",
      );
      // Missing code (router default) is rejected the same way.
      await expect(register("alice", "password123", "")).rejects.toThrow(
        "REGISTER_CODE_INVALID",
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("logs in with correct credentials", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "u1",
        username: "alice",
        password: "$2a$12$hashedpassword",
        points: 9500,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(bcrypt.compare).mockResolvedValue(true);

      const result = await login("alice", "password123");
      expect(result.user.username).toBe("alice");
      expect(result.token).toBeTruthy();
    });

    it("throws INVALID_CREDENTIALS for wrong password", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "u1",
        username: "alice",
        password: "$2a$12$hashedpassword",
        points: 9500,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(bcrypt.compare).mockResolvedValue(false);

      await expect(login("alice", "wrongpass")).rejects.toThrow(
        "INVALID_CREDENTIALS",
      );
    });

    it("throws INVALID_CREDENTIALS for non-existent user", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(login("nobody", "pass")).rejects.toThrow(
        "INVALID_CREDENTIALS",
      );
    });
  });
});
