import { ref } from "vue";
import { Room, RoomEvent, type RemoteParticipant } from "livekit-client";

export interface VoiceParticipant {
  identity: string;
  name: string;
  muted: boolean;
  speaking: boolean;
}

const isConnected = ref(false);
const isMuted = ref(false);
const participants = ref<VoiceParticipant[]>([]);
let room: Room | null = null;

export function useVoice() {
  async function connect(url: string, token: string) {
    if (room) disconnect();

    room = new Room({
      adaptiveStream: false,
      dynacast: false,
    });

    room.on(RoomEvent.Connected, () => {
      isConnected.value = true;
      updateParticipants();
    });

    room.on(RoomEvent.Disconnected, () => {
      isConnected.value = false;
      participants.value = [];
    });

    room.on(RoomEvent.ParticipantConnected, () => updateParticipants());
    room.on(RoomEvent.ParticipantDisconnected, () => updateParticipants());
    room.on(RoomEvent.TrackMuted, () => updateParticipants());
    room.on(RoomEvent.TrackUnmuted, () => updateParticipants());
    room.on(RoomEvent.ActiveSpeakersChanged, () => updateParticipants());

    try {
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      isMuted.value = false;
    } catch {
      isConnected.value = false;
      room = null;
    }
  }

  function disconnect() {
    if (room) {
      room.disconnect();
      room = null;
    }
    isConnected.value = false;
    isMuted.value = false;
    participants.value = [];
  }

  function toggleMute() {
    if (!room) return;
    const local = room.localParticipant;
    if (isMuted.value) {
      local.setMicrophoneEnabled(true);
      isMuted.value = false;
    } else {
      local.setMicrophoneEnabled(false);
      isMuted.value = true;
    }
    updateParticipants();
  }

  function updateParticipants() {
    if (!room) return;
    const activeSpeakers = new Set(room.activeSpeakers.map((s) => s.identity));

    const list: VoiceParticipant[] = [];

    const local = room.localParticipant;
    list.push({
      identity: local.identity,
      name: local.name || local.identity,
      muted: !local.isMicrophoneEnabled,
      speaking: activeSpeakers.has(local.identity),
    });

    for (const [, remote] of room.remoteParticipants) {
      const p = remote as RemoteParticipant;
      list.push({
        identity: p.identity,
        name: p.name || p.identity,
        muted: !p.isMicrophoneEnabled,
        speaking: activeSpeakers.has(p.identity),
      });
    }

    participants.value = list;
  }

  return { isConnected, isMuted, participants, connect, disconnect, toggleMute };
}
