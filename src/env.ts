import type { Channel } from "./channel";

export interface Env {
  ASSETS: Fetcher;
  AI: Ai;
  CHANNEL: DurableObjectNamespace<Channel>;
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}
