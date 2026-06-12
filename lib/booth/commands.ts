// Shared shape of god-mode commands. Lives in its own file so both the server
// action (authority) and the client host (applies server-origin events) agree —
// WITHOUT the client importing any server/auth code.

export type AdminCmd =
  | { kind: "forceSkip" }
  | { kind: "clearCue" }
  | { kind: "removeCue"; recordKey: string }
  | { kind: "pin"; track: AdminTrack } // play next (front of cue)
  | { kind: "forcePlay"; track: AdminTrack } // play right now
  | { kind: "lockCue"; locked: boolean }
  | { kind: "onAir"; live: boolean; dj?: string | null };

export interface AdminTrack {
  id?: string;
  title: string;
  artist: string;
  ytId?: string;
  scUrl?: string;
}

/** the Realtime broadcast event name carrying a server-verified admin command */
export const ADMIN_EVENT = "admin";
export const BAR_CHANNEL = "hallucinate-bar";
