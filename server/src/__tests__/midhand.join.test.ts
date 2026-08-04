import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client.js", () => ({ prisma: {} }));

vi.mock("../points/points.service.js", () => ({
  deductPoints: vi.fn().mockResolvedValue(undefined),
  addPoints: vi.fn().mockResolvedValue(undefined),
  createBuyInHold: vi.fn().mockResolvedValue(undefined),
  activateBuyInHold: vi.fn().mockResolvedValue(true),
  refundBuyInHold: vi.fn().mockResolvedValue(true),
  settleBuyInHold: vi.fn().mockResolvedValue(true),
  updateBuyInHoldAmount: vi.fn().mockResolvedValue(true),
}));

vi.mock("../voice/livekit.service.js", () => ({
  livekitService: {
    getRoomName: () => "table-main",
    generateToken: vi.fn().mockResolvedValue("voice-token"),
    getClientUrl: () => "ws://localhost:7880",
  },
}));

import {
  activateBuyInHold,
  createBuyInHold,
  refundBuyInHold,
} from "../points/points.service.js";
import { LobbyHandler } from "../lobby/lobby.handler.js";
import { roomManager } from "../lobby/room.manager.js";
import { Room } from "../lobby/room.js";

interface SentMessage {
  userId?: string;
  userIds?: string[];
  type: string;
  payload: unknown;
}

function makeFakeGateway() {
  const sent: SentMessage[] = [];
  return {
    sent,
    sendToUser: vi.fn((userId: string, type: string, payload: unknown) => {
      sent.push({ userId, type, payload });
    }),
    broadcast: vi.fn((userIds: string[], type: string, payload: unknown) => {
      sent.push({ userIds, type, payload });
    }),
    broadcastAll: vi.fn((type: string, payload: unknown) => {
      sent.push({ type, payload });
    }),
  };
}

function resetRoom(room: Room) {
  for (const seat of room.seats) {
    seat.userId = null;
    seat.username = null;
    seat.chips = 0;
    seat.buyIn = 0;
    seat.connected = false;
    seat.confirmed = false;
    seat.isAi = false;
    seat.buyInHoldOperationId = null;
  }
  room.hostId = null;
  room.entryOrder = [];
  room.status = "waiting";
  room.autoResume = false;
  room.spectators = [];
  room.pendingSeatReservations = [];
  room.pendingLeaveUserIds = [];
  room.dealerSeatIndex = null;
}

describe("mid-hand seat reservations", () => {
  let handler: LobbyHandler;
  let room: Room;
  let gateway: ReturnType<typeof makeFakeGateway>;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = makeFakeGateway();
    handler = new LobbyHandler(gateway as never);
    room = roomManager.getSystemRoom();
    resetRoom(room);
    handler["engines"].clear();
    handler["engineGeneration"].clear();
    handler["roomCommandQueues"].clear();
    handler["pendingDisconnectTimers"].forEach((timer) => clearTimeout(timer));
    handler["pendingDisconnectTimers"].clear();
  });

  async function joinAndConfirm(userId: string, username: string) {
    await handler.handleMessage(userId, username, "room:join", {
      roomId: room.id,
    });
    await handler.handleMessage(userId, username, "room:confirm", {
      buyIn: room.settings.minBuyIn,
    });
  }

  async function startPlaying() {
    await joinAndConfirm("u1", "Alice");
    await joinAndConfirm("u2", "Bob");
    room.status = "playing";
    handler["startEngine"](room);
    gateway.sent.length = 0;
  }

  it("keeps a queued human out of the current engine and hides voice", async () => {
    await startPlaying();

    await handler.handleMessage("u3", "Carol", "room:join", {
      roomId: room.id,
    });
    await handler.handleMessage("u3", "Carol", "room:queue-join", {
      roomId: room.id,
      seatIndex: 3,
      buyIn: 300,
    });

    expect(room.isSpectator("u3")).toBe(true);
    expect(room.findSeatByUserId("u3")).toBeUndefined();
    expect(room.pendingSeatReservations[0]).toMatchObject({
      userId: "u3",
      seatIndex: 3,
      buyIn: 300,
    });
    expect(handler["engines"].get(room.id)!.getState().players).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: "u3" })]),
    );
    expect(
      gateway.sent.some(
        (message) => message.userId === "u3" && message.type === "voice:token",
      ),
    ).toBe(false);
    expect(createBuyInHold).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: room.id,
        userId: "u3",
        seatIndex: 3,
        amount: 300,
      }),
    );
    const operationId = (
      vi.mocked(createBuyInHold).mock.calls[0][0] as { operationId: string }
    ).operationId;
    expect(operationId).toMatch(/^midhand:/);
    expect(operationId.length).toBeLessThanOrEqual(64);
  });

  it("activates the requested seat only after the settled hand boundary", async () => {
    await startPlaying();
    await handler.handleMessage("u3", "Carol", "room:join", {
      roomId: room.id,
    });
    await handler.handleMessage("u3", "Carol", "room:queue-join", {
      roomId: room.id,
      seatIndex: 3,
      buyIn: 300,
    });

    await handler["handleHandEnd"](
      room,
      handler["engineGeneration"].get(room.id)!,
    );
    await Promise.resolve();

    const seat = room.findSeatByUserId("u3");
    expect(seat?.index).toBe(3);
    expect(seat?.confirmed).toBe(true);
    expect(seat?.chips).toBe(300);
    expect(room.isSpectator("u3")).toBe(false);
    expect(room.pendingSeatReservations).toHaveLength(0);
    expect(handler["engines"].get(room.id)!.getState().players).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: "u3" })]),
    );
    expect(activateBuyInHold).toHaveBeenCalled();
    expect(
      gateway.sent.some(
        (message) => message.userId === "u3" && message.type === "voice:token",
      ),
    ).toBe(true);
  });

  it("rejects a competing reservation and refunds the losing request", async () => {
    await startPlaying();
    await handler.handleMessage("u3", "Carol", "room:join", {
      roomId: room.id,
    });
    await handler.handleMessage("u4", "Dave", "room:join", {
      roomId: room.id,
    });

    await Promise.all([
      handler.handleMessage("u3", "Carol", "room:queue-join", {
        roomId: room.id,
        seatIndex: 3,
        buyIn: 300,
      }),
      handler.handleMessage("u4", "Dave", "room:queue-join", {
        roomId: room.id,
        seatIndex: 3,
        buyIn: 300,
      }),
    ]);

    expect(room.findPendingSeatReservation("u3")).toBeDefined();
    expect(room.findPendingSeatReservation("u4")).toBeUndefined();
    // The server rejects the occupied seat before creating a second hold.
    expect(createBuyInHold).toHaveBeenCalledTimes(1);
    expect(refundBuyInHold).not.toHaveBeenCalled();
    expect(
      gateway.sent.some(
        (message) =>
          message.userId === "u4" &&
          message.type === "room:error" &&
          (message.payload as { code: string }).code === "SEAT_TAKEN",
      ),
    ).toBe(true);
  });

  it("cancels a reservation without leaving the spectator room", async () => {
    await startPlaying();
    await handler.handleMessage("u3", "Carol", "room:join", {
      roomId: room.id,
    });
    await handler.handleMessage("u3", "Carol", "room:queue-join", {
      roomId: room.id,
      seatIndex: 3,
      buyIn: 300,
    });
    await handler.handleMessage("u3", "Carol", "room:cancel-queue-join", {});

    expect(room.isSpectator("u3")).toBe(true);
    expect(room.findPendingSeatReservation("u3")).toBeUndefined();
    expect(refundBuyInHold).toHaveBeenCalledWith(expect.any(String));
  });

  it("retains a disconnected reservation for 60 seconds, then refunds it", async () => {
    vi.useFakeTimers();
    try {
      await startPlaying();
      await handler.handleMessage("u3", "Carol", "room:join", {
        roomId: room.id,
      });
      await handler.handleMessage("u3", "Carol", "room:queue-join", {
        roomId: room.id,
        seatIndex: 3,
        buyIn: 300,
      });

      handler.handleDisconnect("u3");
      expect(room.findPendingSeatReservation("u3")?.connected).toBe(false);
      await handler.handleMessage("u3", "Carol", "reconnect", {});
      expect(room.findPendingSeatReservation("u3")?.connected).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(room.findPendingSeatReservation("u3")).toBeDefined();

      handler.handleDisconnect("u3");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(room.findPendingSeatReservation("u3")).toBeUndefined();
      expect(room.isSpectator("u3")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaving the table cancels the reservation and removes spectator access", async () => {
    await startPlaying();
    await handler.handleMessage("u3", "Carol", "room:join", {
      roomId: room.id,
    });
    await handler.handleMessage("u3", "Carol", "room:queue-join", {
      roomId: room.id,
      seatIndex: 3,
      buyIn: 300,
    });

    await handler.handleMessage("u3", "Carol", "room:leave", {});

    expect(room.findPendingSeatReservation("u3")).toBeUndefined();
    expect(room.isSpectator("u3")).toBe(false);
    expect(refundBuyInHold).toHaveBeenCalledTimes(1);
  });

  it("rejects fractional buy-ins before creating a points hold", async () => {
    await startPlaying();
    await handler.handleMessage("u3", "Carol", "room:join", {
      roomId: room.id,
    });
    await handler.handleMessage("u3", "Carol", "room:queue-join", {
      roomId: room.id,
      seatIndex: 3,
      buyIn: 300.5,
    });

    expect(createBuyInHold).not.toHaveBeenCalled();
    expect(room.findPendingSeatReservation("u3")).toBeUndefined();
    expect(
      gateway.sent.some(
        (message) =>
          message.userId === "u3" &&
          message.type === "room:error" &&
          (message.payload as { code: string }).code === "INVALID_BUYIN",
      ),
    ).toBe(true);
  });
});
