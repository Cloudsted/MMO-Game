#ifdef GL_ES
precision mediump float;
#endif

// Depth pass: pack light-space depth into RGBA8 (GL20-safe — no depth
// textures needed). Cutout blocks (leaves) discard so canopies cast
// leafy shadows instead of solid slabs.

varying vec2 v_uv;
varying float v_depth;

uniform sampler2D u_tiles;

vec4 pack(float d) {
    vec4 e = vec4(1.0, 255.0, 65025.0, 16581375.0) * d;
    e = fract(e);
    e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
    return e;
}

void main() {
    if (texture2D(u_tiles, v_uv).a < 0.5) discard;
    gl_FragColor = pack(v_depth);
}
