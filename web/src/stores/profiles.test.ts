import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useProfilesStore } from "./profiles";
import type { ProfileView } from "./profiles";

function view(overrides: Partial<ProfileView> = {}): ProfileView {
  return {
    userId: "u1",
    username: "Alice",
    isAi: false,
    hands: 6,
    ready: true,
    stats: {
      hands: 6,
      vpip: 50,
      pfr: 16.7,
      threeBet: null,
      af: 2.5,
      foldToRaise: 40,
      wtsd: 33.3,
    },
    note: "偏松凶",
    ...overrides,
  };
}

describe("profiles store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts empty", () => {
    const store = useProfilesStore();
    expect(store.profiles).toEqual({});
  });

  it("applies a profile list keyed by userId", () => {
    const store = useProfilesStore();
    store.applyProfiles([view(), view({ userId: "u2", username: "Bob" })]);

    expect(Object.keys(store.profiles)).toEqual(["u1", "u2"]);
    expect(store.profiles["u2"]?.username).toBe("Bob");
  });

  it("replaces the map entirely on each snapshot", () => {
    const store = useProfilesStore();
    store.applyProfiles([view(), view({ userId: "u2" })]);
    store.applyProfiles([view({ userId: "u3" })]);

    expect(Object.keys(store.profiles)).toEqual(["u3"]);
  });

  it("tolerates null/undefined payloads", () => {
    const store = useProfilesStore();
    store.applyProfiles([view()]);
    store.applyProfiles(null);
    expect(store.profiles).toEqual({});

    store.applyProfiles(undefined);
    expect(store.profiles).toEqual({});
  });

  it("clears all profiles on leave/room switch", () => {
    const store = useProfilesStore();
    store.applyProfiles([view()]);
    store.clearProfiles();
    expect(store.profiles).toEqual({});
  });
});
