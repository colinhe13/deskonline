import { defineStore } from "pinia";
import { ref } from "vue";

export interface ProfileStats {
  hands: number;
  vpip: number | null;
  pfr: number | null;
  threeBet: number | null;
  af: number | null;
  foldToRaise: number | null;
  wtsd: number | null;
}

export interface ProfileView {
  userId: string;
  username: string;
  isAi: boolean;
  hands: number;
  ready: boolean;
  stats: ProfileStats | null;
  note: string | null;
}

export const useProfilesStore = defineStore("profiles", () => {
  const profiles = ref<Record<string, ProfileView>>({});

  function applyProfiles(list: ProfileView[] | null | undefined) {
    const next: Record<string, ProfileView> = {};
    for (const p of list ?? []) next[p.userId] = p;
    profiles.value = next;
  }

  function clearProfiles() {
    profiles.value = {};
  }

  return { profiles, applyProfiles, clearProfiles };
});
