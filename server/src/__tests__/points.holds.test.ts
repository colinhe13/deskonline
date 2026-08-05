import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    user: {
      updateMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    buyInHold: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    pointsTransaction: {
      create: vi.fn(),
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
  addPoints,
  createBuyInHold,
  deductPoints,
  recoverUnsettledBuyInHolds,
  refundBuyInHold,
  settleBuyInHold,
} from "../points/points.service.js";

describe("buy-in point holds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.user.update.mockResolvedValue({});
    mocks.tx.user.findUnique.mockResolvedValue({ points: 9700 });
    mocks.tx.buyInHold.create.mockResolvedValue({});
    mocks.tx.buyInHold.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.pointsTransaction.create.mockResolvedValue({});
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
    expect(mocks.tx.pointsTransaction.create).not.toHaveBeenCalled();
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

describe("points transaction ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.user.update.mockResolvedValue({});
    mocks.tx.user.findUnique.mockResolvedValue({ points: 9700 });
    mocks.tx.buyInHold.create.mockResolvedValue({});
    mocks.tx.buyInHold.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.pointsTransaction.create.mockResolvedValue({});
  });

  it("records a buy_in ledger row when creating a hold", async () => {
    await createBuyInHold({
      operationId: "op-1",
      roomId: "main",
      userId: "u1",
      seatIndex: 3,
      amount: 300,
    });

    expect(mocks.tx.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", delta: -300, balanceAfter: 9700, type: "buy_in" },
    });
  });

  it("records no ledger row when the balance guard rejects", async () => {
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
    expect(mocks.tx.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it("records a refund ledger row when refunding a hold", async () => {
    mocks.tx.buyInHold.findUnique.mockResolvedValueOnce({
      status: "pending",
      amount: 300,
      userId: "u1",
    });

    await refundBuyInHold("op-1");

    expect(mocks.tx.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", delta: 300, balanceAfter: 9700, type: "refund" },
    });
  });

  it("records a settle ledger row with the final stack", async () => {
    mocks.tx.buyInHold.findUnique.mockResolvedValue({ userId: "u1" });

    await settleBuyInHold("op-1", 425);

    expect(mocks.tx.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", delta: 425, balanceAfter: 9700, type: "settle" },
    });
  });

  it("records no ledger row when settling a zero stack", async () => {
    await expect(settleBuyInHold("op-1", 0)).resolves.toBe(true);
    expect(mocks.tx.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it("records refund ledger rows during restart recovery", async () => {
    mocks.tx.buyInHold.findMany.mockResolvedValue([
      { id: "h1", userId: "u1", amount: 300 },
      { id: "h2", userId: "u2", amount: 425 },
    ]);

    await recoverUnsettledBuyInHolds();

    expect(mocks.tx.pointsTransaction.create).toHaveBeenCalledTimes(2);
    expect(mocks.tx.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", delta: 300, balanceAfter: 9700, type: "refund" },
    });
    expect(mocks.tx.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u2", delta: 425, balanceAfter: 9700, type: "refund" },
    });
  });

  it("deductPoints writes a ledger row in the same transaction", async () => {
    await deductPoints("u1", 200);

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", points: { gte: 200 } },
      data: { points: { decrement: 200 } },
    });
    expect(mocks.tx.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", delta: -200, balanceAfter: 9700, type: "buy_in" },
    });
  });

  it("deductPoints rejects without a ledger row on insufficient balance", async () => {
    mocks.tx.user.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(deductPoints("u1", 200)).rejects.toThrow(
      "INSUFFICIENT_POINTS",
    );
    expect(mocks.tx.pointsTransaction.create).not.toHaveBeenCalled();
  });

  it("addPoints writes a refund ledger row by default", async () => {
    await addPoints("u1", 150);

    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { points: { increment: 150 } },
    });
    expect(mocks.tx.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", delta: 150, balanceAfter: 9700, type: "refund" },
    });
  });

  it("addPoints accepts an explicit settle type", async () => {
    await addPoints("u1", 150, "settle");

    expect(mocks.tx.pointsTransaction.create).toHaveBeenCalledWith({
      data: { userId: "u1", delta: 150, balanceAfter: 9700, type: "settle" },
    });
  });
});
