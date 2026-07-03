/** IPC messages between the shard host and its RoomHost child processes. */
import type { CharacterSnapshot, RoomState } from "@fantasy-mmo/common";

export type HostToRoom =
  | { t: "init"; roomId: string; port: number; snapshot: RoomState | null }
  | { t: "ticket"; ticket: string; expiresAt: number; character: CharacterSnapshot }
  | { t: "transferGrant"; characterId: string; targetRoomId: string; wsUrl: string; ticket: string }
  | { t: "transferDeny"; characterId: string; reason: string }
  | { t: "close"; reason: string };

export type RoomToHost =
  | { t: "ready"; port: number }
  | { t: "stats"; players: number }
  | { t: "report"; characters: Array<{ id: string } & Record<string, unknown>>; roomState?: RoomState }
  | { t: "requestTransfer"; characterId: string; targetRoomId: string; patch: { id: string } & Record<string, unknown> };
