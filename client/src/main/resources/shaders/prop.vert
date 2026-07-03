attribute vec3 a_position;
attribute vec2 a_texCoord0;

uniform mat4 u_projView;

varying vec3 v_pos;
varying vec2 v_uv;

void main() {
    v_pos = a_position;
    v_uv = a_texCoord0;
    gl_Position = u_projView * vec4(a_position, 1.0);
}
