import { AccessToken } from "livekit-server-sdk";
import { config } from "../config.js";

export class LiveKitService {
  private apiKey: string;
  private apiSecret: string;
  private url: string;

  constructor() {
    this.apiKey = config.livekitApiKey;
    this.apiSecret = config.livekitApiSecret;
    this.url = config.livekitUrl;
  }

  async generateToken(roomName: string, identity: string, username: string): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      name: username,
      ttl: "24h",
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    return await at.toJwt();
  }

  getRoomName(tableRoomId: string): string {
    return `table-${tableRoomId}`;
  }

  getClientUrl(): string {
    return this.url.replace("ws://", "http://").replace("wss://", "https://");
  }
}

export const livekitService = new LiveKitService();
