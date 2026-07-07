attribute vec3 a_position;
attribute vec2 a_uv;
attribute float a_br;

uniform mat4 u_projView;
uniform mat4 u_world;
uniform vec3 u_camPos;

varying vec2 v_uv;
varying float v_br;
varying float v_dist;

void main() {
    vec4 wp = u_world * vec4(a_position, 1.0);
    v_uv = a_uv;
    v_br = a_br;
    v_dist = distance(wp.xyz, u_camPos);
    gl_Position = u_projView * wp;
}
