// Fullscreen sky quad. Positions are raw NDC (-1..1); the fragment shader
// reconstructs a world-space view ray per pixel from u_invViewProj, so the
// gradient / sun glow / stars stay locked to the world as the camera turns.
attribute vec2 a_pos;
varying vec2 v_ndc;

void main() {
    v_ndc = a_pos;
    gl_Position = vec4(a_pos, 1.0, 1.0);
}
