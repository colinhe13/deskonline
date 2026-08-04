import { config } from "../../config.js";
import type { HandRecord, OpponentProfile, ProfileView } from "./types.js";
import { applyHandToStats, computeRates, createStats } from "./stats.js";

const RECENT_RECORDS_KEPT = 5;

export class ProfileStore {
  private rooms = new Map<string, Map<string, OpponentProfile>>();
  private recentRecords = new Map<string, Map<string, HandRecord[]>>();

  recordHand(
    roomId: string,
    userId: string,
    username: string,
    record: HandRecord,
  ): void {
    let profiles = this.rooms.get(roomId);
    if (!profiles) {
      profiles = new Map();
      this.rooms.set(roomId, profiles);
    }
    let profile = profiles.get(userId);
    if (!profile) {
      profile = {
        userId,
        username,
        stats: createStats(),
        note: null,
        handsSinceLastSummary: 0,
        lastUpdatedAt: new Date().toISOString(),
      };
      profiles.set(userId, profile);
    }
    profile.username = username;
    applyHandToStats(profile.stats, record, userId);
    profile.handsSinceLastSummary += 1;
    profile.lastUpdatedAt = new Date().toISOString();

    let recordsByUser = this.recentRecords.get(roomId);
    if (!recordsByUser) {
      recordsByUser = new Map();
      this.recentRecords.set(roomId, recordsByUser);
    }
    const list = recordsByUser.get(userId) ?? [];
    list.push(record);
    while (list.length > RECENT_RECORDS_KEPT) list.shift();
    recordsByUser.set(userId, list);
  }

  getProfile(roomId: string, userId: string): OpponentProfile | undefined {
    return this.rooms.get(roomId)?.get(userId);
  }

  getRecentRecords(roomId: string, userId: string): HandRecord[] {
    return this.recentRecords.get(roomId)?.get(userId) ?? [];
  }

  setNote(roomId: string, userId: string, note: string): void {
    const profile = this.rooms.get(roomId)?.get(userId);
    if (!profile) return;
    profile.note = note;
    profile.handsSinceLastSummary = 0;
    profile.lastUpdatedAt = new Date().toISOString();
  }

  listProfiles(roomId: string): OpponentProfile[] {
    return [...(this.rooms.get(roomId)?.values() ?? [])];
  }

  getViews(roomId: string): ProfileView[] {
    return this.listProfiles(roomId).map((p) => toView(p));
  }

  clearRoom(roomId: string): void {
    this.rooms.delete(roomId);
    this.recentRecords.delete(roomId);
  }
}

export function toView(profile: OpponentProfile): ProfileView {
  const ready = profile.stats.hands >= config.aiProfileMinHands;
  return {
    userId: profile.userId,
    username: profile.username,
    isAi: false,
    hands: profile.stats.hands,
    ready,
    stats: ready ? computeRates(profile.stats) : null,
    note: ready ? profile.note : null,
  };
}

export const profileStore = new ProfileStore();
