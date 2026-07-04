attribute vec3 a_position;
attribute vec2 a_uv;
attribute float a_br;
attribute vec2 a_light;

uniform mat4 u_projView;
uniform vec3 u_camPos;

varying vec2 v_uv;
varying float v_br;
varying vec2 v_light;
varying float v_dist;
varying vec3 v_worldPos;

void main() {
    v_uv = a_uv;
    v_br = a_br;
    v_light = a_light;
    v_worldPos = a_position;
    v_dist = distance(a_position, u_camPos);
    gl_Position = u_projView * vec4(a_position, 1.0);
}
