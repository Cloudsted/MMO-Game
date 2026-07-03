#ifdef GL_ES
precision mediump float;
#endif

// The signature warm/cool curve lives here: cool sky light (moon-blue at
// night, warm white by day) squared, max()'d against warm amber block light
// (point lights, later phases), with a hard black floor. Change DayNight's
// CPU mirror together with this file.

uniform sampler2D u_grass;
uniform sampler2D u_dirt;
uniform sampler2D u_stone;
uniform sampler2D u_sand;

uniform vec3 u_lightDir;   // from light toward ground
uniform float u_sunFactor; // 0 night .. 1 day
uniform vec3 u_camPos;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;   // start, end

varying vec3 v_pos;
varying vec3 v_normal;
varying vec4 v_splat;

void main() {
    vec2 uv = v_pos.xz; // 1 metre per 16px tile, textures wrap
    vec4 s = v_splat / max(v_splat.x + v_splat.y + v_splat.z + v_splat.w, 0.001);
    vec3 base =
        texture2D(u_grass, uv).rgb * s.x +
        texture2D(u_dirt, uv).rgb * s.y +
        texture2D(u_stone, uv).rgb * s.z +
        texture2D(u_sand, uv).rgb * s.w;

    float ndl = max(dot(normalize(v_normal), -normalize(u_lightDir)), 0.0);
    float sky = 0.4 + 0.6 * ndl;
    vec3 skyCol = mix(vec3(0.24, 0.32, 0.56), vec3(1.0, 0.98, 0.92), u_sunFactor);
    skyCol *= 0.30 + 0.70 * u_sunFactor;
    vec3 light = sky * sky * skyCol;
    // amber block light joins via max() when point lights land (LightManager)
    light = max(light, vec3(0.045));

    vec3 col = base * light;
    float dist = distance(u_camPos, v_pos);
    float fog = clamp((dist - u_fogRange.x) / (u_fogRange.y - u_fogRange.x), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, u_fogColor, fog), 1.0);
}
