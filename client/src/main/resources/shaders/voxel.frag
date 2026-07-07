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
// Faces pointing away from the light are shadowed outright (no map lookup —
// no acne possible); lit faces compare with a slope-scaled bias in METERS,
// so edges stay within a texel or two of the caster at every sun angle (a
// constant bias in normalized depth was ~0.9 m here — it slid every shadow
// edge more than a block off its corner).

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
uniform float u_sun;        // 0 night .. 1 day
uniform float u_nightLight; // per-room multiplier on the night skylight floor
uniform float u_fullbright; // glow pass: skip lighting entirely
uniform float u_alpha;      // 1 solid, <1 water
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;

float unpackDepth(vec4 c) {
    return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

void main() {
    vec4 tex = texture2D(u_tiles, v_uv);
    if (tex.a < 0.5) discard;

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

    // v_br > 1.2 marks thin double-sided quads (crossed plants) — clamp back
    // to their display brightness and treat both sides as light-facing
    bool thin = v_br > 1.2;
    float brv = thin ? 0.95 : v_br;

    // cast-shadow factor from the light-space depth map
    float shadowMul = 1.0;
    if (u_shadowDim < 1.0) {
        // axis-aligned face normal from screen-space derivatives (always
        // points at the viewer, which for closed cubes IS the visible face)
        vec3 nrm = normalize(cross(dFdx(v_worldPos), dFdy(v_worldPos)));
        float ndl = dot(nrm, -u_lightDir);
        if (thin) ndl = abs(ndl);
        if (ndl <= 0.02) {
            shadowMul = u_shadowDim; // facing away from the light
        } else {
            vec4 sc = u_shadowMat * vec4(v_worldPos, 1.0);
            vec3 spos = sc.xyz * 0.5 + 0.5; // ortho: w == 1
            if (spos.x > 0.0 && spos.x < 1.0 && spos.y > 0.0 && spos.y < 1.0 && spos.z < 1.0) {
                // bias = base + 1.5 texels of the receiver's depth slope
                float tanT = min(sqrt(max(1.0 - ndl * ndl, 0.0)) / ndl, 8.0);
                float biasM = 0.02 + 1.5 * u_shadowTexel * tanT;
                // nearer occluder of: world geometry, entity sprite quads
                float d = min(unpackDepth(texture2D(u_shadowMap, spos.xy)),
                              unpackDepth(texture2D(u_entShadowMap, spos.xy)));
                if (spos.z - biasM / u_shadowRange > d) shadowMul = u_shadowDim;
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
