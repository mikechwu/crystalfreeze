// Inline shader sources for Vite compatibility

export const VERT_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_velocity;
in vec2 a_alpha_seed;
in vec2 a_equilibrium;
in vec2 a_depth_orient;   // (z, qx) — depth + quaternion x
in vec2 a_omega_flags;    // (qy, qz) — quaternion y,z

// World and viewport uniforms
uniform vec2 u_world_size;       // fixed world domain size
uniform vec2 u_viewport_offset;  // viewport origin in world coords
uniform vec2 u_viewport_size;    // viewport size in world coords
uniform float u_focal_length;
uniform float u_base_size;
uniform float u_base_size_solid;
uniform float u_dpr;
uniform float u_edge_fade_width;
uniform float u_debug_tracked;   // number of tracked molecules (0 = off)

out float v_alpha;
out float v_opacity;
out float v_edge_fade;
out float v_perspective_scale;
out float v_qx;
out float v_is_tracked;
out float v_qy;
out float v_qz;

void main() {
    float z = a_depth_orient.x;
    float qx = a_depth_orient.y;
    float qy = a_omega_flags.x;
    float qz = a_omega_flags.y;

    // Perspective scaling
    float perspective_scale = u_focal_length / (u_focal_length + z);
    v_perspective_scale = perspective_scale;
    v_qx = qx;
    v_qy = qy;
    v_qz = qz;

    // Debug: first N molecules are "tracked" — rendered larger
    v_is_tracked = (float(gl_VertexID) < u_debug_tracked) ? 1.0 : 0.0;

    // Compute position relative to viewport, handling periodic wrapping.
    vec2 rel = a_position - u_viewport_offset;

    // Periodic wrap: bring into range [-world/2, +world/2] relative to viewport origin
    rel = mod(rel + u_world_size * 0.5, u_world_size) - u_world_size * 0.5;

    // Convert viewport-relative position to NDC [-1, 1]
    vec2 ndc = (rel / u_viewport_size) * 2.0 - 1.0;
    float z_ndc = (z + 50.0) / 100.0;

    gl_Position = vec4(ndc.x, -ndc.y, z_ndc, 1.0);

    v_alpha = a_alpha_seed.x;

    // Point size: interpolate between liquid and solid size based on alpha
    float baseSize = mix(u_base_size, u_base_size_solid, v_alpha);
    float trackScale = v_is_tracked > 0.5 ? 1.8 : 1.0;
    float size = baseSize * perspective_scale * u_dpr * trackScale;
    gl_PointSize = max(size, 1.0);

    // Edge fade: distance from viewport edge in viewport-relative coords
    float dx = min(rel.x, u_viewport_size.x - rel.x);
    float dy = min(rel.y, u_viewport_size.y - rel.y);
    float edge_dist = min(dx, dy);
    v_edge_fade = smoothstep(0.0, u_edge_fade_width, edge_dist);

    // Depth-based opacity — very strong gradient for convincing 3D volume
    float depth_norm = clamp((perspective_scale - 0.83) / 0.42, 0.0, 1.0);
    float depth_opacity = 0.18 + 0.82 * depth_norm * depth_norm;
    v_opacity = depth_opacity * v_edge_fade;

    // Cull particles outside visible region (with margin for point size)
    float margin = u_base_size * u_dpr * 2.0 * trackScale;
    if (rel.x < -margin || rel.x > u_viewport_size.x + margin ||
        rel.y < -margin || rel.y > u_viewport_size.y + margin) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }
}
`;

// H-O-H molecule geometry constants for fragment shaders
const MOLECULE_GLSL = `
// Water molecule geometry in point-sprite space [-1, 1]
// Bond angle ~104.5 degrees, half-angle ~52.25 degrees
const float BOND_ANGLE_HALF = 0.912;  // 52.25 degrees in radians
const float BOND_LEN = 0.42;         // O-H bond length in sprite space
const float O_RADIUS = 0.28;         // oxygen atom radius
const float H_RADIUS = 0.18;         // hydrogen atom radius
const float BOND_WIDTH = 0.06;       // bond stick width

// H positions in molecule-local 3D frame (H-O-H lies in the XY plane, z=0)
vec3 getH1Local3D() {
    return vec3(cos(BOND_ANGLE_HALF), sin(BOND_ANGLE_HALF), 0.0) * BOND_LEN;
}

vec3 getH2Local3D() {
    return vec3(cos(-BOND_ANGLE_HALF), sin(-BOND_ANGLE_HALF), 0.0) * BOND_LEN;
}

// Rotate vector by unit quaternion using Rodrigues' formula:
// v' = v + 2*qw*(q x v) + 2*(q x (q x v))
// where q = (qx, qy, qz) is the vector part of the quaternion.
// Returns vec3: xy = screen position, z = depth (positive = behind screen).
vec3 quatRotate(vec3 v, float qw, vec3 q) {
    vec3 t = 2.0 * cross(q, v);
    return v + qw * t + cross(q, t);
}

// Distance from point p to line segment ab
float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (a + ab * t));
}
`;

export const GLOSSY_FRAG = `#version 300 es
precision highp float;

in float v_alpha;
in float v_opacity;
in float v_edge_fade;
in float v_perspective_scale;
in float v_qx;
in float v_is_tracked;
in float v_qy;
in float v_qz;

out vec4 fragColor;

// Theme colors
uniform vec3 u_oxygen_color;
uniform vec3 u_hydrogen_color;
uniform vec3 u_bond_color;

${MOLECULE_GLSL}

const vec3 LIGHT_DIR = normalize(vec3(0.3, 0.5, 1.0));
const vec3 LIGHT_DIR2 = normalize(vec3(-0.4, -0.2, 0.8)); // secondary fill light
const vec3 VIEW_DIR = vec3(0.0, 0.0, 1.0);

vec3 shadeSphere(vec2 uv, float radius, vec3 baseColor) {
    float r2 = dot(uv, uv) / (radius * radius);
    if (r2 > 1.0) return vec3(-1.0);

    vec3 normal = vec3(uv / radius, sqrt(1.0 - r2));
    float NdotL = max(dot(normal, LIGHT_DIR), 0.0);
    vec3 halfVec = normalize(LIGHT_DIR + VIEW_DIR);
    float NdotH = max(dot(normal, halfVec), 0.0);
    float specular = pow(NdotH, 32.0);

    vec3 color = baseColor * (0.3 + 0.5 * NdotL) + vec3(1.0) * 0.3 * specular;
    return color;
}

// Ice-specific shading: stronger specular, Fresnel rim, cooler color
vec3 shadeIceSphere(vec2 uv, float radius, vec3 baseColor, float freezeAlpha) {
    float r2 = dot(uv, uv) / (radius * radius);
    if (r2 > 1.0) return vec3(-1.0);

    vec3 normal = vec3(uv / radius, sqrt(1.0 - r2));

    // Primary light — stronger diffuse for ice
    float NdotL = max(dot(normal, LIGHT_DIR), 0.0);
    // Secondary fill light — subtle
    float NdotL2 = max(dot(normal, LIGHT_DIR2), 0.0);

    // Specular — tighter, brighter for crystalline surface
    vec3 halfVec = normalize(LIGHT_DIR + VIEW_DIR);
    float NdotH = max(dot(normal, halfVec), 0.0);
    float specPower = mix(32.0, 80.0, freezeAlpha); // sharper specular for ice
    float specular = pow(NdotH, specPower);
    float specStrength = mix(0.3, 0.7, freezeAlpha); // brighter highlights

    // Fresnel rim — ice has visible edge brightening
    float NdotV = max(dot(normal, VIEW_DIR), 0.0);
    float fresnel = pow(1.0 - NdotV, 3.0) * freezeAlpha * 0.4;

    // Material response only — no color shift. Water and ice are both H2O.
    vec3 color = baseColor * (0.25 + 0.5 * NdotL + 0.15 * NdotL2)
               + vec3(0.9, 0.95, 1.0) * specStrength * specular
               + vec3(0.7, 0.85, 1.0) * fresnel;

    return color;
}

void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;

    // Quaternion-based 3D orientation: rotate H atom local positions
    // qw is derived from unit quaternion constraint: |q|=1, qw >= 0
    float qw = sqrt(max(0.0, 1.0 - v_qx*v_qx - v_qy*v_qy - v_qz*v_qz));
    vec3 qVec = vec3(v_qx, v_qy, v_qz);

    vec3 h1_3d = quatRotate(getH1Local3D(), qw, qVec);
    vec3 h2_3d = quatRotate(getH2Local3D(), qw, qVec);

    vec2 oPos = vec2(0.0);
    vec2 h1Pos = h1_3d.xy;
    vec2 h2Pos = h2_3d.xy;
    float o_depth = 0.0;   // O is always at depth 0 (center of molecule)
    float h1_depth = h1_3d.z;
    float h2_depth = h2_3d.z;

    vec2 dO = uv - oPos;
    float rO = length(dO);
    vec2 dH1 = uv - h1Pos;
    float rH1 = length(dH1);
    vec2 dH2 = uv - h2Pos;
    float rH2 = length(dH2);

    bool isIce = v_alpha > 0.05;
    float hRadius = H_RADIUS;
    float bondW = BOND_WIDTH;

    vec3 color = vec3(0.0);
    float alpha = 0.0;

    // Draw bonds first (always behind atoms)
    float bondDist1 = distToSegment(uv, oPos, h1Pos);
    float bondDist2 = distToSegment(uv, oPos, h2Pos);
    if (bondDist1 < bondW) {
        float t = smoothstep(bondW, bondW * 0.5, bondDist1);
        color = u_bond_color;
        alpha = t * 0.7;
    }
    if (bondDist2 < bondW) {
        float t = smoothstep(bondW, bondW * 0.5, bondDist2);
        color = u_bond_color;
        alpha = max(alpha, t * 0.7);
    }

    // Depth-sorted atom rendering: frontmost (lowest depth) wins at each pixel.
    // H atoms behind O get properly occluded by quaternion-based 3D rotation.
    float bestDepth = 1e6;

    // H1
    if (rH1 < hRadius) {
        vec3 hColor = isIce
            ? shadeIceSphere(dH1, hRadius, u_hydrogen_color, v_alpha)
            : shadeSphere(dH1, hRadius, u_hydrogen_color);
        if (hColor.x >= 0.0 && h1_depth < bestDepth) {
            float edge = smoothstep(hRadius, hRadius * 0.7, rH1);
            bestDepth = h1_depth;
            color = hColor;
            alpha = edge;
        }
    }

    // H2
    if (rH2 < hRadius) {
        vec3 hColor = isIce
            ? shadeIceSphere(dH2, hRadius, u_hydrogen_color, v_alpha)
            : shadeSphere(dH2, hRadius, u_hydrogen_color);
        if (hColor.x >= 0.0 && h2_depth < bestDepth) {
            float edge = smoothstep(hRadius, hRadius * 0.7, rH2);
            bestDepth = h2_depth;
            color = hColor;
            alpha = edge;
        }
    }

    // O (depth = 0)
    if (rO < O_RADIUS) {
        vec3 oColor = isIce
            ? shadeIceSphere(dO, O_RADIUS, u_oxygen_color, v_alpha)
            : shadeSphere(dO, O_RADIUS, u_oxygen_color);
        if (oColor.x >= 0.0 && o_depth < bestDepth) {
            float edge = smoothstep(O_RADIUS, O_RADIUS * 0.7, rO);
            bestDepth = o_depth;
            color = oColor;
            alpha = edge;
        }
    }

    // Debug: orientation axis for tracked molecules (off by default: trackedCount=0)
    if (v_is_tracked > 0.5) {
        float orient_yaw = atan(2.0*(qw*v_qz + v_qx*v_qy), 1.0 - 2.0*(v_qy*v_qy + v_qz*v_qz));
        vec2 axisDir = vec2(cos(orient_yaw), sin(orient_yaw));
        float axisDist = abs(dot(uv, vec2(-axisDir.y, axisDir.x)));
        float axisProj = dot(uv, axisDir);
        if (axisDist < 0.03 && axisProj > 0.0 && axisProj < 0.7) {
            color = vec3(1.0, 0.4, 0.1);
            alpha = 1.0;
        }
        float outerR = length(uv);
        if (outerR > 0.85 && outerR < 0.95) {
            color = vec3(1.0, 0.6, 0.0);
            alpha = max(alpha, 0.6);
        }
    }

    if (alpha < 0.01) discard;

    float a = alpha * v_opacity;
    fragColor = vec4(color * a, a);
}
`;

export const MINIMAL_FRAG = `#version 300 es
precision highp float;

in float v_alpha;
in float v_opacity;
in float v_edge_fade;
in float v_perspective_scale;
in float v_qx;
in float v_is_tracked;
in float v_qy;
in float v_qz;

out vec4 fragColor;

// Theme colors
uniform vec3 u_oxygen_color;
uniform vec3 u_hydrogen_color;
uniform vec3 u_bond_color;

${MOLECULE_GLSL}

void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;

    // Quaternion-based 3D orientation
    float qw = sqrt(max(0.0, 1.0 - v_qx*v_qx - v_qy*v_qy - v_qz*v_qz));
    vec3 qVec = vec3(v_qx, v_qy, v_qz);

    vec3 h1_3d = quatRotate(getH1Local3D(), qw, qVec);
    vec3 h2_3d = quatRotate(getH2Local3D(), qw, qVec);

    vec2 oPos = vec2(0.0);
    vec2 h1Pos = h1_3d.xy;
    vec2 h2Pos = h2_3d.xy;
    float o_depth = 0.0;
    float h1_depth = h1_3d.z;
    float h2_depth = h2_3d.z;

    float rO = length(uv - oPos);
    float rH1 = length(uv - h1Pos);
    float rH2 = length(uv - h2Pos);

    float hRadius = H_RADIUS;
    float bondW = BOND_WIDTH;

    vec3 color = vec3(0.0);
    float alpha = 0.0;

    // Bonds (behind all atoms)
    float bondDist1 = distToSegment(uv, oPos, h1Pos);
    float bondDist2 = distToSegment(uv, oPos, h2Pos);
    float bMask = min(bondDist1, bondDist2);
    if (bMask < bondW) {
        float t = smoothstep(bondW, bondW * 0.3, bMask);
        color = u_bond_color;
        alpha = t * 0.5;
    }

    // Depth-sorted atoms: closest to viewer (lowest depth) wins at each pixel
    float bestDepth = 1e6;

    // H1
    if (rH1 < hRadius && h1_depth < bestDepth) {
        float t = smoothstep(hRadius, hRadius * 0.2, rH1);
        bestDepth = h1_depth;
        color = u_hydrogen_color;
        alpha = t;
    }

    // H2
    if (rH2 < hRadius && h2_depth < bestDepth) {
        float t = smoothstep(hRadius, hRadius * 0.2, rH2);
        bestDepth = h2_depth;
        color = u_hydrogen_color;
        alpha = t;
    }

    // O (depth = 0)
    if (rO < O_RADIUS && o_depth < bestDepth) {
        float t = smoothstep(O_RADIUS, O_RADIUS * 0.2, rO);
        bestDepth = o_depth;
        color = u_oxygen_color;
        alpha = t;
    }

    // Solid-state material response — no color shift, only specular brightening
    if (v_alpha > 0.05) {
        float specBoost = v_alpha * 0.15;
        color = color + vec3(specBoost);
    }

    // Debug: tracked molecule highlight (off by default: trackedCount=0)
    if (v_is_tracked > 0.5) {
        float orient_yaw = atan(2.0*(qw*v_qz + v_qx*v_qy), 1.0 - 2.0*(v_qy*v_qy + v_qz*v_qz));
        vec2 axisDir = vec2(cos(orient_yaw), sin(orient_yaw));
        float axisDist = abs(dot(uv, vec2(-axisDir.y, axisDir.x)));
        float axisProj = dot(uv, axisDir);
        if (axisDist < 0.03 && axisProj > 0.0 && axisProj < 0.7) {
            color = vec3(1.0, 0.4, 0.1);
            alpha = 1.0;
        }
        float outerR = length(uv);
        if (outerR > 0.85 && outerR < 0.95) {
            color = vec3(1.0, 0.6, 0.0);
            alpha = max(alpha, 0.6);
        }
    }

    if (alpha < 0.01) discard;

    float a = alpha * v_opacity;
    fragColor = vec4(color * a, a);
}
`;

export const BG_VERT = `#version 300 es
precision highp float;

in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.999, 1.0);
}
`;

export const BG_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec3 u_color_top;
uniform vec3 u_color_bottom;

void main() {
    vec3 color = mix(u_color_bottom, u_color_top, v_uv.y);
    fragColor = vec4(color, 1.0);
}
`;
