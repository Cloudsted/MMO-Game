#ifdef GL_ES
precision mediump float;
#endif

// 3D item meshes (held viewmodel + dropped loot): texture x per-face
// brightness x the voxel-light tint computed CPU-side (VoxelLighting
// mirror), so items sit in the same lighting world as billboards.
// u_glow lifts emissive items (torches, crystals) toward full-bright so
// the bloom pass picks them up. Same fog formula as voxel.frag.

varying vec2 v_uv;
varying float v_br;
varying float v_dist;

uniform sampler2D u_tex;
uniform vec3 u_tint;
uniform float u_glow;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;

void main() {
    vec4 tex = texture2D(u_tex, v_uv);
    if (tex.a < 0.5) discard;
    vec3 lit = mix(u_tint, vec3(1.0), u_glow);
    vec3 col = tex.rgb * v_br * lit;
    float fog = clamp((v_dist - u_fogRange.x) / (u_fogRange.y - u_fogRange.x), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, u_fogColor, fog), 1.0);
}
