#ifdef GL_ES
precision mediump float;
#endif

// Separable 5-tap linear Gaussian. Run once horizontal, once vertical (u_dir
// carries the texel step along one axis). Used to blur the bloom bright-pass.
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;

void main() {
    vec2 o1 = u_dir * 1.3846153846;
    vec2 o2 = u_dir * 3.2307692308;
    vec3 sum = texture2D(u_tex, v_uv).rgb * 0.2270270270;
    sum += texture2D(u_tex, v_uv + o1).rgb * 0.3162162162;
    sum += texture2D(u_tex, v_uv - o1).rgb * 0.3162162162;
    sum += texture2D(u_tex, v_uv + o2).rgb * 0.0702702703;
    sum += texture2D(u_tex, v_uv - o2).rgb * 0.0702702703;
    gl_FragColor = vec4(sum, 1.0);
}
