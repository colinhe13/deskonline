import { describe, it, expect } from "vitest";
import { Room } from "../lobby/room.js";
import { RoomManager } from "../lobby/room.manager.js";

function makeRoom(maxPlayers = 9) {
  return new Room("main", {
    maxPlayers,
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 200,
    maxBuyIn: 2000,
  });
}

describe("Room system model", () => {
  it("first entrant becomes host", () => {
    const room = makeRoom();
    expect(room.hostId).toBeNull();
    room.addPlayer("u1", "P1");
    expect(room.hostId).toBe("u1");
    room.addPlayer("u2", "P2");
    expect(room.hostId).toBe("u1"); // unchanged
  });

  it("host succession follows entry order when host leaves", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    room.addPlayer("u2", "P2");
    room.addPlayer("u3", "P3");
    expect(room.hostId).toBe("u1");

    room.removePlayer("u1");
    expect(room.hostId).toBe("u2"); // next by entry order

    room.removePlayer("u3");
    expect(room.hostId).toBe("u2"); // u2 still host

    room.removePlayer("u2");
    expect(room.hostId).toBeNull(); // empty room
  });

  it("transferHost moves host to a seated player only", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    room.addPlayer("u2", "P2");

    expect(room.transferHost("u2")).toBe(true);
    expect(room.hostId).toBe("u2");

    expect(room.transferHost("ghost")).toBe(false);
    expect(room.hostId).toBe("u2");
  });

  it("confirmBuyIn sets chips, buyIn and confirmed flag", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    const seat = room.findSeatByUserId("u1")!;
    expect(seat.confirmed).toBe(false);
    expect(seat.chips).toBe(0);

    room.confirmBuyIn("u1", 500);
    expect(seat.confirmed).toBe(true);
    expect(seat.chips).toBe(500);
    expect(seat.buyIn).toBe(500);
    expect(room.confirmedCount).toBe(1);
  });

  it("clearConfirmations refunds committed chips and resets seats", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    room.addPlayer("u2", "P2");
    room.confirmBuyIn("u1", 500);
    room.confirmBuyIn("u2", 300);

    const refunds = room.clearConfirmations();
    expect(refunds).toEqual([
      { userId: "u1", chips: 500 },
      { userId: "u2", chips: 300 },
    ]);
    expect(room.confirmedCount).toBe(0);
    expect(room.findSeatByUserId("u1")!.chips).toBe(0);
    expect(room.findSeatByUserId("u1")!.confirmed).toBe(false);
  });

  it("addPlayer marks AI seats and helpers split humans/AI", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    room.addPlayer("ai1", "AI_XiaoZhi", true);

    expect(room.findSeatByUserId("ai1")!.isAi).toBe(true);
    expect(room.findSeatByUserId("u1")!.isAi).toBe(false);
    expect(room.aiSeats()).toHaveLength(1);
    expect(room.humanSeats()).toHaveLength(1);
    expect(room.hasHuman()).toBe(true);

    room.removePlayer("u1");
    expect(room.hasHuman()).toBe(false);
    // removePlayer clears the AI flag so the seat can be reused.
    room.removePlayer("ai1");
    expect(room.seats.every((s) => !s.isAi)).toBe(true);
  });

  it("toSummary exposes autoResume", () => {
    const room = makeRoom();
    expect(room.toSummary().autoResume).toBe(false);
    room.autoResume = true;
    expect(room.toSummary().autoResume).toBe(true);
  });

  it("confirmedSeats returns only confirmed players", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    room.addPlayer("u2", "P2");
    room.confirmBuyIn("u1", 200);
    const seats = room.confirmedSeats();
    expect(seats).toHaveLength(1);
    expect(seats[0].userId).toBe("u1");
  });

  it("removePlayer refunds chips and clears the seat", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    room.confirmBuyIn("u1", 800);
    const refunded = room.removePlayer("u1");
    expect(refunded).toBe(800);
    expect(room.playerCount).toBe(0);
    expect(room.findSeatByUserId("u1")).toBeUndefined();
  });

  it("moveSeat transfers a player to an empty seat with their state", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    room.confirmBuyIn("u1", 500);
    const originalIndex = room.findSeatByUserId("u1")!.index;
    const targetIndex = (originalIndex + 1) % 9;

    expect(room.moveSeat("u1", targetIndex)).toBe(true);
    const seat = room.findSeatByUserId("u1")!;
    expect(seat.index).toBe(targetIndex);
    expect(seat.chips).toBe(500);
    expect(seat.confirmed).toBe(true);
    expect(room.seats[originalIndex].userId).toBeNull();
  });

  it("moveSeat rejects occupied seats and invalid indices", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    room.addPlayer("u2", "P2");
    const u2Index = room.findSeatByUserId("u2")!.index;

    expect(room.moveSeat("u1", u2Index)).toBe(false);
    expect(room.moveSeat("u1", 99)).toBe(false);
    expect(room.findSeatByUserId("u1")).toBeDefined();
  });

  it("isFull respects maxPlayers", () => {
    const room = makeRoom(2);
    room.addPlayer("u1", "P1");
    expect(room.isFull).toBe(false);
    room.addPlayer("u2", "P2");
    expect(room.isFull).toBe(true);
    expect(() => room.addPlayer("u3", "P3")).toThrow("ROOM_FULL");
  });

  it("toDetail exposes hostId, confirmed and buyIn per seat", () => {
    const room = makeRoom(3);
    room.addPlayer("u1", "P1");
    room.confirmBuyIn("u1", 400);
    const detail = room.toDetail();
    expect(detail.hostId).toBe("u1");
    expect(detail.seats).toHaveLength(3);
    const s1 = detail.seats.find((s) => s.userId === "u1")!;
    expect(s1.confirmed).toBe(true);
    expect(s1.buyIn).toBe(400);
  });

  it("tracks auto-management and clears it on reconnect", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    const seat = room.findSeatByUserId("u1")!;

    room.markDisconnected("u1");
    expect(room.markAutoManaged("u1")).toBe(true);
    expect(room.toDetail().seats[0]).toMatchObject({
      connected: false,
      autoManaged: true,
    });

    room.markReconnected("u1");
    expect(seat).toMatchObject({ connected: true, autoManaged: false });
  });
});

describe("RoomManager defaults", () => {
  it("system room uses default blinds/buy-in 1/2/150/750", () => {
    const manager = new RoomManager();
    const room = manager.getSystemRoom();
    expect(room.settings).toEqual({
      maxPlayers: 9,
      smallBlind: 1,
      bigBlind: 2,
      minBuyIn: 150,
      maxBuyIn: 750,
    });
  });
});

describe("Room spectators", () => {
  it("addSpectator dedupes; removeSpectator/isSpectator behave", () => {
    const room = makeRoom();
    expect(room.isSpectator("s1")).toBe(false);

    room.addSpectator("s1", "Watcher");
    room.addSpectator("s1", "Watcher"); // duplicate is a no-op
    expect(room.spectators).toHaveLength(1);
    expect(room.isSpectator("s1")).toBe(true);

    expect(room.removeSpectator("s1")).toBe(true);
    expect(room.removeSpectator("s1")).toBe(false);
    expect(room.isSpectator("s1")).toBe(false);
  });

  it("spectators do not occupy seats or count as players", () => {
    const room = makeRoom(2);
    room.addSpectator("s1", "Watcher");
    expect(room.playerCount).toBe(0);
    expect(room.isFull).toBe(false);
    expect(room.hostId).toBeNull();
  });

  it("toSummary/toDetail expose spectatorCount and spectators", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1");
    room.addSpectator("s1", "Watcher");

    expect(room.toSummary().spectatorCount).toBe(1);
    const detail = room.toDetail();
    expect(detail.spectators).toEqual([{ userId: "s1", username: "Watcher" }]);
  });

  it("broadcast reaches connected seats plus spectators", () => {
    const room = makeRoom();
    room.addPlayer("u1", "P1"); // connected on add
    room.addPlayer("u2", "P2");
    room.markDisconnected("u2");
    room.addSpectator("s1", "Watcher");

    const calls: { ids: string[]; type: string }[] = [];
    const fakeGateway = {
      broadcast: (ids: string[], type: string) => {
        calls.push({ ids, type });
      },
    };
    room.broadcast(fakeGateway as never, "room:state", {});

    expect(calls).toHaveLength(1);
    expect(calls[0].ids.sort()).toEqual(["s1", "u1"]);
  });
});

describe("RoomManager spectator lookup", () => {
  it("findRoomBySpectator locates the room a user spectates", () => {
    const manager = new RoomManager();
    const room = manager.getSystemRoom();
    expect(manager.findRoomBySpectator("s1")).toBeUndefined();

    room.addSpectator("s1", "Watcher");
    expect(manager.findRoomBySpectator("s1")).toBe(room);
    // A seated player is not a spectator.
    room.addPlayer("u1", "P1");
    expect(manager.findRoomBySpectator("u1")).toBeUndefined();
  });

  it("findRoomByPendingSeatReservation locates a queued spectator", () => {
    const manager = new RoomManager();
    const room = manager.getSystemRoom();
    room.addPendingSeatReservation("s1", "Watcher", 2, 300, "op-1");

    expect(manager.findRoomByPendingSeatReservation("s1")).toBe(room);
    expect(manager.findRoomByPendingSeatReservation("missing")).toBeUndefined();
  });
});

describe("Room pending seat reservations", () => {
  it("reserves an empty seat without counting the user as an active player", () => {
    const room = makeRoom(3);
    room.addPlayer("u1", "P1");

    const reservation = room.addPendingSeatReservation(
      "u2",
      "P2",
      2,
      500,
      "op-1",
    );

    expect(reservation.status).toBe("pending");
    expect(room.playerCount).toBe(1);
    expect(room.confirmedCount).toBe(0);
    expect(room.isSeatReserved(2)).toBe(true);
    expect(room.toDetail().pendingSeatReservations).toEqual([
      { userId: "u2", username: "P2", seatIndex: 2, status: "pending" },
    ]);
  });

  it("rejects duplicate users and competing seats", () => {
    const room = makeRoom(3);
    room.addPendingSeatReservation("u1", "P1", 1, 500, "op-1");

    expect(() =>
      room.addPendingSeatReservation("u1", "P1", 2, 500, "op-2"),
    ).toThrow("PENDING_JOIN_EXISTS");
    expect(() =>
      room.addPendingSeatReservation("u2", "P2", 1, 500, "op-3"),
    ).toThrow("SEAT_TAKEN");
    expect(() =>
      room.addPendingSeatReservation("u3", "P3", 3, 500, "op-4"),
    ).toThrow("INVALID_SEAT");
  });

  it("activates the reserved seat with the held buy-in state", () => {
    const room = makeRoom(3);
    room.addPendingSeatReservation("u1", "P1", 2, 500, "op-1");

    const result = room.activatePendingSeatReservation("u1");

    expect(result.seat.index).toBe(2);
    expect(result.seat.userId).toBe("u1");
    expect(result.seat.chips).toBe(500);
    expect(result.seat.confirmed).toBe(true);
    expect(result.seat.buyInHoldOperationId).toBe("op-1");
    expect(room.findPendingSeatReservation("u1")).toBeUndefined();
  });
});
