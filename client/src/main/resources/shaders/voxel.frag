#ifdef GL_ES
precision mediump float;
#endif

// Voxel world shader: baked per-vertex (skylight, blocklight) combined with
// the live sun level — cool moonlit-blue skylight, warm amber blocklight,
// max() of the two, quadratic falloff, floor 0.045. lightColor() in
// VoxelLighting.java is the CPU mirror of this curve — change together.
//
// Directional shadows: a packed-depth shadow map from the active celestial
// light dims the SKYLIGHT term only (u_shadowDim), so torch pools still glow
// inside cast shadows and caves stay governed by the voxel light.
//
// NORMALS ARE EXACT, NOT DERIVED. Block faces are axis-aligned and the
// mesher knows each quad's direction, so it bands the face id into a_br
// (see the decode below and ChunkMesher's layout doc). The original design
// derived the normal from screen-space derivatives ("exact for blocks") —
// but dFdx/dFdy are per-2x2-pixel-quad and go garbage at mesh-seam and
// silhouette quads even on perfectly coplanar faces (LESSONS.md): facing-
// away pixels leaked into the sampled branch with tanθ at its cap, which
// was the whole residual artifact class — noon acne DOTS on grazing faces,
// lit SEAM LINES around edge blocks of walls/pillars, and noisy per-pixel
// branch/bias flips feeding distant shimmer. With the exact normal the
// facing-away test is exact — a true back face NEVER samples the map, so
// back-face acne is impossible — and the slope bias uses the exact tanθ.
// Lit faces compare with a slope-scaled bias in METERS so edges stay within
// ~2 texels of the caster at every sun angle (a constant bias in normalized
// depth was ~0.9 m here — it slid every shadow edge more than a block off
// its corner). Crossed plants have no single normal (two quads, double-
// sided, wind-bent): they keep the derivative normal with |ndl|.

varying vec2 v_uv;
varying float v_br;
varying vec2 v_light;
varying float v_dist;
varying vec3 v_worldPos;

uniform sampler2D u_tiles;
uniform sampler2D u_shadowMap;    // world geometry (cached between sun steps)
uniform sampler2D u_entShadowMap; // entity sprite quads (re-drawn every frame)
uniform mat4 u_shadowMat;
uniform float u_shadowDim;   // skylight multiplier inside shadow (1 = off)
uniform float u_shadowDebug; // 1 = visualize the light-space compare
uniform vec3 u_lightDir;     // FROM light TOWARD ground (quantized shadow dir)
uniform float u_shadowTexel; // one shadow-map texel in world meters
uniform float u_shadowRange; // light-camera far-near in meters
uniform float u_shadowPix;   // one world-map texel in UV units (1/res)
uniform float u_entShadowPix; // one ENTITY-map texel in UV units (half-res map)
uniform float u_sun;        // 0 night .. 1 day
uniform float u_nightLight; // per-room multiplier on the night skylight floor
uniform float u_fullbright; // glow pass: skip lighting entirely
uniform float u_alpha;      // 1 solid, <1 water
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;

float unpackDepth(vec4 c) {
    return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

// BILINEAR-WEIGHTED PCF TAP (shadow anti-aliasing). Unpacks the FOUR texels
// around the sample point, compares each against ref (binary), and blends
// the COMPARE RESULTS by the sub-texel position. Never filter the packed
// depths themselves — RGBA8-packed depth is not linearly filterable; this
// is the classic emulation of hardware PCF. The payoff: a tap is a
// CONTINUOUS function of the sample point, so shadow edges become a smooth
// exactly-one-texel ramp instead of a texel staircase, and sub-pixel camera
// motion can no longer snap a tap between texels (the wave-5 residual
// shimmer channel). pix = one texel of THIS map in UV units.
float litBilin(sampler2D map, vec2 uv, float pix, float ref) {
    vec2 t = uv / pix - 0.5;
    vec2 b = floor(t);
    vec2 f = t - b;
    vec2 c = (b + 0.5) * pix;
    float s00 = step(ref, unpackDepth(texture2D(map, c)));
    float s10 = step(ref, unpackDepth(texture2D(map, c + vec2(pix, 0.0))));
    float s01 = step(ref, unpackDepth(texture2D(map, c + vec2(0.0, pix))));
    float s11 = step(ref, unpackDepth(texture2D(map, c + vec2(pix, pix))));
    return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

// Footprint-integrating lit fraction over the WORLD map: at the near floor
// (spreadTex == 1) a SINGLE bilinear tap — a tight 1-texel smooth edge,
// crisper than the old 3x3 binary staircase; beyond it, 3x3 bilinear taps
// at spacing (spreadTex-1) texels with tent weights (1-2-1)^2/16, which
// converges EXACTLY to the single tap as the spacing goes to 0 (no visible
// regime seam — the branch below is purely a fetch-count shortcut).
float litFraction(vec2 uv, float spreadTex, float ref) {
    float h = (spreadTex - 1.0) * u_shadowPix; // tap spacing in UV; 0 at floor
    if (h < u_shadowPix * 0.25) {
        return litBilin(u_shadowMap, uv, u_shadowPix, ref);
    }
    float acc = 0.0;
    for (int oy = -1; oy <= 1; oy++) {
        for (int ox = -1; ox <= 1; ox++) {
            float w = (2.0 - abs(float(ox))) * (2.0 - abs(float(oy)));
            acc += w * litBilin(u_shadowMap, uv + vec2(float(ox), float(oy)) * h, u_shadowPix, ref);
        }
    }
    return acc / 16.0;
}

void main() {
    vec4 tex = texture2D(u_tiles, v_uv);
    if (tex.a < 0.5) discard;

    // a_br decode (ChunkMesher bands it): band 0 = cross-plant quad (raw
    // 1.5 rooted / 2.5 sway-top — "thin": double-sided, clamps to display
    // brightness 0.95); band f+1 = cube/liquid/glow face 4*(f+1)+brightness,
    // f in -X +X -Y +Y -Z +Z order. All four verts of a quad share the band,
    // so the decode survives interpolation exactly.
    float fid = floor(v_br * 0.25); // 0 = cross quad, 1..6 = face id + 1
    bool thin = fid < 0.5;
    float brv = thin ? 0.95 : v_br - fid * 4.0;

    // EXACT axis-aligned normal from the face id; cross quads fall back to
    // the screen-space-derivative normal (both of their sides count as lit
    // via abs() below, so the facing-away leak class doesn't apply to them)
    vec3 nrm;
    if (thin) {
        nrm = normalize(cross(dFdx(v_worldPos), dFdy(v_worldPos)));
    } else {
        float f6 = fid - 1.0;                 // 0..5 in DIRS order
        float sgn = mod(f6, 2.0) * 2.0 - 1.0; // -1 even, +1 odd
        nrm = vec3(0.0);
        if (f6 < 1.5) nrm.x = sgn;
        else if (f6 < 3.5) nrm.y = sgn;
        else nrm.z = sgn;
    }
    float ndl = dot(nrm, -u_lightDir);
    if (thin) ndl = abs(ndl);

    if (u_shadowDebug > 1.5) {
        // mode 2: PCF sampling internals — R = tap spread in texels beyond
        // the 1-texel floor (/8), G = PCF lit fraction, B = bias meters (/3).
        // Facing-away pixels (never sampled) render the EXACT-normal face id
        // as a purple ramp (fid/8 in R and B): every pixel of one block face
        // must read a single flat value — any speckle or per-pixel variation
        // there means the face-id decode broke. Mirrors the main path exactly.
        if (ndl <= 0.02) { gl_FragColor = vec4(fid / 8.0, 0.0, fid / 8.0, 1.0); return; }
        vec4 dsc = u_shadowMat * vec4(v_worldPos, 1.0);
        vec3 dspos = dsc.xyz * 0.5 + 0.5;
        float dtanT = min(sqrt(max(1.0 - ndl * ndl, 0.0)) / ndl, 8.0);
        vec2 dfp = fwidth(dspos.xy);
        float dspread = clamp(0.6 * max(dfp.x, dfp.y),
            u_shadowPix, u_shadowPix * (1.0 + v_dist * 0.25));
        float dspreadTex = dspread / u_shadowPix;
        float dbias = min(0.02 + (1.5 + 2.4 * max(dspreadTex - 1.5, 0.0)) * u_shadowTexel * dtanT, 3.0);
        float dref = dspos.z - dbias / u_shadowRange;
        float dlit = litFraction(dspos.xy, dspreadTex, dref);
        gl_FragColor = vec4(clamp((dspread / u_shadowPix - 1.0) / 8.0, 0.0, 1.0),
            dlit, clamp(dbias / 3.0, 0.0, 1.0), 1.0);
        return;
    }
    if (u_shadowDebug > 0.5) {
        vec4 dc = u_shadowMat * vec4(v_worldPos, 1.0);
        vec3 dp = dc.xyz * 0.5 + 0.5;
        if (dp.x < 0.0 || dp.x > 1.0 || dp.y < 0.0 || dp.y > 1.0) {
            gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); // magenta: outside map
            return;
        }
        float dd = unpackDepth(texture2D(u_shadowMap, dp.xy));
        float diff = dp.z - dd;
        // red = fragment behind stored depth (shadow), green = raw map depth,
        // blue = fragment in front (lit)
        gl_FragColor = vec4(clamp(diff * 30.0, 0.0, 1.0), dd, clamp(-diff * 30.0, 0.0, 1.0), 1.0);
        return;
    }

    // cast-shadow factor from the light-space depth map
    float shadowMul = 1.0;
    if (u_shadowDim < 1.0) {
        // shadow LOD: ease the dim factor toward 1 with distance (48→144 m).
        // At range a screen pixel spans several faces and many map texels, so
        // ANY binary lit/shadow distinction flickers under camera motion no
        // matter how it's sampled — shrinking the CONTRAST is what makes the
        // residual flips invisible (fog owns the far field anyway; near/mid
        // shadows keep the full tuned 0.45). Applies to the facing-away
        // branch too: distant unlit-face vs lit-face dapple is the same flip.
        float effDim = mix(u_shadowDim, 0.78, clamp((v_dist - 48.0) / 96.0, 0.0, 1.0));
        if (ndl <= 0.02) {
            // exact back/grazing face: shadowed by the light term alone, no
            // map lookup — with the banded normal this branch is per-FACE,
            // never per-pixel, so the noon "bright dot" speckle (derivative-
            // normal pixels wobbling across this threshold into the sampled
            // branch with tanθ at cap) cannot happen.
            shadowMul = effDim;
        } else {
            vec4 sc = u_shadowMat * vec4(v_worldPos, 1.0);
            vec3 spos = sc.xyz * 0.5 + 0.5; // ortho: w == 1
            if (spos.x > 0.0 && spos.x < 1.0 && spos.y > 0.0 && spos.y < 1.0 && spos.z < 1.0) {
                float tanT = min(sqrt(max(1.0 - ndl * ndl, 0.0)) / ndl, 8.0);
                // FOOTPRINT-SCALED, BILINEAR-WEIGHTED PCF (litFraction /
                // litBilin above). The cached map is bit-identical between
                // sun steps, so all edge aliasing is pure SAMPLING: close up
                // a binary tap grid quantizes the edge to map texels (stair-
                // steps), at range one screen pixel spans MANY texels and
                // point taps re-roll their texel pick every sub-pixel camera
                // move (shimmer). Bilinear-blended compare results make each
                // tap continuous in the sample position — near edges become
                // ONE smooth texel of gradient (tight by design: this is a
                // crisp blocky world, AA'd not soft), far footprints
                // integrate to a stable lit fraction. The no-jitter map
                // cache is untouched; only how it is SAMPLED changed. The
                // footprint estimate is the ONE remaining screen-space-
                // derivative input; its distance-scaled clamp stays (legit
                // footprints GROW with minification, so the cap never binds
                // the far field) as insurance against seam-quad fwidth
                // spikes mis-widening the kernel and mis-raising the bias.
                vec2 fpUv = fwidth(spos.xy);
                float spread = clamp(0.6 * max(fpUv.x, fpUv.y),
                    u_shadowPix, u_shadowPix * (1.0 + v_dist * 0.25));
                // bias = base 0.02 m + the receiver plane's EXACT depth slope
                // across the sampled footprint: 1.5 texels at the near floor
                // (the pre-PCF close-up contract — edges within ~2 texels of
                // the caster), growing with the footprint under minification;
                // 2.4 per extra texel covers the diagonal taps (×1.41) plus
                // ~1 texel of single-tap depth reconstruction. This RETIRES
                // the old fwidth(spos.z) depth term and its 0.02·v_dist
                // clamp: both existed to cover this same minification error
                // with a noisy derivative input that spiked at mesh seams.
                float spreadTex = spread / u_shadowPix;
                float biasM = min(0.02 + (1.5 + 2.4 * max(spreadTex - 1.5, 0.0)) * u_shadowTexel * tanT, 3.0);
                float ref = spos.z - biasM / u_shadowRange;
                // Anti-aliased lit fraction (litFraction above): bilinear-
                // weighted compares kill both the close-up texel staircase
                // and the tap-snap component of distant shimmer. The bias
                // formula is UNCHANGED: the new kernel's farthest fetched
                // texel ((spreadTex-1)*1.41 + 1.41 texels) is strictly
                // closer than the old kernel's at every spreadTex, so the
                // empirically verified no-acne margin only grows.
                float sunFrac = litFraction(spos.xy, spreadTex, ref);
                // entity sprite shadows only within 64 m of the camera: the
                // per-frame half-res entity map re-projects every frame, so
                // its distant edges crawl with entity animation — and a
                // sprite's shadow is sub-pixel out there anyway. Entities
                // only exist inside the interest radius, so nothing visible
                // is lost; the far field stops sampling the crawling map.
                // Bilinear-weighted like the world taps (the half-res map's
                // coarser texels stair-stepped twice as hard).
                if (v_dist < 64.0) {
                    sunFrac = min(sunFrac, litBilin(u_entShadowMap, spos.xy, u_entShadowPix, ref));
                }
                shadowMul = mix(effDim, 1.0, sunFrac);
            }
        }
    }

    float sl = v_light.x * v_light.x;
    float bl = v_light.y * v_light.y;
    // night endpoint scaled by the room's nightLight (world message; the
    // schema default raises it ~35% over the old tuned floor)
    vec3 skyC = mix(vec3(0.12, 0.14, 0.25) * u_nightLight, vec3(1.02, 0.99, 0.95), u_sun);
    vec3 lit = max(max(sl * skyC * shadowMul, bl * vec3(1.35, 1.02, 0.61)), vec3(0.045));
    lit = mix(lit, vec3(1.0), u_fullbright);
    vec3 col = tex.rgb * brv * lit;
    float fog = clamp((v_dist - u_fogRange.x) / (u_fogRange.y - u_fogRange.x), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, u_fogColor, fog), u_alpha);
}
