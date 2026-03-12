#version 300 es
precision highp float;

// Particle attributes (from CPU buffer or transform feedback output)
in vec2 a_position;    // world position (x, y)
in vec2 a_velocity;    // velocity (vx, vy) — used for motion blur hint
in vec2 a_alpha_seed;  // (alpha, seed_id)
in vec2 a_equilibrium; // equilibrium position (eq_x, eq_y)
in vec2 a_depth_flags; // (z_depth, flags)

// Uniforms
uniform vec2 u_viewport_size;   // viewport width, height in pixels
uniform float u_focal_length;   // perspective focal length
uniform float u_base_size;      // base point sprite size
uniform float u_dpr;            // device pixel ratio
uniform float u_edge_fade_width;
uniform vec2 u_domain_min;      // visible domain min (with buffer)
uniform vec2 u_domain_max;      // visible domain max (with buffer)

// Outputs to fragment shader
out float v_alpha;
out float v_opacity;
out float v_edge_fade;
out float v_perspective_scale;

void main() {
    float z = a_depth_flags.x;
    float flags = a_depth_flags.y;

    // Perspective scaling
    float perspective_scale = u_focal_length / (u_focal_length + z);
    v_perspective_scale = perspective_scale;

    // Convert world position to clip space [-1, 1]
    vec2 ndc = (a_position / u_viewport_size) * 2.0 - 1.0;
    // Normalize z to [0, 1] for depth buffer (near=0, far=1)
    float z_ndc = (z + 40.0) / 80.0; // map [-40,40] to [0,1]

    gl_Position = vec4(ndc.x, -ndc.y, z_ndc, 1.0);

    // Point size with perspective
    float alpha = a_alpha_seed.x;
    float size = u_base_size * perspective_scale * u_dpr;
    gl_PointSize = max(size, 1.0);

    v_alpha = alpha;

    // Edge fade: smoothstep from viewport edge
    float dx = min(a_position.x - u_domain_min.x, u_domain_max.x - a_position.x);
    float dy = min(a_position.y - u_domain_min.y, u_domain_max.y - a_position.y);
    float edge_dist = min(dx, dy);
    v_edge_fade = smoothstep(0.0, u_edge_fade_width, edge_dist);

    // Depth-based opacity (farther = slightly more transparent)
    float depth_opacity = 0.7 + 0.3 * perspective_scale;
    v_opacity = depth_opacity * v_edge_fade;

    // Cull particles outside visible+buffer region
    if (a_position.x < u_domain_min.x - 20.0 || a_position.x > u_domain_max.x + 20.0 ||
        a_position.y < u_domain_min.y - 20.0 || a_position.y > u_domain_max.y + 20.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // behind clip plane
    }
}
