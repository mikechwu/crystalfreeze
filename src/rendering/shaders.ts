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
uniform vec3 u_fog_color;        // theme-dependent fog color for depth desaturation

out float v_alpha;
out float v_opacity;
out float v_edge_fade;
out float v_perspective_scale;
out float v_qx;
out float v_is_tracked;
out float v_qy;
out float v_qz;
out float v_fog_factor;

void main() {
    float z = a_depth_orient.x;
    float qx = a_depth_orient.y;
    float qy = a_omega_flags.x;
    float qz = a_omega_flags.y;

    // Perspective scaling
    float perspective_scale = u_focal_length / (u_focal_length + z);
    v_perspective_scale = perspective_scale;

    // Depth fog: far particles (behind focal plane) desaturate toward background
    // Gentle fog preserves color on back layers while giving depth cue
    float fog_raw = 1.0 - perspective_scale; // 0 at focal plane, positive behind
    v_fog_factor = clamp(fog_raw * 3.5, 0.0, 0.35); // max 35% fog — subtle depth cue, not washout

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
    float z_ndc = (z + 60.0) / 120.0;

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

    // Depth-based opacity — gentle gradient so all layers are clearly visible
    // Molecules should look opaque and solid like plastic models, not transparent.
    // Near: full opacity. Far: still mostly opaque with slight fade for depth cue.
    float depth_norm = clamp((perspective_scale - 0.78) / 0.50, 0.0, 1.0);
    float depth_opacity = 0.45 + 0.55 * depth_norm;
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

// Atom/bond sizes — controlled by uniforms for user adjustability
uniform float u_o_radius;    // oxygen atom radius in sprite space
uniform float u_h_radius;    // hydrogen atom radius in sprite space
uniform float u_bond_width;  // bond stick width in sprite space

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

// Distance from point p to line segment ab, also returns t parameter along segment
float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (a + ab * t));
}

// Same but outputs t parameter for split-color bonds
float distToSegmentT(vec2 p, vec2 a, vec2 b, out float tParam) {
    vec2 ab = b - a;
    tParam = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (a + ab * tParam));
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
in float v_fog_factor;

out vec4 fragColor;

// Theme colors
uniform vec3 u_oxygen_color;
uniform vec3 u_hydrogen_color;
uniform vec3 u_bond_color;
uniform vec3 u_fog_color;

${MOLECULE_GLSL}

const vec3 LIGHT_DIR = normalize(vec3(0.3, 0.5, 1.0));
const vec3 LIGHT_DIR2 = normalize(vec3(-0.4, -0.2, 0.8)); // secondary fill light
const vec3 VIEW_DIR = vec3(0.0, 0.0, 1.0);

vec3 shadeSphere(vec2 uv, float radius, vec3 baseColor) {
    float r2 = dot(uv, uv) / (radius * radius);
    if (r2 > 1.0) return vec3(-1.0);

    vec3 normal = vec3(uv / radius, sqrt(1.0 - r2));
    float NdotL = max(dot(normal, LIGHT_DIR), 0.0);
    float NdotL2 = max(dot(normal, LIGHT_DIR2), 0.0);
    vec3 halfVec = normalize(LIGHT_DIR + VIEW_DIR);
    float NdotH = max(dot(normal, halfVec), 0.0);
    float specular = pow(NdotH, 48.0);

    // Bright plastic model look — high ambient so dark side is still clearly colored
    vec3 ambient = baseColor * 0.42;
    vec3 diffuse = baseColor * 0.52 * NdotL;
    vec3 fill = baseColor * 0.22 * NdotL2;
    vec3 spec = vec3(1.0) * 0.55 * specular;
    return ambient + diffuse + fill + spec;
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
    float specStrength = mix(0.35, 0.85, freezeAlpha); // brighter highlights for crystalline surface

    // Fresnel rim — ice has visible edge brightening
    float NdotV = max(dot(normal, VIEW_DIR), 0.0);
    float fresnel = pow(1.0 - NdotV, 3.0) * freezeAlpha * 0.4;

    // Bright plastic model look for ice — high ambient, strong specular highlight
    vec3 color = baseColor * (0.44 + 0.46 * NdotL + 0.22 * NdotL2)
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
    float hRadius = u_h_radius;
    float oRadius = u_o_radius;
    float bondW = u_bond_width;

    vec3 color = vec3(0.0);
    float alpha = 0.0;

    // Draw bonds first (always behind atoms) — split-color: O-side red, H-side white
    float t1Param, t2Param;
    float bondDist1 = distToSegmentT(uv, oPos, h1Pos, t1Param);
    float bondDist2 = distToSegmentT(uv, oPos, h2Pos, t2Param);
    if (bondDist1 < bondW) {
        float t = smoothstep(bondW, bondW * 0.5, bondDist1);
        // t1Param: 0=oxygen end, 1=hydrogen end; split at midpoint
        vec3 bondCol = mix(u_oxygen_color, u_hydrogen_color, smoothstep(0.4, 0.6, t1Param));
        color = bondCol;
        alpha = t * 0.9;
    }
    if (bondDist2 < bondW) {
        float t = smoothstep(bondW, bondW * 0.5, bondDist2);
        vec3 bondCol = mix(u_oxygen_color, u_hydrogen_color, smoothstep(0.4, 0.6, t2Param));
        color = bondCol;
        alpha = max(alpha, t * 0.9);
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
    if (rO < oRadius) {
        vec3 oColor = isIce
            ? shadeIceSphere(dO, oRadius, u_oxygen_color, v_alpha)
            : shadeSphere(dO, oRadius, u_oxygen_color);
        if (oColor.x >= 0.0 && o_depth < bestDepth) {
            float edge = smoothstep(oRadius, oRadius * 0.7, rO);
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

    // Depth fog: blend toward background for far particles
    color = mix(color, u_fog_color, v_fog_factor);

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
in float v_fog_factor;

out vec4 fragColor;

// Theme colors
uniform vec3 u_oxygen_color;
uniform vec3 u_hydrogen_color;
uniform vec3 u_bond_color;
uniform vec3 u_fog_color;

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

    float hRadius = u_h_radius;
    float oRadius = u_o_radius;
    float bondW = u_bond_width;

    vec3 color = vec3(0.0);
    float alpha = 0.0;

    // Bonds (behind all atoms) — split-color
    float t1Param, t2Param;
    float bondDist1 = distToSegmentT(uv, oPos, h1Pos, t1Param);
    float bondDist2 = distToSegmentT(uv, oPos, h2Pos, t2Param);
    float bMask = min(bondDist1, bondDist2);
    if (bMask < bondW) {
        float t = smoothstep(bondW, bondW * 0.3, bMask);
        float tP = bondDist1 < bondDist2 ? t1Param : t2Param;
        color = mix(u_oxygen_color, u_hydrogen_color, smoothstep(0.4, 0.6, tP));
        alpha = t * 0.88;
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
    if (rO < oRadius && o_depth < bestDepth) {
        float t = smoothstep(oRadius, oRadius * 0.2, rO);
        bestDepth = o_depth;
        color = u_oxygen_color;
        alpha = t;
    }

    // Simple plastic-model lighting for minimal mode
    if (bestDepth < 1e5) {
        // Approximate normal from atom center offset
        float r_used = bestDepth == o_depth ? rO / oRadius : (bestDepth == h1_depth ? rH1 / hRadius : rH2 / hRadius);
        float nz = sqrt(max(0.0, 1.0 - r_used * r_used));
        float NdotL = max(0.0, dot(vec3(0.0, 0.0, 1.0), normalize(vec3(0.4, 0.5, 1.0))));
        float lighting = 0.50 + 0.45 * nz * NdotL + 0.15 * nz * nz;
        color = color * lighting;
    }

    // Solid-state material response — specular brightening for frozen molecules
    if (v_alpha > 0.05) {
        float specBoost = v_alpha * 0.22;
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

    // Depth fog: blend toward background for far particles
    color = mix(color, u_fog_color, v_fog_factor);

    float a = alpha * v_opacity;
    fragColor = vec4(color * a, a);
}
`;

// H-bond inter-molecular line visualization
// Vertices are pre-computed in viewport-relative space by JavaScript
// to avoid per-vertex periodic wrapping artifacts at boundaries.
export const HBOND_VERT = `#version 300 es
precision highp float;

in vec2 a_position;   // viewport-relative coordinates (pre-wrapped)
in float a_strength;

uniform vec2 u_viewport_size;

out float v_strength;

void main() {
    v_strength = a_strength;

    // a_position is already viewport-relative (pre-wrapped in JS)
    vec2 ndc = (a_position / u_viewport_size) * 2.0 - 1.0;

    gl_Position = vec4(ndc.x, -ndc.y, 0.5, 1.0);
}
`;

export const HBOND_FRAG = `#version 300 es
precision highp float;

in float v_strength;
out vec4 fragColor;

uniform vec3 u_hbond_color;

void main() {
    // Dashed line pattern: alternate opaque/transparent segments
    // Using screen-space diagonal for direction-independent dash appearance
    float dashCoord = (gl_FragCoord.x + gl_FragCoord.y) * 0.35;
    float dash = mod(dashCoord, 6.0);
    if (dash > 3.5) discard;

    float a = v_strength * 0.55;
    fragColor = vec4(u_hbond_color * a, a);
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
