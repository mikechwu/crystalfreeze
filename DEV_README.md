# CrystalFreeze — Developer Guide

Technical reference for contributing to CrystalFreeze. Covers architecture, data layout, module responsibilities, and key design decisions.

## Architecture Overview

```
User Input (Click/Tap)
  |
  v
TouchHandler --> main.ts (screen->world coords) --> FreezeSystem.placeSeed()
                                                        |
                                                        v
                                                  SeedRegistry (initial alpha/seedId)
                                                        |
Per Frame:                                              v
  main.ts loop -----> ParticleSystem.update(dt)   FreezeSystem.update() x simSpeed
                        |                               |
                        v                               v
                  computeInteractions()           Propagation (SpatialHash query)
                  integrate() (Langevin)          Lattice assignment (LatticeSystem)
                        |                         Temperature-dependent melting
                        v                               |
                  ParticleSystem.data[] <----------------+
                        |
                        v
                  ParticleRenderer.uploadParticleData()
                        |
                        v
                  VERT_SHADER (perspective + wrapping)
                  FRAG_SHADER (quaternion molecule rendering)
                        |
                        v
                      Canvas
```

## Directory Structure

```
src/
  main.ts                    # App lifecycle, game loop, seed placement
  config.ts                  # All tunable CONFIG parameters (as const)
  particles/
    ParticleSystem.ts        # Particle buffer, forces, Langevin integration
  simulation/
    FreezeSystem.ts          # Crystallization front propagation + melting
    LatticeSystem.ts         # Analytical hex lattice site computation (O(1))
    SeedRegistry.ts          # Nucleation seed management + initial freezing
  rendering/
    ParticleRenderer.ts      # WebGL2 VAO/VBO, program switching, uniforms
    SceneSetup.ts            # Background gradient quad
    shaders.ts               # Inline GLSL (vertex + 2 fragment + background)
  ui/
    Overlay.ts               # Settings panel, FPS counter, callbacks
    TouchHandler.ts          # Click/tap detection with duration/distance threshold
  utils/
    GLHelpers.ts             # Shader compilation, program linking
    SpatialHash.ts           # Grid-based O(1) neighbor lookup
styles/
  overlay.css                # Glassmorphic panel, theme variants, advanced section
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
| 8 | `OFF_Z` | Depth in 3D slab [-50, +50] |
| 9 | `OFF_QX` | Quaternion X (qw derived: sqrt(1 - qx^2 - qy^2 - qz^2)) |
| 10 | `OFF_QY` | Quaternion Y |
| 11 | `OFF_QZ` | Quaternion Z |

The same buffer is shared between CPU (physics) and GPU (re-uploaded via `bufferData` with `DYNAMIC_DRAW` each frame).

## Physics Model

### Forces (computed in `computeInteractions()`)

- **O-O soft repulsion** — overlap-based: `F = epsilon * (1 - r/sigma)^2` when `r < sigma`
- **H-O attraction** — linear falloff to cutoff: `F = epsilon * (1 - r/cutoff)`. Each molecule has 2 H atoms; attractions from both molecules create torques
- **Solid-solid attraction** — gentle pull toward `latticeSpacing` distance for frozen pairs (`min(alpha_i, alpha_j) > 0.1`)
- **Spring-to-lattice** — `F = springConstant * alpha^3 * displacement` pulls frozen molecules toward assigned hex site

### Integration (in `integrate()`)

Langevin dynamics with alpha-dependent parameters:

- **Damping**: `gamma = gammaLiquid * (1 + alpha^2 * dampingBoost)` — ranges from 1.0 (liquid) to 21.0 (solid)
- **Noise**: `noiseFraction = 1 - alpha^2 * (1 - solidNoiseFraction)` — 100% at liquid, 2% at solid
- **KE reduction**: `keScale = 1 - alpha^2 * 0.3` — kinetic energy damping for frozen molecules
- **Velocity cap**: `maxVelocity = 8.0` for stability

### Quaternion Orientation

Molecules have full SO(3) orientation stored as 3 quaternion components (qw derived from unit constraint):

- **Liquid**: Z-axis Langevin torque + XY Brownian tumbling (`tumbleScale = 0.15 * sqrt(dtStep) * noiseFraction`, where `dtStep = dt * 60`)
- **Frozen**: NLERP alignment toward a 3D crystal-tilt target. Target has lattice yaw (60deg intervals) plus deterministic pitch/roll from lattice position hash. Minimum floor: 0.6 rad pitch, 0.3 rad roll.

Small rotation quaternions are composed via first-order approximation (exact for large angles using sin/cos).

### Z-Depth

Each molecule has a z-position in a [-50, +50] slab:
- Ornstein-Uhlenbeck spring restores toward z=0
- Frozen molecules layer onto discrete z-planes (`layerSpacing = slabHalf * 0.33`)
- Z drives perspective scaling in the vertex shader: `scale = focalLength / (focalLength + z)`

## Freezing System

### Propagation Algorithm (`FreezeSystem.update()`)

1. Build spatial hash of frozen particles (alpha > 0.15)
2. For each liquid particle, query frozen neighbors within `propagationRadius` (36px)
3. Accumulate influence: `sum(alpha_j * (1 - dist/radius))` for each frozen neighbor
4. Increment alpha: `delta = influence * propagationRate * freezeScale`
5. `freezeScale` depends on temperature: 1.0 at temp=0, 0.0 at temp >= freezeThreshold (0.4)

### Lattice Assignment

Deferred until alpha crosses `latticeAssignThreshold` (0.15). This allows thermal drift before locking.

`LatticeSystem.nearestSite()` is O(1) — analytical hex lattice with seed-relative rotation. No pre-stored grid.

### Melting

Above `meltThreshold` (0.6): alpha decays per frame. Boundary molecules (lower alpha) melt first via `meltEase = 1 - 0.5*alpha`. Full melt resets seedId and equilibrium.

## Rendering Pipeline

### Vertex Shader

- Converts world position to NDC via viewport-as-window projection
- Periodic wrapping: `rel = (pos - vpOffset) mod worldSize`
- Point size: `mix(baseSizeLiquid, baseSizeSolid, alpha) * perspectiveScale * DPR`
- Edge fade: smoothstep to viewport edges
- Depth opacity: `0.18 + 0.82 * depth_norm^2` where `depth_norm = clamp((perspectiveScale - 0.83) / 0.42, 0, 1)` (strong volumetric effect)
- Off-screen culling: degenerate position (2, 2, 2)

### Fragment Shader (Glossy)

Per-pixel 3D molecule geometry:
1. Reconstruct quaternion (qw from unit constraint)
2. Rotate H1, H2 local positions via Rodrigues' formula: `v' = v + 2*qw*(q x v) + 2*(q x (q x v))`
3. Project to 2D (xy) with depth (z)
4. Draw bonds (distToSegment), then depth-sort atoms (frontmost wins)
5. Blinn-Phong shading for liquid; enhanced specular + Fresnel rim for ice
6. Premultiplied alpha output

### WebGL State

- Blend: `ONE, ONE_MINUS_SRC_ALPHA` (premultiplied)
- Depth: `LEQUAL`, depthMask=false (fragment shader handles atom ordering)
- GL_POINTS with `gl_PointSize` and `gl_PointCoord`

## Speed Control Architecture

Physics and freeze propagation are decoupled:

```typescript
// main.ts game loop
this.particles.update(dt);                    // physics always 1x (once per frame)
for (let s = 0; s < this.simSpeed; s++) {
  this.freezeSystem.update(data, count);      // freeze N times per frame
}
```

This prevents bulk drift at high speed while accelerating crystallization.

## Key Design Decisions

1. **Fixed world domain + viewport-as-window** — simulation box (2400x1350) never changes. Resize/zoom only affects the viewing window. This eliminates particle state corruption from window resizing.

2. **Periodic boundaries everywhere** — all distance calculations use minimum image convention. Particles, springs, and freeze propagation all wrap seamlessly.

3. **Deferred lattice assignment** — molecules aren't locked to lattice sites immediately. Alpha must cross 0.15 first, giving thermal motion time to find better local packing.

4. **Quaternion-based 3D orientation** — full SO(3) rotations instead of 2-DOF Euler angles. Prevents gimbal lock and enables true 3D rendering with H-atom depth sorting.

5. **Frozen 3D tilt** — frozen molecules don't collapse to flat. Each gets a deterministic pitch/roll from a hash of its lattice position, with a guaranteed minimum floor (0.6 rad / 0.3 rad).

6. **Inline GLSL shaders** — embedded as template literal strings in `shaders.ts` rather than loaded from files. Simplifies bundling and eliminates async shader loading.

7. **Spatial hashing** — grid-based O(1) neighbor lookup. Rebuilt every frame (no incremental updates). Fast enough for 5000 particles.

8. **No three.js rendering** — three.js is a dependency but not used for rendering. All WebGL2 calls are direct for maximum control over point sprites and custom shaders.

9. **Premultiplied alpha** — enables correct additive blending of semi-transparent overlapping sprites without sorting.

## Configuration

All tunable parameters are in `src/config.ts` as a single `CONFIG` object (`as const`). Key parameter groups:

- `particles` — count tiers
- `world` — domain size
- `viewport` — zoom level
- `depth` — slab range, focal length, z-spring
- `dynamics` — kT, damping, noise
- `interaction` — cutoffs, epsilon values, bond geometry
- `render` — sprite sizes, edge fade, defaults
- `freeze` — lattice spacing, propagation, spring constants
- `temperature` — phase thresholds, rates

Mutable state (temperature, propagation rate) lives on `FreezeSystem` as getter/setter properties, not in CONFIG.

## Adding New Features

### New UI control
1. Add callback to `OverlayCallbacks` interface in `Overlay.ts`
2. Add HTML element in `createUI()` panel
3. Add event listener in `createUI()`
4. Wire callback in `main.ts` constructor
5. Add CSS in `styles/overlay.css` (dark + light theme variants)

### New physics force
1. Add to `computeInteractions()` loop in `ParticleSystem.ts`
2. Use minimum image convention for periodic distances
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

## Performance Notes

- 5,000 particles at 60fps on modern hardware
- Hot path avoids allocations: pre-allocated Float32Arrays for fx, fy, torque, omegaZ
- SpatialHash rebuilds every frame (Map.clear + re-insert) — fast for N=5000
- GPU buffer upload is `bufferData` with `DYNAMIC_DRAW` (full re-upload each frame)
- Fragment shader is the bottleneck: per-pixel quaternion rotation + 3 atom depth sort
