#version 300 es
precision highp float;

in float v_alpha;
in float v_opacity;
in float v_edge_fade;
in float v_perspective_scale;

out vec4 fragColor;

// Same 5-stop color ramp as glossy mode
vec3 alpha_color_ramp(float alpha) {
    vec3 c0 = vec3(0.15, 0.35, 0.85);
    vec3 c1 = vec3(0.25, 0.50, 0.90);
    vec3 c2 = vec3(0.45, 0.70, 0.95);
    vec3 c3 = vec3(0.70, 0.85, 0.98);
    vec3 c4 = vec3(0.92, 0.96, 1.00);

    float t = clamp(alpha, 0.0, 1.0);
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
    if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
    return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r = length(uv);

    // Soft radial gradient
    float alpha_shape = smoothstep(1.0, 0.3, r);

    vec3 color = alpha_color_ramp(v_alpha);

    float a = alpha_shape * v_opacity;

    // Premultiplied alpha output
    fragColor = vec4(color * a, a);
}
