#ifdef GL_ES
precision mediump float;
#endif

// Bloom bright-pass: keep only the pixels above a luminance threshold (with a
// soft knee) so torches, crystals, lava, the sun disc, and FX bleed light while
// the rest of the scene stays crisp. Rendered at half resolution.
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform float u_threshold;

void main() {
    vec3 c = texture2D(u_scene, v_uv).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    // sharp knee: near-full-bright emissive passes strongly, sunlit sprites
    // (luminance just under the threshold) stay out of the bloom entirely
    float knee = smoothstep(u_threshold, u_threshold + 0.12, l);
    gl_FragColor = vec4(c * knee, 1.0);
}
