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
