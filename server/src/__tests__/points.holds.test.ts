import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    user: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    buyInHold: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return {
    tx,
    prisma: {
      user: tx.user,
      buyInHold: tx.buyInHold,
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
  };
});

vi.mock("../db/client.js", () => ({ prisma: mocks.prisma }));

import {
  activateBuyInHold,
  createBuyInHold,
  recoverUnsettledBuyInHolds,
  refundBuyInHold,
  settleBuyInHold,
} from "../points/points.service.js";

describe("buy-in point holds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.user.update.mockResolvedValue({});
    mocks.tx.buyInHold.create.mockResolvedValue({});
    mocks.tx.buyInHold.updateMany.mockResolvedValue({ count: 1 });
  });

  it("deducts points and creates a pending hold in one transaction", async () => {
    await createBuyInHold({
      operationId: "op-1",
      roomId: "main",
      userId: "u1",
      seatIndex: 3,
      amount: 300,
    });

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", points: { gte: 300 } },
      data: { points: { decrement: 300 } },
    });
    expect(mocks.tx.buyInHold.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operationId: "op-1",
        status: "pending",
        amount: 300,
      }),
    });
  });

  it("rejects insufficient balance before creating a hold", async () => {
    mocks.tx.user.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      createBuyInHold({
        operationId: "op-1",
        roomId: "main",
        userId: "u1",
        seatIndex: 3,
        amount: 300,
      }),
    ).rejects.toThrow("INSUFFICIENT_POINTS");
    expect(mocks.tx.buyInHold.create).not.toHaveBeenCalled();
  });

  it("activates a pending hold idempotently", async () => {
    mocks.tx.buyInHold.findUnique
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "active" });

    await expect(activateBuyInHold("op-1")).resolves.toBe(true);
    await expect(activateBuyInHold("op-1")).resolves.toBe(true);
    expect(mocks.tx.buyInHold.updateMany).toHaveBeenCalledTimes(1);
  });

  it("refunds a hold at most once", async () => {
    mocks.tx.buyInHold.findUnique
      .mockResolvedValueOnce({
        status: "pending",
        amount: 300,
        userId: "u1",
      })
      .mockResolvedValueOnce({ status: "refunded" });

    await expect(refundBuyInHold("op-1")).resolves.toBe(true);
    await expect(refundBuyInHold("op-1")).resolves.toBe(false);
    expect(mocks.tx.user.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { points: { increment: 300 } },
    });
  });

  it("settles an active hold using the final table stack", async () => {
    mocks.tx.buyInHold.findUnique.mockResolvedValue({ userId: "u1" });
    await expect(settleBuyInHold("op-1", 425)).resolves.toBe(true);
    expect(mocks.tx.buyInHold.updateMany).toHaveBeenCalledWith({
      where: { operationId: "op-1", status: "active" },
      data: { status: "refunded", amount: 425 },
    });
    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { points: { increment: 425 } },
    });
  });

  it("recovers pending and active holds after a process restart", async () => {
    mocks.tx.buyInHold.findMany.mockResolvedValue([
      { id: "h1", userId: "u1", amount: 300 },
      { id: "h2", userId: "u2", amount: 425 },
    ]);

    await expect(recoverUnsettledBuyInHolds()).resolves.toBe(2);
    expect(mocks.tx.buyInHold.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.tx.user.update).toHaveBeenCalledTimes(2);
  });
});
