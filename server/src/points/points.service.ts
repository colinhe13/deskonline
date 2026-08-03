import { prisma } from "../db/client.js";

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
