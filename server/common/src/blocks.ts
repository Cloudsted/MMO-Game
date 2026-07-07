/**
 * Block registry loader + voxel world constants. Mirrors the client's
 * BlockRegistry.java — both read shared/blocks.json. Block IDs are
 * append-only (persisted room edits store raw ids).
 */
import { z } from "zod";
import { resolve } from "node:path";
import { readJsonFile } from "./json.js";
import { SHARED_DIR } from "./paths.js";

/** Chunk width/depth in blocks (wire + client meshing unit). */
export const CHUNK = 16;
/** World height in blocks — every room shares it. */
export const WORLD_HEIGHT = 48;

const BlockDefSchema = z.object({
  id: z.number().int().min(0).max(255),
  name: z.string(),
  label: z.string(),
  solid: z.boolean(),
  kind: z.enum(["cube", "cross"]),
  cull: z.enum(["opaque", "cutout", "liquid", "none"]),
  glow: z.boolean().optional(),
  light: z.number().int().min(0).max(15).optional(),
  tex: z.record(z.string(), z.string()).optional(),
  /** client sound-group suffixes (manifest names step_X/break_X/place_X) */
  sounds: z
    .object({ step: z.string().optional(), break: z.string().optional(), place: z.string().optional() })
    .optional(),
});
export type BlockDef = z.infer<typeof BlockDefSchema>;

const BlocksFileSchema = z.object({
  comment: z.string().optional(),
  blocks: z.array(BlockDefSchema),
});

/** Dense array indexed by block id. */
export const BLOCKS: BlockDef[] = [];
/** name -> def */
export const BLOCK: Record<string, BlockDef> = {};

{
  const file = BlocksFileSchema.parse(readJsonFile(resolve(SHARED_DIR, "blocks.json")));
  for (const def of file.blocks) {
    if (BLOCKS[def.id]) throw new Error(`duplicate block id ${def.id}`);
    BLOCKS[def.id] = def;
    BLOCK[def.name] = def;
  }
}

export function isSolidBlock(id: number): boolean {
  const b = BLOCKS[id];
  return !!b && b.solid;
}

export function isLiquidBlock(id: number): boolean {
  const b = BLOCKS[id];
  return !!b && b.cull === "liquid";
}

/** How much a block dims light passing through (15 = fully blocks it). */
export function blockOpacity(id: number): number {
  const b = BLOCKS[id];
  if (!b || b.cull === "none") return 1;
  if (b.cull === "opaque") return 15;
  if (b.cull === "liquid" || b.name === "leaves") return 3;
  return 1; // cutout/cross
}
