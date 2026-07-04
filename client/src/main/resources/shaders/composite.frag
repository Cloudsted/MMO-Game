#ifdef GL_ES
precision mediump float;
#endif

// Final composite. The tuned scene colours pass through UNCHANGED — there is
// deliberately NO tonemap and NO colour grade here: a filmic tonemap lifts the
// darks and desaturates highlights, which washed sprites and lit surfaces out
// in sunlight (owner-rejected). We only ADD emissive bloom and sun god-ray
// shafts on top, then a subtle edge vignette.
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomStrength;
uniform vec2 u_sunScreen; // sun UV; .x < -5 means the sun isn't contributing
uniform float u_godray;
uniform float u_vignette;

void main() {
    vec3 col = texture2D(u_scene, v_uv).rgb;
    col += texture2D(u_bloom, v_uv).rgb * u_bloomStrength;

    // volumetric god-ray shafts marched toward the on-screen sun
    if (u_godray > 0.0 && u_sunScreen.x > -5.0) {
        vec2 delta = (u_sunScreen - v_uv) / 24.0;
        vec2 uv = v_uv;
        float decay = 1.0;
        vec3 shaft = vec3(0.0);
        for (int i = 0; i < 24; i++) {
            uv += delta;
            shaft += texture2D(u_bloom, uv).rgb * decay;
            decay *= 0.93;
        }
        col += shaft * (u_godray / 24.0);
    }

    // subtle edge vignette (darkens corners only — does not touch midtones)
    float vig = smoothstep(0.85, 0.35, length(v_uv - 0.5));
    col *= mix(1.0, vig, u_vignette);

    gl_FragColor = vec4(col, 1.0);
}
