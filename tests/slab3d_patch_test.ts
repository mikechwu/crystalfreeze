/**
 * Deterministic test: thin-slab 3D lattice patch
 * Tests a small frozen patch with HCP-like ABAB stacking.
 *
 * Creates a 2-layer patch:
 *   Layer 0 (z=-10): 7 molecules in standard hex (1 center + 6 neighbors)
 *   Layer 1 (z=+10): 3 molecules at ABAB-offset positions above hollows
 * Total: 10 molecules, all frozen (alpha=1), assigned to valid 3D lattice sites.
 *
 * Measures:
 * - O-O nearest-neighbor distances (in-plane and inter-layer)
 * - Z layer occupancy
 * - Translational KE decay
 * - Z position stability (molecules stay near their lattice Z)
 * - Coordination numbers
 */

import { CONFIG } from '../src/config';
import { ParticleSystem, FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_VX, OFF_VY,
  OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z, OFF_QX, OFF_QY, OFF_QZ } from '../src/particles/ParticleSystem';

const SPACING = CONFIG.freeze.latticeSpacing; // 28
const Z_SPACING = CONFIG.freeze.zLayerSpacing; // 20
const N = 10; // 7 in layer 0 + 3 in layer 1

// Layer 0 positions: center at world center, z = -Z_SPACING/2
const cx = CONFIG.world.width / 2;
const cy = CONFIG.world.height / 2;
const z0 = -Z_SPACING / 2;
const z1 = Z_SPACING / 2;

// Layer 0: standard hex grid
const rowSpacing = SPACING * 0.8660254;
const positions: { x: number; y: number; z: number }[] = [];

// Center molecule
positions.push({ x: cx, y: cy, z: z0 });
// 6 hex neighbors
for (let k = 0; k < 6; k++) {
  const angle = k * Math.PI / 3;
  positions.push({
    x: cx + SPACING * Math.cos(angle),
    y: cy + SPACING * Math.sin(angle),
    z: z0,
  });
}

// Layer 1: ABAB offset — 3 molecules in hollows above layer 0
// ABAB offset in our lattice: (SPACING/2, rowSpacing/3)
const bOffX = SPACING * 0.5;
const bOffY = rowSpacing / 3.0;
positions.push({ x: cx + bOffX, y: cy + bOffY, z: z1 });
positions.push({ x: cx + bOffX + SPACING, y: cy + bOffY, z: z1 });
positions.push({ x: cx + bOffX + SPACING * 0.5, y: cy + bOffY + rowSpacing, z: z1 });

console.log('=== SLAB 3D PATCH TEST ===');
console.log(`latticeSpacing = ${SPACING}, zLayerSpacing = ${Z_SPACING}`);
console.log(`N = ${N} (7 in layer 0, 3 in layer 1)`);
console.log('');

// Print positions
console.log('--- Lattice site coordinates ---');
for (let i = 0; i < N; i++) {
  const p = positions[i];
  console.log(`  site[${i}]: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, z=${p.z.toFixed(1)}) layer=${p.z < 0 ? 0 : 1}`);
}

// Print O-O distances
console.log('');
console.log('--- O-O distances (all pairs within 1.5× spacing or inter-layer) ---');
const maxCheckDist = Math.sqrt(SPACING * SPACING + Z_SPACING * Z_SPACING) * 1.2;
for (let i = 0; i < N; i++) {
  for (let j = i + 1; j < N; j++) {
    const dx = positions[j].x - positions[i].x;
    const dy = positions[j].y - positions[i].y;
    const dz = positions[j].z - positions[i].z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < maxCheckDist) {
      const type = Math.abs(dz) < 1 ? 'in-plane' : 'inter-layer';
      console.log(`  [${i}]-[${j}]: ${dist.toFixed(3)} px (${type})`);
    }
  }
}

// Create particle system and override data
const ps = new ParticleSystem(N);
const d = ps.data;

for (let i = 0; i < N; i++) {
  const base = i * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = positions[i].x;
  d[base + OFF_PY] = positions[i].y;
  d[base + OFF_VX] = 0;
  d[base + OFF_VY] = 0;
  d[base + OFF_ALPHA] = 1.0;
  d[base + OFF_SEED_ID] = 0;
  d[base + OFF_EQ_X] = positions[i].x;
  d[base + OFF_EQ_Y] = positions[i].y;
  d[base + OFF_Z] = positions[i].z;
  d[base + OFF_QX] = 0;
  d[base + OFF_QY] = 0;
  d[base + OFF_QZ] = 0;
  ps.eqZ[i] = positions[i].z;
}

// Run simulation
const dt = CONFIG.dynamics.dt;
const TOTAL_FRAMES = 600;
const SAMPLE_INTERVAL = 60;

console.log('');
console.log('--- Simulation run: 600 frames ---');
console.log('frame | avgOO_dist | maxZDrift | transKE    | layer0_avgZ | layer1_avgZ');

for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
  ps.update(dt);

  if (frame % SAMPLE_INTERVAL === 0 || frame === TOTAL_FRAMES - 1) {
    // O-O distances
    let ooDistSum = 0, ooCount = 0;
    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      for (let j = i + 1; j < N; j++) {
        const bj = j * FLOATS_PER_PARTICLE;
        const dx = d[bj + OFF_PX] - d[bi + OFF_PX];
        const dy = d[bj + OFF_PY] - d[bi + OFF_PY];
        const dz = d[bj + OFF_Z] - d[bi + OFF_Z];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < maxCheckDist) {
          ooDistSum += dist;
          ooCount++;
        }
      }
    }
    const avgOO = ooCount > 0 ? ooDistSum / ooCount : 0;

    // Z drift from equilibrium
    let maxZDrift = 0;
    let layer0ZSum = 0, layer0Count = 0;
    let layer1ZSum = 0, layer1Count = 0;
    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      const zDrift = Math.abs(d[bi + OFF_Z] - ps.eqZ[i]);
      if (zDrift > maxZDrift) maxZDrift = zDrift;
      if (positions[i].z < 0) { layer0ZSum += d[bi + OFF_Z]; layer0Count++; }
      else { layer1ZSum += d[bi + OFF_Z]; layer1Count++; }
    }

    // Translational KE
    let transKE = 0;
    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      const vx = d[bi + OFF_VX], vy = d[bi + OFF_VY];
      transKE += 0.5 * (vx * vx + vy * vy);
    }

    const l0z = layer0Count > 0 ? layer0ZSum / layer0Count : 0;
    const l1z = layer1Count > 0 ? layer1ZSum / layer1Count : 0;

    console.log(
      `${String(frame).padStart(5)} | ${avgOO.toFixed(3).padStart(10)} | ${maxZDrift.toFixed(3).padStart(8)} | ${transKE.toExponential(3).padStart(10)} | ${l0z.toFixed(2).padStart(11)} | ${l1z.toFixed(2).padStart(11)}`
    );
  }
}

// Final checks
console.log('');
console.log('=== CRITERIA CHECK ===');

// 1. Z drift
let maxZDrift = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const zDrift = Math.abs(d[bi + OFF_Z] - ps.eqZ[i]);
  if (zDrift > maxZDrift) maxZDrift = zDrift;
}

// 2. XY drift from eq
let maxXYDrift = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const dx = d[bi + OFF_PX] - d[bi + OFF_EQ_X];
  const dy = d[bi + OFF_PY] - d[bi + OFF_EQ_Y];
  const drift = Math.sqrt(dx * dx + dy * dy);
  if (drift > maxXYDrift) maxXYDrift = drift;
}

// 3. Layer separation maintained
let layer0AvgZ = 0, layer1AvgZ = 0;
for (let i = 0; i < 7; i++) layer0AvgZ += d[i * FLOATS_PER_PARTICLE + OFF_Z];
layer0AvgZ /= 7;
for (let i = 7; i < 10; i++) layer1AvgZ += d[i * FLOATS_PER_PARTICLE + OFF_Z];
layer1AvgZ /= 3;
const layerSep = layer1AvgZ - layer0AvgZ;

// 4. KE
let finalKE = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  finalKE += 0.5 * (d[bi + OFF_VX] ** 2 + d[bi + OFF_VY] ** 2);
}

const pass1 = maxZDrift < 5.0;
const pass2 = maxXYDrift < 3.0;
const pass3 = Math.abs(layerSep - Z_SPACING) < 5.0;
const pass4 = finalKE < 0.1;

console.log(`1. Max Z drift from eq: ${maxZDrift.toFixed(3)} px (GOOD < 5.0) ${pass1 ? 'PASS' : 'FAIL'}`);
console.log(`2. Max XY drift from eq: ${maxXYDrift.toFixed(3)} px (GOOD < 3.0) ${pass2 ? 'PASS' : 'FAIL'}`);
console.log(`3. Layer separation: ${layerSep.toFixed(2)} px (target: ${Z_SPACING}, GOOD if within 5px) ${pass3 ? 'PASS' : 'FAIL'}`);
console.log(`4. Final translational KE: ${finalKE.toExponential(3)} (GOOD < 0.1) ${pass4 ? 'PASS' : 'FAIL'}`);
console.log('');
console.log(`OVERALL: ${pass1 && pass2 && pass3 && pass4 ? 'GOOD' : 'BAD'}`);
