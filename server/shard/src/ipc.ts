/** IPC messages between the shard host and its RoomHost child processes. */
import type { CharacterSnapshot, RoomAdminInfo, RoomState } from "@fantasy-mmo/common";

export type HostToRoom =
  | { t: "init"; roomId: string; port: number; snapshot: RoomState | null }
  | { t: "ticket"; ticket: string; expiresAt: number; character: CharacterSnapshot }
  | { t: "transferGrant"; characterId: string; targetRoomId: string; wsUrl: string; ticket: string }
  | { t: "transferDeny"; characterId: string; reason: string }
  | { t: "globalChat"; from: string; text: string }
  | { t: "roomStatus"; roomId: string; open: boolean; reopenInSec?: number }
  | { t: "kick"; characterId: string; reason: string }
  | { t: "adminMove"; characterId: string; targetRoomId: string; x?: number; z?: number }
  | { t: "requestMap" }
  | { t: "close"; reason: string };

export type RoomToHost =
  | { t: "ready"; port: number }
  | { t: "stats"; players: number; info?: RoomAdminInfo }
  | { t: "report"; characters: Array<{ id: string } & Record<string, unknown>>; roomState?: RoomState }
  | {
      t: "requestTransfer";
      characterId: string;
      targetRoomId: string;
      viaPortalId?: string;
      /** admin teleport: arrival coordinates in the target room */
      arrival?: { x: number; z: number };
      patch: { id: string } & Record<string, unknown>;
    }
  /** top-down map render (base64 raw-deflate RGB) for the admin dashboard */
  | { t: "mapData"; w: number; h: number; data: string }
  | { t: "globalChat"; from: string; text: string }
  /** announced before a deliberate exit so the master learns the real reason */
  | { t: "closing"; reason: string };
