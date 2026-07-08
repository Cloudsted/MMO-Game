/**
 * Block registry loader + voxel world constants. Mirrors the client's
 * BlockRegistry.java — both read shared/blocks.json. Block IDs are
 * append-only (persisted room edits store raw ids).
 */
import { z } from "zod";
/** Chunk width/depth in blocks (wire + client meshing unit). */
export declare const CHUNK = 16;
/** World height in blocks — every room shares it. */
export declare const WORLD_HEIGHT = 48;
declare const BlockDefSchema: z.ZodObject<{
    id: z.ZodNumber;
    name: z.ZodString;
    label: z.ZodString;
    solid: z.ZodBoolean;
    kind: z.ZodEnum<["cube", "cross"]>;
    cull: z.ZodEnum<["opaque", "cutout", "liquid", "none"]>;
    glow: z.ZodOptional<z.ZodBoolean>;
    /** cross blocks bend in the wind. Default: true for a non-glow cross block
     *  (grass, flowers, vines). A hanging chain or a pile of skulls does not
     *  sway, and neither does a torch — set false. */
    sway: z.ZodOptional<z.ZodBoolean>;
    light: z.ZodOptional<z.ZodNumber>;
    tex: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    /** client sound-group suffixes (manifest names step_X/break_X/place_X) */
    sounds: z.ZodOptional<z.ZodObject<{
        step: z.ZodOptional<z.ZodString>;
        break: z.ZodOptional<z.ZodString>;
        place: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        step?: string | undefined;
        break?: string | undefined;
        place?: string | undefined;
    }, {
        step?: string | undefined;
        break?: string | undefined;
        place?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    id: number;
    name: string;
    label: string;
    solid: boolean;
    kind: "cube" | "cross";
    cull: "opaque" | "cutout" | "liquid" | "none";
    glow?: boolean | undefined;
    sway?: boolean | undefined;
    light?: number | undefined;
    tex?: Record<string, string> | undefined;
    sounds?: {
        step?: string | undefined;
        break?: string | undefined;
        place?: string | undefined;
    } | undefined;
}, {
    id: number;
    name: string;
    label: string;
    solid: boolean;
    kind: "cube" | "cross";
    cull: "opaque" | "cutout" | "liquid" | "none";
    glow?: boolean | undefined;
    sway?: boolean | undefined;
    light?: number | undefined;
    tex?: Record<string, string> | undefined;
    sounds?: {
        step?: string | undefined;
        break?: string | undefined;
        place?: string | undefined;
    } | undefined;
}>;
export type BlockDef = z.infer<typeof BlockDefSchema>;
/** Dense array indexed by block id. */
export declare const BLOCKS: BlockDef[];
/** name -> def */
export declare const BLOCK: Record<string, BlockDef>;
export declare function isSolidBlock(id: number): boolean;
export declare function isLiquidBlock(id: number): boolean;
/** How much a block dims light passing through (15 = fully blocks it). */
export declare function blockOpacity(id: number): number;
export {};
//# sourceMappingURL=blocks.d.ts.map