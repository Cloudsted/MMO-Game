attribute vec3 a_position;
attribute vec2 a_uv;

uniform mat4 u_lightVP;

varying vec2 v_uv;
varying float v_depth;

void main() {
    v_uv = a_uv;
    gl_Position = u_lightVP * vec4(a_position, 1.0);
    // orthographic: w == 1, z is linear in light space
    v_depth = gl_Position.z * 0.5 + 0.5;
}
