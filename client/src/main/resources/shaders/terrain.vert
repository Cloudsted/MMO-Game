attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec4 a_splat;

uniform mat4 u_projView;

varying vec3 v_pos;
varying vec3 v_normal;
varying vec4 v_splat;

void main() {
    v_pos = a_position;
    v_normal = a_normal;
    v_splat = a_splat;
    gl_Position = u_projView * vec4(a_position, 1.0);
}
