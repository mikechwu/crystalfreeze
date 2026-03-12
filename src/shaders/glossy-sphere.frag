#version 300 es
precision highp float;

in float v_alpha;
in float v_opacity;
in float v_edge_fade;
in float v_perspective_scale;

out vec4 fragColor;

// Light direction (normalized, pointing toward viewer)
const vec3 LIGHT_DIR = normalize(vec3(0.3, 0.5, 1.0));
const vec3 VIEW_DIR = vec3(0.0, 0.0, 1.0);

// 5-stop color ramp: liquid blue -> solid white
vec3 alpha_color_ramp(float alpha) {
    // Stop 0: deep blue (liquid)
    // Stop 1: medium blue
    // Stop 2: light blue
    // Stop 3: pale blue-white
    // Stop 4: white (solid crystal)
    vec3 c0 = vec3(0.15, 0.35, 0.85);  // deep blue
    vec3 c1 = vec3(0.25, 0.50, 0.90);  // medium blue
    vec3 c2 = vec3(0.45, 0.70, 0.95);  // light blue
    vec3 c3 = vec3(0.70, 0.85, 0.98);  // pale blue-white
    vec3 c4 = vec3(0.92, 0.96, 1.00);  // near white

    float t = clamp(alpha, 0.0, 1.0);
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
    if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
    return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
    // Map gl_PointCoord to [-1, 1]
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);

    // Discard outside sphere
    if (r2 > 1.0) discard;

    // Sphere normal from point coord
    vec3 normal = vec3(uv, sqrt(1.0 - r2));

    // Phong shading
    float NdotL = max(dot(normal, LIGHT_DIR), 0.0);
    vec3 halfVec = normalize(LIGHT_DIR + VIEW_DIR);
    float NdotH = max(dot(normal, halfVec), 0.0);

    // Shininess increases with alpha (liquid=soft, solid=glossy)
    float shininess = mix(8.0, 64.0, v_alpha);
    float specular = pow(NdotH, shininess);

    // Color from alpha ramp
    vec3 baseColor = alpha_color_ramp(v_alpha);

    // Ambient + diffuse + specular
    float ambient = 0.25;
    vec3 color = baseColor * (ambient + 0.6 * NdotL) + vec3(1.0) * 0.4 * specular;

    // Edge softness (anti-aliasing at sphere boundary)
    float edge_soft = smoothstep(1.0, 0.85, sqrt(r2));

    // Final alpha
    float a = edge_soft * v_opacity;

    // Premultiplied alpha output
    fragColor = vec4(color * a, a);
}
