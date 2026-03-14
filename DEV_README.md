# CrystalFreeze — Developer Guide

Technical reference for contributing to CrystalFreeze. Covers architecture, data layout, module responsibilities, and key design decisions.

## Architecture Overview

```
User Input (Click/Tap)
  |
  v
TouchHandler --> main.ts (screen->world coords) --> FreezeSystem.placeSeed(eqZ)
                                                        |
                                                        v
                                                  SeedRegistry (initial alpha/seedId)
                                                  LatticeSystem.nearestSite(px,py,pz,...)
                                                        |
Per Frame:                                              v
  main.ts loop -----> ParticleSystem.update(dt)   FreezeSystem.update(data,count,eqZ) x simSpeed
                        |                               |
                        v                               v
                  computeInteractions()           Propagation (SpatialHash query, 3D dist)
                  integrate() (Langevin)          3D lattice assignment (LatticeSystem)
                  Z dynamics (eqZ springs)        Temperature-dependent melting
                        |                               |
                        v                               v
                  ParticleSystem.data[] <----------------+
                  ParticleSystem.eqZ[] <----------------+
                        |
                        v
                  ParticleRenderer.uploadParticleData()
                  ParticleRenderer.updateHbonds()
                        |
                        v
                  VERT_SHADER (perspective + wrapping)
                  FRAG_SHADER (quaternion molecule rendering)
                  HBOND_VERT/FRAG (hydrogen bond lines)
                        |
                        v
                      Canvas
```

## Directory Structure

```
src/
  main.ts                    # App lifecycle, game loop, seed placement, eqZ passthrough
  config.ts                  # All tunable CONFIG parameters (as const)
  particles/
    ParticleSystem.ts        # Particle buffer, forces, Langevin integration, eqZ array, Z dynamics
    GPUParticles.ts          # (placeholder) GPU compute path
    Recirculation.ts         # (placeholder) particle recycling
    GrainBoundary.ts         # (placeholder) grain boundary effects
  simulation/
    FreezeSystem.ts          # 3D crystallization front propagation + melting + 3D site keys
    LatticeSystem.ts         # 3D two-sublattice honeycomb lattice (O(1), ABAB stacking, inverse Bravais)
    SeedRegistry.ts          # Nucleation seed management + 3D site assignment
    FrontDetector.ts         # (placeholder) phase-field front tracking
    PDEField.ts              # (placeholder) PDE-based field extensions
  rendering/
    ParticleRenderer.ts      # WebGL2 VAO/VBO, program switching, uniforms, H-bond lines
    SceneSetup.ts            # Background gradient quad
    shaders.ts               # Inline GLSL (vertex + 2 fragment + background + H-bond shaders)
    ModeGlossy.ts            # (placeholder) glossy mode config
    ModeMinimal.ts           # (placeholder) minimal mode config
    DepthManager.ts          # (placeholder) depth-of-field extensions
  ui/
    Overlay.ts               # Settings panel, FPS counter, callbacks (incl. 3D Lattice controls)
    TouchHandler.ts          # Click/tap detection with duration/distance threshold
    Controls.ts              # (placeholder) keyboard controls
  utils/
    GLHelpers.ts             # Shader compilation, program linking
    SpatialHash.ts           # Grid-based O(1) neighbor lookup
styles/
  overlay.css                # Glassmorphic panel, theme variants, advanced section
tests/
  hex_patch_test.ts          # 7-molecule frozen hex patch stability
  hex_growth_test.ts         # Freezing front growth validation
  hex_growth_sim_test.ts     # Growth simulation test
  hex_3ring_test.ts          # 3-ring hexagon (19 molecules)
  density_audit_test.ts      # Liquid density validation
  morphology_growth_test.ts  # Crystal morphology evolution
  slab3d_patch_test.ts       # 10-molecule 2-layer 3D patch stability
  slab3d_growth_test.ts      # 3D lattice generation + layer variation validation
  ice_honeycomb_test.ts      # Honeycomb sublattice structure validation (ring centers, coordination)
  ice_ih_structure_test.ts   # Comprehensive ice Ih structure test (10 criteria: coordination, rings, ABAB, density)
  ice_stability_test.ts      # 12-molecule frozen honeycomb patch stability (600 frames)
  layer_readability_test.ts  # Layer distribution, front-layer bias, slab depth validation
  coord_audit.ts             # One-off coordination audit (confirms 0% coord-4 in honeycomb)
  structural_diagnostics.ts  # Full structural diagnostics (coordination, O–O distances, 6-ring detection, density)
```

## Particle Data Layout

Each particle is 12 floats (48 bytes) stored in a flat `Float32Array`:

| Offset | Name | Description |
|--------|------|-------------|
| 0 | `OFF_PX` | X position (world space, wraps periodically) |
| 1 | `OFF_PY` | Y position |
| 2 | `OFF_VX` | X velocity |
| 3 | `OFF_VY` | Y velocity |
| 4 | `OFF_ALPHA` | Crystallinity (0.0=liquid, 1.0=solid) |
| 5 | `OFF_SEED_ID` | Seed ID (-1=liquid, >=0=frozen to seed) |
| 6 | `OFF_EQ_X` | Lattice equilibrium X |
| 7 | `OFF_EQ_Y` | Lattice equilibrium Y |
| 8 | `OFF_Z` | Depth in 3D slab |
| 9 | `OFF_QX` | Quaternion X (qw derived: sqrt(1 - qx^2 - qy^2 - qz^2)) |
| 10 | `OFF_QY` | Quaternion Y |
| 11 | `OFF_QZ` | Quaternion Z |

The same buffer is shared between CPU (physics) and GPU (re-uploaded via `bufferData` with `DYNAMIC_DRAW` each frame).

### Separate eqZ Array

Equilibrium Z positions for frozen molecules are stored in a **separate `Float32Array`** (`ParticleSystem.eqZ`), not in the GPU buffer. This avoids changing the 12-float GPU stride while giving CPU physics full 3D lattice targets. `eqZ[i]` is set during lattice assignment and cleared on melt.

## Physics Model

### Forces (computed in `computeInteractions()`)

- **O-O soft repulsion** — overlap-based: `F = epsilon * (1 - r/sigma)^2` when `r < sigma` (epsilon=18, sigma=24px)
- **H-O attraction** — linear falloff to cutoff: `F = epsilon * (1 - r/cutoff)` (epsilon=0.5, very weak translational; strong rotational torque). Each molecule has 2 H atoms; attractions from both molecules create torques
- **H-H repulsion** — prevents hydrogen collapse (epsilon=8, sigma=10px)
- **Solid-solid attraction** — gentle pull toward `latticeSpacing` distance for frozen pairs (`min(alpha_i, alpha_j) > 0.1`)
- **Spring-to-lattice (Morse-like)** — `F = springConstant * alpha^3 * tanh(d/8) * 8` pulls frozen molecules toward assigned hex site (k=25). Tanh saturation prevents jitter at large displacement.
- **Neighbor springs (Morse-like)** — `F = neighborSpringK * solidPair^2 * tanh(d/6) * 6` elastic spring between frozen neighbor pairs using 3D eq-site distances (k=4). Saturates at 6px displacement.
- **Force cap** — max 40 per particle for stability

### Torques

- **H-bond angular bias** — modulates H-O attraction by cos(angle between O-H and neighbor direction), bias strength=0.4
- **Orientation alignment** — frozen molecules align toward reference yaw (quantized to 60° hex symmetry) with strength=14
- **Torque cap** — max 12

### Integration (in `integrate()`)

**Semi-implicit Euler** (symplectic) with alpha-dependent parameters:

```
v_new = (v + F*dt + noise) / (1 + gamma*dt)    // implicit damping in denominator
x_new = x + v_new * dtStep                     // uses NEW velocity
```

- **Unconditionally stable** — implicit damping treatment cannot pump energy regardless of spring stiffness
- **No position correction hack** — the old `corrRate * (eq - x)` hack has been removed; implicit damping + Morse spring handle stability naturally
- **Damping**: `gamma = gammaLiquid * (1 + alpha^2 * dampingBoost)` — ranges from 1.0 (liquid) to 21.0 (solid)
- **Noise**: `noiseFraction = 1 - alpha^2 * (1 - solidNoiseFraction)` — 100% at liquid, 2% at solid
- **Velocity cap**: `maxVelocity = 8.0` for stability

Rotational integration also uses semi-implicit form: `omega = (omega + torque*dt + noise) / (1 + gammaRot*dt)`

### Z Dynamics

Each molecule has a z-position confined to a thin slab:

- **Slab bounds**: computed from `(maxLayers - 1) * zLayerSpacing / 2 + zSlabMargin` (default 48px)
- **Elastic rebound**: `if (z > slabHalf) z = 2 * slabHalf - z` — no energy loss
- **Liquid restoring force**: O-U spring toward z=0, fades as molecule freezes (`liquidZFade = max(0, 1 - alpha * 2.5)`)
- **Lattice Z spring**: drives frozen molecules to their assigned Z layer (`zForce += zSpringK * solidFrac^2 * (eqZ[i] - z)`, active when alpha > 0.2)
- **Z drives perspective scaling** in the vertex shader: `scale = focalLength / (focalLength + z)`

The liquid spring fade is critical: without it, the two springs compete and frozen molecules settle at a compromise position rather than their lattice target.

### Quaternion Orientation

Molecules have full SO(3) orientation stored as 3 quaternion components (qw derived from unit constraint):

- **Liquid**: Z-axis Langevin torque + XY Brownian tumbling (`tumbleScale = 0.15 * sqrt(dtStep) * noiseFraction`, where `dtStep = dt * 60`)
- **Frozen**: NLERP alignment toward a 3D crystal-tilt target. Target has lattice yaw (60deg intervals) plus deterministic pitch/roll from lattice position hash. Minimum floor: 0.6 rad pitch, 0.3 rad roll.

Small rotation quaternions are composed via first-order approximation (exact for large angles using sin/cos).

## 3D Lattice System

### Two-Sublattice Honeycomb (Ice Ih Basal Plane)

The lattice uses a **proper two-sublattice honeycomb** construction — the correct oxygen sublattice of ice Ih:

```
Bravais lattice vectors:
  a1 = (L, 0)          where L = a√3 ≈ 48.5px
  a2 = (L/2, 3a/2)     where a = latticeSpacing = 28px

Sublattice A: at Bravais lattice points
Sublattice B: at Bravais lattice points + (0, a)
```

This gives exact coordination 3 for all interior atoms and open 6-member rings with diameter 2a = 56px. The old `isRingCenter()` method (triangular lattice with 1/3 removal) is kept for backward compatibility but is no longer used by the core lattice logic.

### ABAB Stacking

- **Even layers (0, 2)**: Standard honeycomb grid in XY
- **Odd layers (1, 3)**: Honeycomb grid offset by `(L/3, 0) ≈ (16.17, 0)` in seed-local coordinates

The L/3 offset interleaves odd-layer atoms without overlapping any even-layer positions, matching ice Ih wurtzite-like stacking.

### Variable Layer Count

`LatticeSystem.localLayerCount(lx, ly)` returns 2, 3, or 4 using a smooth spatial hash at ~150px wavelength. This prevents a uniform stack appearance. Base count is configurable (default 3, ±1 variation).

### LatticeSite Interface

```typescript
export interface LatticeSite {
  x: number; y: number; z: number;
  orientTarget: number;  // rotation angle for solid state alignment
  layerIndex: number;    // which Z layer (0 = bottom)
}
```

### Site Generation — O(1)

`LatticeSystem.nearestSite(px, py, pz, seedX, seedY, seedTheta)` returns a `LatticeSite`:

1. Transform to seed-local coordinates (minimum-image XY + rotate by seed theta)
2. Compute local layer count (2–4)
3. For each Z layer: apply ABAB offset `(L/3, 0)` if odd, use inverse Bravais transform to find nearest unit cell, check both sublattice A and B sites in 3×3 neighborhood
4. Select site with minimum 3D distance (with front-layer bias)
5. Transform back to world coordinates

Max candidates: 9 cells × 2 sublattices × 2–4 layers = 36–72 (bounded, O(1)).

### 3D Site Keys

Occupied-site uniqueness uses 3D encoding:
```
siteKey3D(x, y, z) = round(x) * 1_000_000 + round(y) * 1_000 + round(z + 200)
```

## Freezing System

### Propagation Algorithm (`FreezeSystem.update()`)

1. Build spatial hash of frozen particles (alpha > 0.35)
2. For each liquid particle, query frozen neighbors within `propagationRadius` (42px)
3. Accumulate influence using **3D distances**: `sum(alpha_j * (1 - dist3D/radius))`
4. **Hex directional bias**: cos²(6θ) modulation on XY projection favors growth along basal lattice axes (bias strength=0.7)
5. **Lattice proximity bonus**: molecules near valid 3D hex sites freeze faster
6. Increment alpha: `delta = influence * propagationRate * freezeScale`
7. `freezeScale` depends on temperature: 1.0 at temp=0, 0.0 at temp >= freezeThreshold (0.4)

### Lattice Assignment

Deferred until alpha crosses `latticeAssignThreshold` (0.25). Gated by:
- Minimum 2 frozen neighbors within 3D adjacency range (`sqrt(targetR^2 + zSpacing^2) * 1.15`)
- **Coordination limit: 4** (3 in-plane honeycomb + 1 inter-layer) — prevents dense blob formation
- **Inter-layer bond limit: 1** — tracked separately from in-plane bonds; new molecule rejected if it would form >1 inter-layer bond, or if adding it would give any existing neighbor >1 inter-layer bond
- 3D site key uniqueness check
- Prevents disconnected clusters and ensures front connectivity

`LatticeSystem.nearestSite()` is O(1) — analytical 3D honeycomb lattice with seed-relative rotation. No pre-stored grid.

### Melting

Above `meltThreshold` (0.6): alpha decays per frame. Boundary molecules (lower alpha) melt first via `meltEase = 1 - 0.5*alpha`. Full melt resets seedId, equilibrium XY, and eqZ.

## Rendering Pipeline

### Vertex Shader

- Converts world position to NDC via viewport-as-window projection
- Periodic wrapping: `rel = (pos - vpOffset) mod worldSize`
- Point size: `mix(baseSizeLiquid, baseSizeSolid, alpha) * perspectiveScale * DPR`
- Edge fade: smoothstep to viewport edges (30px fade zone)
- Depth opacity: `0.45 + 0.55 * depth_norm` — gentle linear curve, all layers clearly visible
- Off-screen culling: degenerate position (2, 2, 2)

### Fragment Shader (Glossy)

Per-pixel 3D molecule geometry with bright plastic-model look:
1. Reconstruct quaternion (qw from unit constraint)
2. Rotate H1, H2 local positions via Rodrigues' formula: `v' = v + 2*qw*(q x v) + 2*(q x (q x v))`
3. Project to 2D (xy) with depth (z)
4. Draw bonds (distToSegment), then depth-sort atoms (frontmost wins)
5. Blinn-Phong shading: high ambient (0.42) so dark side is still clearly colored, moderate diffuse (0.52), fill light (0.22), specular (0.55)
6. Ice: elevated base lighting (0.44 + 0.46*NdotL) with Fresnel rim
7. Depth fog: max 35% blend toward background, keeping molecules opaque
8. Premultiplied alpha output

### Fragment Shader (Minimal)

3D molecules with simple directional lighting. Same quaternion rotation and depth sorting, plus approximate sphere normals for a NdotL lighting term (0.50 ambient + 0.45 directional). Frozen molecules get specular brightening (0.22).

### H-Bond Rendering

Hydrogen bond visualization using a separate shader program (HBOND_VERT/HBOND_FRAG):
- **Detection**: IUPAC donor-acceptor geometry criteria
  - O···O distance < 31 px (~3.5 Å at σ=24)
  - H-O···O angle > 150° (donor-specific)
- **Rendering**: GL_LINES from donor H to acceptor O
- **Strength**: Line alpha based on O-O distance
- **Performance**: Spatial hash for efficient neighbor queries; max lines ≈ 2×N
- **Toggle**: Enabled/disabled via UI, adjustable line width

### Molecule Size Controls

The renderer exposes configurable atom and bond sizes:
- **O radius**: 0.08–0.40 (default 0.22)
- **H radius**: 0.04–0.30 (default 0.09)
- **Bond width**: 0.02–0.15 (default 0.07)

### WebGL State

- Blend: `ONE, ONE_MINUS_SRC_ALPHA` (premultiplied)
- Depth: `LEQUAL`, depthMask=false (fragment shader handles atom ordering)
- GL_POINTS with `gl_PointSize` and `gl_PointCoord`

## Speed Control Architecture

Physics and freeze propagation are decoupled:

```typescript
// main.ts game loop
this.particles.update(dt);                                    // physics always 1x
for (let s = 0; s < this.simSpeed; s++) {
  this.freezeSystem.update(data, count, this.particles.eqZ); // freeze N times per frame
}
```

This prevents bulk drift at high speed while accelerating crystallization.

## Key Design Decisions

1. **Fixed world domain + viewport-as-window** — simulation box (2400×1350) never changes. Resize/zoom only affects the viewing window. This eliminates particle state corruption from window resizing.

2. **Periodic XY, confined Z** — X and Y use minimum image convention for seamless wrapping. Z is confined to a thin slab with elastic rebound — not periodic, to avoid artificial Z-periodicity artifacts.

3. **Deferred lattice assignment** — molecules aren't locked to lattice sites immediately. Alpha must cross 0.25 first, giving thermal motion time to find better local packing. Requires 2+ frozen neighbors for connectivity.

4. **Separate eqZ array** — equilibrium Z stored outside the GPU buffer to avoid changing the 12-float stride. CPU physics uses eqZ for 3D lattice springs; GPU never sees it.

5. **Quaternion-based 3D orientation** — full SO(3) rotations instead of 2-DOF Euler angles. Prevents gimbal lock and enables true 3D rendering with H-atom depth sorting.

6. **Frozen 3D tilt** — frozen molecules don't collapse to flat. Each gets a deterministic pitch/roll from a hash of its lattice position, with a guaranteed minimum floor (0.6 rad / 0.3 rad).

7. **Inline GLSL shaders** — embedded as template literal strings in `shaders.ts` rather than loaded from files. Simplifies bundling and eliminates async shader loading.

8. **Spatial hashing** — grid-based O(1) neighbor lookup. Rebuilt every frame (Map.clear + re-insert). Used for particle interactions, freezing propagation, and H-bond detection. Remains 2D for XY — Z range is small enough to check inline.

12. **Semi-implicit Euler** — unconditionally stable integrator with implicit damping `1/(1+gamma*dt)`. Eliminates the old position-correction hack and prevents energy pumping regardless of spring stiffness. Velocity Verlet was evaluated but rejected (2 force evaluations per step = halved framerate).

13. **Morse-like tanh springs** — `F = k * tanh(d/sigma) * sigma` saturates force at large displacement instead of growing linearly. Eliminates high-frequency jitter during the liquid-to-solid transition. Applied to both lattice and neighbor springs.

14. **Two-sublattice honeycomb** — proper ice Ih oxygen sublattice with explicit A and B sites on a Bravais lattice (a1=(L,0), a2=(L/2, 3a/2)). All interior atoms have exact coordination 3, with open 6-member rings (diameter 2a=56px). ABAB stacking offset L/3≈16.17px for inter-layer interleaving. Combined with coordination cap 4 and inter-layer bond limit 1, prevents dense blob-like packing.

9. **Premultiplied alpha** — enables correct additive blending of semi-transparent overlapping sprites without sorting.

10. **Hex directional bias** — cos²(6θ) modulation on freeze propagation favors growth along basal lattice axes, producing faceted crystal morphology rather than circular blobs.

11. **Liquid spring fade** — the liquid Z restoring spring fades to zero as a molecule freezes, so the lattice Z spring dominates. Without this, the two springs compete and frozen molecules settle at a compromise position.

## Configuration

All tunable parameters are in `src/config.ts` as a single `CONFIG` object (`as const`). Key parameter groups:

- `particles` — count tiers (2000–6000)
- `state` — thermodynamic state proxy (σ_OO, packing fraction)
- `world` — domain size (2400×1350, derived from state model)
- `viewport` — zoom level (2.5×)
- `depth` — slab range (±60), focal length (200), z-spring
- `dynamics` — kT, damping, noise, rotational parameters
- `interaction` — cutoffs, epsilon values, bond geometry, H-bond angular bias, H-H repulsion
- `render` — sprite sizes, edge fade, defaults (glossy, chemical)
- `themes` — dark/light gradient backgrounds
- `moleculeStyles` — chemical/stylized color palettes per theme (incl. H-bond colors)
- `freeze` — lattice spacing (28px), propagation, Morse-like spring constants, hex bias, coordination cap (4), honeycomb sublattice, 3D lattice params (zLayerCount, zLayerSpacing, zLayerVariation, zSlabMargin, zSpringK)
- `temperature` — phase thresholds, rates
- `simulation` — speed multipliers (1×, 5×, 20×)
- `ui` — auto-seed delay, max seeds, cooldowns

Mutable state (temperature, propagation rate) lives on `FreezeSystem` as getter/setter properties, not in CONFIG. Z layer count and spacing are mutated at runtime via `(CONFIG.freeze as any)` from UI callbacks.

## Adding New Features

### New UI control
1. Add callback to `OverlayCallbacks` interface in `Overlay.ts`
2. Add HTML element in `createUI()` panel
3. Add event listener in `createUI()`
4. Wire callback in `main.ts` constructor
5. Add CSS in `styles/overlay.css` (dark + light theme variants)

### New physics force
1. Add to `computeInteractions()` loop in `ParticleSystem.ts`
2. Use minimum image convention for periodic XY distances (Z is not periodic)
3. Apply Newton's 3rd law (symmetric `fx[i]/fx[j]`)
4. Add config parameters to `CONFIG.interaction`

### New render mode
1. Add fragment shader string in `shaders.ts`
2. Compile program in `ParticleRenderer` constructor
3. Add mode to `RenderMode` type and `setMode()` switch
4. Add UI toggle button in `Overlay.ts`

## Build Commands

```bash
npm run dev       # Vite dev server with HMR (localhost:5173)
npm run build     # tsc --noEmit + vite build -> dist/
npm run preview   # Preview production build locally
```

## Testing

Deterministic tests run via `npx tsx`:

```bash
npx tsx tests/hex_patch_test.ts          # 7-molecule 2D hex patch stability
npx tsx tests/slab3d_patch_test.ts       # 10-molecule 2-layer 3D patch stability
npx tsx tests/slab3d_growth_test.ts      # 3D lattice generation + layer variation
npx tsx tests/ice_honeycomb_test.ts      # Honeycomb sublattice structure validation
npx tsx tests/ice_ih_structure_test.ts   # Comprehensive ice Ih structure (10 criteria)
npx tsx tests/ice_stability_test.ts      # 12-molecule frozen honeycomb stability (600 frames)
npx tsx tests/layer_readability_test.ts  # Layer distribution + front-layer bias validation
npx tsx tests/coord_audit.ts             # Coordination audit (confirm 0% coord-4)
npx tsx tests/structural_diagnostics.ts  # Full structural diagnostics (5 categories)
```

Tests evaluate: O-O spacing, Z drift from equilibrium, layer separation, translational/rotational KE, coordination, two-sublattice honeycomb topology, ABAB stacking, ring vacancy, inter-layer coordination, 6-member ring detection, O–O distance distribution, ice vs liquid density comparison, and energy stability over time.

## Performance Notes

- 5,000 particles at 60fps on modern hardware
- Hot path avoids allocations: pre-allocated Float32Arrays for fx, fy, torque, omegaZ
- SpatialHash rebuilds every frame (Map.clear + re-insert) — fast for N=5000
- GPU buffer upload is `bufferData` with `DYNAMIC_DRAW` (full re-upload each frame)
- Fragment shader is the bottleneck: per-pixel quaternion rotation + 3 atom depth sort
- H-bond detection uses separate spatial hash, only computed when enabled
- 3D lattice adds <5% overhead to freeze system, <1% to physics integration
- nearestSite O(1) with max 72 candidates (9 cells × 2 sublattices × 4 layers), called only during site assignment
- Tanh springs add ~1 `Math.tanh()` per frozen particle per frame (~0.05ms at 5000 particles)
