attribute vec3 a_position;
attribute vec2 a_uv;
attribute float a_br;
attribute vec2 a_light;

uniform mat4 u_projView;
uniform vec3 u_camPos;
uniform float u_time;
uniform float u_wind;   // per-room wind strength (0 = still, e.g. dungeons)

varying vec2 v_uv;
varying float v_br;
varying vec2 v_light;
varying float v_dist;
varying vec3 v_worldPos;

void main() {
    vec3 p = a_position;

    // a_br == 2.5 marks the TOP verts of a wind-swaying cross plant (grass,
    // flowers, brush) — bend them horizontally so foliage breathes. Rooted
    // bottom verts (1.5) and all cube geometry (face-banded to 4.275+ by the
    // mesher — see ChunkMesher's layout doc) are untouched. This sway is
    // deliberately absent from shadow.vert (no u_time there), so the cached
    // world shadow map never crawls.
    if (a_br > 2.0 && a_br < 3.0 && u_wind > 0.0) {
        float phase = p.x * 0.7 + p.z * 0.6;
        float bend = sin(u_time * 1.3 + phase) + 0.35 * sin(u_time * 2.9 + phase * 1.8);
        p.x += bend * u_wind * 0.055;
        p.z += cos(u_time * 1.1 + phase) * u_wind * 0.04;
    }

    v_uv = a_uv;
    v_br = a_br;
    v_light = a_light;
    v_worldPos = p;
    v_dist = distance(p, u_camPos);
    gl_Position = u_projView * vec4(p, 1.0);
}
