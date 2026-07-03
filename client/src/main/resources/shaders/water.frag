#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D u_texture;
uniform float u_time;
uniform vec3 u_lightMul;
uniform vec3 u_camPos;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;

varying vec3 v_pos;

void main() {
    // two scrolling layers of the same tile give cheap shimmer
    vec2 uv1 = v_pos.xz * 0.5 + vec2(u_time * 0.03, u_time * 0.017);
    vec2 uv2 = v_pos.xz * 0.5 - vec2(u_time * 0.021, u_time * 0.026);
    vec3 col = mix(texture2D(u_texture, uv1).rgb, texture2D(u_texture, uv2).rgb, 0.5);
    col *= u_lightMul;
    float dist = distance(u_camPos, v_pos);
    float fog = clamp((dist - u_fogRange.x) / (u_fogRange.y - u_fogRange.x), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, u_fogColor, fog), 0.82);
}
