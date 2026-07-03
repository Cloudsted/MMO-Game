attribute vec3 a_position;

uniform mat4 u_projView;

varying vec3 v_pos;

void main() {
    v_pos = a_position;
    gl_Position = u_projView * vec4(a_position, 1.0);
}
