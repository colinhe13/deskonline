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

import { LobbyHandler } from "../lobby/lobby.handler.js";
import { roomManager } from "../lobby/room.manager.js";
import { Room } from "../lobby/room.js";
import { MAX_CHAT_LENGTH } from "../ws/protocol.js";

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
    seat.autoManaged = false;
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

function chatMessages(sent: SentMessage[]): SentMessage[] {
  return sent.filter((message) => message.type === "room:chat:message");
}

describe("room chat", () => {
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

  async function joinSeated(userId: string, username: string) {
    await handler.handleMessage(userId, username, "room:join", {
      roomId: room.id,
    });
  }

  it("broadcasts a seated player's message to players and spectators", async () => {
    await joinSeated("u1", "Alice");
    await joinSeated("u2", "Bob");
    room.status = "playing";
    room.addSpectator("u9", "Carol");
    gateway.sent.length = 0;

    await handler.handleMessage("u1", "Alice", "room:chat:send", {
      text: "大家好",
    });

    const broadcasts = chatMessages(gateway.sent);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].userIds).toEqual(
      expect.arrayContaining(["u1", "u2", "u9"]),
    );
    const message = (
      broadcasts[0].payload as { message: Record<string, unknown> }
    ).message;
    expect(message).toMatchObject({
      userId: "u1",
      username: "Alice",
      text: "大家好",
    });
    expect(typeof message.id).toBe("string");
    expect((message.id as string).length).toBeGreaterThan(0);
    expect(typeof message.sentAt).toBe("number");
  });

  it("lets spectators and pending reservations send, and trims whitespace", async () => {
    await joinSeated("u1", "Alice");
    room.status = "playing";
    room.addSpectator("u9", "Carol");
    room.addSpectator("u8", "Dave");
    room.addPendingSeatReservation("u8", "Dave", 3, 300, "midhand:test");
    gateway.sent.length = 0;

    await handler.handleMessage("u9", "Carol", "room:chat:send", {
      text: "  观战也能说话  ",
    });
    await handler.handleMessage("u8", "Dave", "room:chat:send", {
      text: "预约中",
    });

    const broadcasts = chatMessages(gateway.sent);
    expect(broadcasts).toHaveLength(2);
    expect(
      (broadcasts[0].payload as { message: { text: string } }).message.text,
    ).toBe("观战也能说话");
    expect(
      (broadcasts[1].payload as { message: { userId: string } }).message.userId,
    ).toBe("u8");
  });

  it("ignores client-supplied identity fields and never echoes them", async () => {
    await joinSeated("u1", "Alice");
    gateway.sent.length = 0;

    await handler.handleMessage("u1", "Alice", "room:chat:send", {
      text: "伪造身份",
      userId: "someone-else",
      username: "Mallory",
      roomId: "main",
      sentAt: 1,
      id: "forged-id",
    });

    const broadcasts = chatMessages(gateway.sent);
    expect(broadcasts).toHaveLength(1);
    const message = (
      broadcasts[0].payload as { message: Record<string, unknown> }
    ).message;
    expect(message.userId).toBe("u1");
    expect(message.username).toBe("Alice");
    expect(message.id).not.toBe("forged-id");
    expect(message.sentAt).not.toBe(1);
  });

  it("rejects empty and whitespace-only messages without broadcasting", async () => {
    await joinSeated("u1", "Alice");
    gateway.sent.length = 0;

    for (const text of ["", "   ", "\n\t"]) {
      await handler.handleMessage("u1", "Alice", "room:chat:send", { text });
    }
    await handler.handleMessage("u1", "Alice", "room:chat:send", {});

    expect(chatMessages(gateway.sent)).toHaveLength(0);
    const errors = gateway.sent.filter(
      (message) =>
        message.userId === "u1" &&
        message.type === "room:error" &&
        (message.payload as { code: string }).code === "CHAT_EMPTY",
    );
    expect(errors).toHaveLength(4);
  });

  it("enforces the 200 visible-character limit, counting emoji as one", async () => {
    await joinSeated("u1", "Alice");
    gateway.sent.length = 0;

    await handler.handleMessage("u1", "Alice", "room:chat:send", {
      text: "中".repeat(MAX_CHAT_LENGTH),
    });
    await handler.handleMessage("u1", "Alice", "room:chat:send", {
      text: "😀".repeat(MAX_CHAT_LENGTH),
    });
    expect(chatMessages(gateway.sent)).toHaveLength(2);

    await handler.handleMessage("u1", "Alice", "room:chat:send", {
      text: "中".repeat(MAX_CHAT_LENGTH + 1),
    });
    expect(chatMessages(gateway.sent)).toHaveLength(2);
    expect(
      gateway.sent.some(
        (message) =>
          message.userId === "u1" &&
          message.type === "room:error" &&
          (message.payload as { code: string }).code === "CHAT_TOO_LONG",
      ),
    ).toBe(true);
  });

  it("rejects senders who are not in any room", async () => {
    gateway.sent.length = 0;

    await handler.handleMessage("u42", "Mallory", "room:chat:send", {
      text: "有人吗",
    });

    expect(chatMessages(gateway.sent)).toHaveLength(0);
    expect(
      gateway.sent.some(
        (message) =>
          message.userId === "u42" &&
          message.type === "room:error" &&
          (message.payload as { code: string }).code === "NOT_IN_ROOM",
      ),
    ).toBe(true);
  });

  it("never leaks a chat broadcast into another room", async () => {
    await joinSeated("u1", "Alice");

    const otherRoom = new Room("side", { ...room.settings });
    roomManager["rooms"].set("side", otherRoom);
    try {
      otherRoom.addPlayer("u7", "Eve");
      gateway.sent.length = 0;

      await handler.handleMessage("u1", "Alice", "room:chat:send", {
        text: "只在主房间",
      });

      const broadcasts = chatMessages(gateway.sent);
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0].userIds).not.toContain("u7");

      // And a member of the other room only reaches that room.
      await handler.handleMessage("u7", "Eve", "room:chat:send", {
        text: "只在侧房间",
      });
      const second = chatMessages(gateway.sent)[1];
      expect(second.userIds).toEqual(["u7"]);
      expect(second.userIds).not.toContain("u1");
    } finally {
      roomManager["rooms"].delete("side");
    }
  });

  it("keeps chat out of the room detail snapshot", async () => {
    await joinSeated("u1", "Alice");
    await handler.handleMessage("u1", "Alice", "room:chat:send", {
      text: "快照无关",
    });

    const detail = room.toDetail() as Record<string, unknown>;
    expect(detail).not.toHaveProperty("chatMessages");
    expect(JSON.stringify(detail)).not.toContain("快照无关");
  });
});
