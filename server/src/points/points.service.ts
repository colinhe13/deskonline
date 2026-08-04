import { prisma } from "../db/client.js";

type OpenHoldStatus = "pending" | "active";

interface BuyInHoldInput {
  operationId: string;
  roomId: string;
  userId: string;
  seatIndex: number;
  amount: number;
}

export async function deductPoints(
  userId: string,
  amount: number,
): Promise<void> {
  const result = await prisma.user.updateMany({
    where: { id: userId, points: { gte: amount } },
    data: { points: { decrement: amount } },
  });
  if (result.count === 0) {
    throw new Error("INSUFFICIENT_POINTS");
  }
}

export async function addPoints(userId: string, amount: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { points: { increment: amount } },
  });
}

export async function getPoints(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("USER_NOT_FOUND");
  return user.points;
}

// A hold makes the buy-in reservation durable before the user is seated. The
// balance decrement and hold creation must commit or roll back together.
export async function createBuyInHold(input: BuyInHoldInput): Promise<void> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("INVALID_BUYIN");
  }

  await prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: input.userId, points: { gte: input.amount } },
      data: { points: { decrement: input.amount } },
    });
    if (result.count === 0) {
      throw new Error("INSUFFICIENT_POINTS");
    }

    await tx.buyInHold.create({
      data: {
        operationId: input.operationId,
        roomId: input.roomId,
        userId: input.userId,
        seatIndex: input.seatIndex,
        amount: input.amount,
        status: "pending",
      },
    });
  });
}

export async function activateBuyInHold(operationId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const hold = await tx.buyInHold.findUnique({ where: { operationId } });
    if (!hold || hold.status === "refunded") return false;
    if (hold.status === "active") return true;

    const result = await tx.buyInHold.updateMany({
      where: { operationId, status: "pending" },
      data: { status: "active" },
    });
    return result.count === 1;
  });
}

export async function updateBuyInHoldAmount(
  operationId: string,
  amount: number,
): Promise<boolean> {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("INVALID_HOLD_AMOUNT");
  }
  const result = await prisma.buyInHold.updateMany({
    where: { operationId, status: "active" },
    data: { amount },
  });
  return result.count === 1;
}

// Refunds both pending reservations and active table holdings. The status
// transition is conditional so retries cannot credit points twice.
export async function refundBuyInHold(operationId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const hold = await tx.buyInHold.findUnique({ where: { operationId } });
    if (!hold || !isOpenHoldStatus(hold.status)) return false;

    const result = await tx.buyInHold.updateMany({
      where: { operationId, status: { in: ["pending", "active"] } },
      data: { status: "refunded" },
    });
    if (result.count !== 1) return false;

    if (hold.amount > 0) {
      await tx.user.update({
        where: { id: hold.userId },
        data: { points: { increment: hold.amount } },
      });
    }
    return true;
  });
}

// For an active hold, the final table stack is the amount that returns to the
// global balance. This handles wins/losses without a second deduction.
export async function settleBuyInHold(
  operationId: string,
  finalAmount: number,
): Promise<boolean> {
  if (!Number.isInteger(finalAmount) || finalAmount < 0) {
    throw new Error("INVALID_HOLD_AMOUNT");
  }

  return prisma.$transaction(async (tx) => {
    const result = await tx.buyInHold.updateMany({
      where: { operationId, status: "active" },
      data: { status: "refunded", amount: finalAmount },
    });
    if (result.count !== 1) return false;

    if (finalAmount > 0) {
      const hold = await tx.buyInHold.findUnique({
        where: { operationId },
        select: { userId: true },
      });
      if (!hold) return false;
      await tx.user.update({
        where: { id: hold.userId },
        data: { points: { increment: finalAmount } },
      });
    }
    return true;
  });
}

// Runtime room state is intentionally in memory. If the process restarts, an
// open hold has no matching seat snapshot, so returning it is the safe
// recovery operation and preserves the points invariant.
export async function recoverUnsettledBuyInHolds(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const holds = await tx.buyInHold.findMany({
      where: { status: { in: ["pending", "active"] } },
    });
    let recovered = 0;

    for (const hold of holds) {
      const result = await tx.buyInHold.updateMany({
        where: {
          id: hold.id,
          status: { in: ["pending", "active"] },
        },
        data: { status: "refunded" },
      });
      if (result.count !== 1) continue;

      if (hold.amount > 0) {
        await tx.user.update({
          where: { id: hold.userId },
          data: { points: { increment: hold.amount } },
        });
      }
      recovered++;
    }
    return recovered;
  });
}

function isOpenHoldStatus(status: string): status is OpenHoldStatus {
  return status === "pending" || status === "active";
}
