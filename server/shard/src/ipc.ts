/** IPC messages between the shard host and its RoomHost child processes. */
import type { CharacterSnapshot, RoomState } from "@fantasy-mmo/common";

export type HostToRoom =
  | { t: "init"; roomId: string; port: number; snapshot: RoomState | null }
  | { t: "ticket"; ticket: string; expiresAt: number; character: CharacterSnapshot }
  | { t: "transferGrant"; characterId: string; targetRoomId: string; wsUrl: string; ticket: string }
  | { t: "transferDeny"; characterId: string; reason: string }
  | { t: "globalChat"; from: string; text: string }
  | { t: "roomStatus"; roomId: string; open: boolean }
  | { t: "close"; reason: string };

export type RoomToHost =
  | { t: "ready"; port: number }
  | { t: "stats"; players: number }
  | { t: "report"; characters: Array<{ id: string } & Record<string, unknown>>; roomState?: RoomState }
  | { t: "requestTransfer"; characterId: string; targetRoomId: string; viaPortalId?: string; patch: { id: string } & Record<string, unknown> }
  | { t: "globalChat"; from: string; text: string }
  /** announced before a deliberate exit so the master learns the real reason */
  | { t: "closing"; reason: string };
