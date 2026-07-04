#ifdef GL_ES
precision highp float;
#endif

// Procedural sky dome drawn as a fullscreen quad right after the clear and
// BEFORE the voxel world (depth test + write off), so terrain paints over it.
// The horizon colour is fed the same value the world's distance fog dissolves
// to (DayNight.skyColor), so the world melts seamlessly into the sky — the fog
// invariant is preserved. Zenith is a deeper blue by day, near-black by night.
// Layers: vertical gradient, warm sun glow + cool moon glow, drifting fbm
// clouds near the horizon band, and a twinkling star field that fades in at
// night. All view-ray driven from u_invViewProj so nothing swims when you look.

varying vec2 v_ndc;

uniform mat4 u_invViewProj;
uniform vec3 u_camPos;
uniform vec3 u_sunDir;    // unit vector TOWARD the sun disc
uniform vec3 u_moonDir;   // unit vector TOWARD the moon disc
uniform float u_sunFactor; // 0 night .. 1 day
uniform vec3 u_horizon;    // == fog/sky colour the world dissolves into
uniform vec3 u_zenith;
uniform float u_time;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    return 0.6 * vnoise(p) + 0.3 * vnoise(p * 2.03) + 0.1 * vnoise(p * 4.01);
}

void main() {
    vec4 far = u_invViewProj * vec4(v_ndc, 1.0, 1.0);
    vec3 dir = normalize(far.xyz / far.w - u_camPos);

    float h = clamp(dir.y, 0.0, 1.0);
    vec3 col = mix(u_horizon, u_zenith, pow(h, 0.5));

    // warm sun glow (tight halo + core) — kept modest so it doesn't wash the sky
    float sd = max(dot(dir, u_sunDir), 0.0);
    vec3 sunTint = mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.96, 0.82), u_sunFactor);
    float glow = pow(sd, 10.0) * 0.2 + pow(sd, 250.0) * 0.9;
    col += glow * sunTint * clamp(u_sunFactor + 0.25, 0.0, 1.0);

    // cool moon glow at night
    float md = max(dot(dir, u_moonDir), 0.0);
    col += pow(md, 90.0) * 0.5 * vec3(0.65, 0.72, 0.95) * (1.0 - u_sunFactor);

    // drifting clouds: fbm brightening banded to the mid sky
    if (dir.y > 0.02) {
        vec2 cuv = dir.xz / (dir.y + 0.12) * 0.6 + vec2(u_time * 0.006, u_time * 0.004);
        float c = smoothstep(0.55, 0.9, fbm(cuv));
        float band = smoothstep(0.03, 0.35, dir.y) * (1.0 - smoothstep(0.6, 1.0, dir.y));
        vec3 cloudCol = mix(vec3(0.5, 0.55, 0.68), vec3(1.0, 0.99, 0.96), u_sunFactor);
        col = mix(col, cloudCol, c * band * (0.35 + 0.35 * u_sunFactor));
    }

    // star field: deterministic per-cell, DIM, each star twinkling very
    // gently at its own slow rate + phase (a shared rate/phase reads as the
    // whole sky pulsing in unison, which looks loud)
    float night = clamp(1.0 - u_sunFactor * 1.5, 0.0, 1.0);
    if (night > 0.01 && dir.y > 0.03) {
        vec2 suv = dir.xz / (dir.y + 0.15) * 60.0;
        vec2 cell = floor(suv);
        float r = hash(cell);
        float r2 = hash(cell + 5.3);
        float star = smoothstep(0.992, 1.0, r);
        float tw = 0.9 + 0.1 * sin(u_time * (0.4 + 1.1 * r2) + r2 * 62.8);
        col += night * star * tw * 0.5 * vec3(0.85, 0.9, 1.0);
    }

    gl_FragColor = vec4(col, 1.0);
}
