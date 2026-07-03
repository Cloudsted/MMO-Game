#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D u_texture;
uniform vec3 u_lightMul;  // CPU-evaluated warm/cool curve (DayNight.entityLight)
uniform vec3 u_camPos;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;

varying vec3 v_pos;
varying vec2 v_uv;

void main() {
    vec4 tex = texture2D(u_texture, v_uv);
    if (tex.a < 0.5) discard; // alpha test: no sorting headaches
    vec3 col = tex.rgb * u_lightMul;
    float dist = distance(u_camPos, v_pos);
    float fog = clamp((dist - u_fogRange.x) / (u_fogRange.y - u_fogRange.x), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, u_fogColor, fog), 1.0);
}
