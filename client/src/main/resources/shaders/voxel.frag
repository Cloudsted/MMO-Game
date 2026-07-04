#ifdef GL_ES
precision mediump float;
#endif

// Voxel world shader: baked per-vertex (skylight, blocklight) combined with
// the live sun level — cool moonlit-blue skylight, warm amber blocklight,
// max() of the two, quadratic falloff, floor 0.045. lightColor() in
// VoxelLighting.java is the CPU mirror of this curve — change together.

varying vec2 v_uv;
varying float v_br;
varying vec2 v_light;
varying float v_dist;

uniform sampler2D u_tiles;
uniform float u_sun;        // 0 night .. 1 day
uniform float u_fullbright; // glow pass: skip lighting entirely
uniform float u_alpha;      // 1 solid, <1 water
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;

void main() {
    vec4 tex = texture2D(u_tiles, v_uv);
    if (tex.a < 0.5) discard;
    float sl = v_light.x * v_light.x;
    float bl = v_light.y * v_light.y;
    vec3 skyC = mix(vec3(0.16, 0.19, 0.34), vec3(1.02, 0.99, 0.95), u_sun);
    vec3 lit = max(max(sl * skyC, bl * vec3(1.35, 1.02, 0.61)), vec3(0.045));
    lit = mix(lit, vec3(1.0), u_fullbright);
    vec3 col = tex.rgb * v_br * lit;
    float fog = clamp((v_dist - u_fogRange.x) / (u_fogRange.y - u_fogRange.x), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, u_fogColor, fog), u_alpha);
}
