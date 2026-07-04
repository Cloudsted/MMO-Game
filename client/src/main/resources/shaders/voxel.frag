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

varying vec2 v_uv;
varying float v_br;
varying vec2 v_light;
varying float v_dist;
varying vec3 v_worldPos;

uniform sampler2D u_tiles;
uniform sampler2D u_shadowMap;
uniform mat4 u_shadowMat;
uniform float u_shadowDim;   // skylight multiplier inside shadow (1 = off)
uniform float u_shadowDebug; // 1 = visualize the light-space compare
uniform float u_sun;        // 0 night .. 1 day
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

    // cast-shadow factor from the light-space depth map
    float shadowMul = 1.0;
    if (u_shadowDim < 1.0) {
        vec4 sc = u_shadowMat * vec4(v_worldPos, 1.0);
        vec3 spos = sc.xyz * 0.5 + 0.5; // ortho: w == 1
        if (spos.x > 0.0 && spos.x < 1.0 && spos.y > 0.0 && spos.y < 1.0 && spos.z < 1.0) {
            float d = unpackDepth(texture2D(u_shadowMap, spos.xy));
            if (spos.z - 0.0035 > d) shadowMul = u_shadowDim;
        }
    }

    float sl = v_light.x * v_light.x;
    float bl = v_light.y * v_light.y;
    vec3 skyC = mix(vec3(0.16, 0.19, 0.34), vec3(1.02, 0.99, 0.95), u_sun);
    vec3 lit = max(max(sl * skyC * shadowMul, bl * vec3(1.35, 1.02, 0.61)), vec3(0.045));
    lit = mix(lit, vec3(1.0), u_fullbright);
    vec3 col = tex.rgb * v_br * lit;
    float fog = clamp((v_dist - u_fogRange.x) / (u_fogRange.y - u_fogRange.x), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, u_fogColor, fog), u_alpha);
}
