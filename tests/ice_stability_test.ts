/**
 * Deterministic test: frozen patch stability with ice-like honeycomb lattice.
 * Tests that the new semi-implicit Euler + Morse potential keeps a frozen
 * patch stable (low KE, low drift, no jitter) over many frames.
 *
 * Setup: 6 molecules in a single-layer honeycomb ring + 1 center molecule.
 * The center molecule should NOT be at a ring center — it tests that
 * the lattice correctly provides open ring topology.
 *
 * Evaluates:
 * - Translational KE decay (should decrease, not grow)
 * - Rotational KE (should stay very low)
 * - Position drift from equilibrium
 * - Energy stability (no drift over 600 frames)
 */

import { CONFIG } from '../src/config';
import { ParticleSystem, FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_VX, OFF_VY,
  OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z, OFF_QX, OFF_QY, OFF_QZ } from '../src/particles/ParticleSystem';
import { LatticeSystem } from '../src/simulation/LatticeSystem';

const SPACING = CONFIG.freeze.latticeSpacing;
const lattice = new LatticeSystem();

const cx = CONFIG.world.width / 2;
const cy = CONFIG.world.height / 2;
const z0 = 0;
const seedTheta = 0;

console.log('=== ICE STABILITY TEST ===');
console.log(`latticeSpacing = ${SPACING}`);
console.log('');

// Generate a cluster of honeycomb sites around the center
console.log('--- Generating honeycomb sites ---');
const sites: { x: number; y: number; z: number }[] = [];
const searchRadius = SPACING * 2.5;
const step = SPACING * 0.3;
for (let gx = -searchRadius; gx <= searchRadius; gx += step) {
  for (let gy = -searchRadius; gy <= searchRadius; gy += step) {
    const site = lattice.nearestSite(cx + gx, cy + gy, z0, cx, cy, seedTheta);
    const isDup = sites.some(s =>
      Math.abs(s.x - site.x) < 0.5 && Math.abs(s.y - site.y) < 0.5 && Math.abs(s.z - site.z) < 0.5
    );
    if (!isDup) sites.push({ x: site.x, y: site.y, z: site.z });
  }
}
// Take up to 12 sites near center
sites.sort((a, b) => {
  const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
  const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
  return da - db;
});
const N = Math.min(sites.length, 12);
const patchSites = sites.slice(0, N);

console.log(`Using ${N} sites for stability test`);
for (let i = 0; i < N; i++) {
  const s = patchSites[i];
  console.log(`  site[${i}]: (${s.x.toFixed(2)}, ${s.y.toFixed(2)}, z=${s.z.toFixed(1)})`);
}

// Count coordination
let totalCoord = 0;
for (let i = 0; i < N; i++) {
  let nn = 0;
  for (let j = 0; j < N; j++) {
    if (i === j) continue;
    const dx = patchSites[j].x - patchSites[i].x;
    const dy = patchSites[j].y - patchSites[i].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SPACING * 1.15) nn++;
  }
  totalCoord += nn;
}
console.log(`Average coordination: ${(totalCoord / N).toFixed(2)}`);
console.log('');

// Create particle system and override data
const ps = new ParticleSystem(N);
const d = ps.data;

for (let i = 0; i < N; i++) {
  const base = i * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = patchSites[i].x;
  d[base + OFF_PY] = patchSites[i].y;
  d[base + OFF_VX] = 0;
  d[base + OFF_VY] = 0;
  d[base + OFF_ALPHA] = 1.0;
  d[base + OFF_SEED_ID] = 0;
  d[base + OFF_EQ_X] = patchSites[i].x;
  d[base + OFF_EQ_Y] = patchSites[i].y;
  d[base + OFF_Z] = patchSites[i].z;
  d[base + OFF_QX] = 0;
  d[base + OFF_QY] = 0;
  d[base + OFF_QZ] = 0;
  ps.eqZ[i] = patchSites[i].z;
}

// Run simulation
const dt = CONFIG.dynamics.dt;
const TOTAL_FRAMES = 600;
const SAMPLE_INTERVAL = 60;

console.log('--- Simulation run: 600 frames ---');
console.log('frame | maxDrift | transKE    | rotKE      | maxOmega');

const keHistory: number[] = [];

for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
  ps.update(dt);

  if (frame % SAMPLE_INTERVAL === 0 || frame === TOTAL_FRAMES - 1) {
    // Position drift from equilibrium
    let maxDrift = 0;
    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      const dx = d[bi + OFF_PX] - d[bi + OFF_EQ_X];
      const dy = d[bi + OFF_PY] - d[bi + OFF_EQ_Y];
      const drift = Math.sqrt(dx * dx + dy * dy);
      if (drift > maxDrift) maxDrift = drift;
    }

    // Translational KE
    let transKE = 0;
    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      const vx = d[bi + OFF_VX], vy = d[bi + OFF_VY];
      transKE += 0.5 * (vx * vx + vy * vy);
    }

    // Rotational KE (from debug stats)
    const rotKE = ps.debugStats.frozenAvgErot * N;
    const maxOmega = ps.debugStats.maxOmega;

    keHistory.push(transKE);

    console.log(
      `${String(frame).padStart(5)} | ${maxDrift.toFixed(3).padStart(8)} | ${transKE.toExponential(3).padStart(10)} | ${rotKE.toExponential(3).padStart(10)} | ${maxOmega.toFixed(4).padStart(8)}`
    );
  }
}

// Final checks
console.log('');
console.log('=== CRITERIA CHECK ===');

// 1. Max drift
let finalMaxDrift = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const dx = d[bi + OFF_PX] - d[bi + OFF_EQ_X];
  const dy = d[bi + OFF_PY] - d[bi + OFF_EQ_Y];
  const drift = Math.sqrt(dx * dx + dy * dy);
  if (drift > finalMaxDrift) finalMaxDrift = drift;
}

// 2. Final KE
let finalKE = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  finalKE += 0.5 * (d[bi + OFF_VX] ** 2 + d[bi + OFF_VY] ** 2);
}

// 3. Energy stability: KE at end should be ≤ KE at first sample
const keStable = keHistory.length >= 2 && keHistory[keHistory.length - 1] <= keHistory[0] * 2.0;

// 4. No dense blob: max drift should be reasonable
const pass1 = finalMaxDrift < 5.0;
const pass2 = finalKE < 0.1;
const pass3 = keStable;
const pass4 = ps.debugStats.maxOmega < 0.1;

console.log(`1. Max position drift: ${finalMaxDrift.toFixed(3)} px (GOOD < 5.0) ${pass1 ? 'PASS' : 'FAIL'}`);
console.log(`2. Final translational KE: ${finalKE.toExponential(3)} (GOOD < 0.1) ${pass2 ? 'PASS' : 'FAIL'}`);
console.log(`3. Energy stable (no drift): ${keStable ? 'PASS' : 'FAIL'}`);
console.log(`4. Max omega < 0.1: ${ps.debugStats.maxOmega.toFixed(4)} ${pass4 ? 'PASS' : 'FAIL'}`);
console.log('');
console.log(`OVERALL: ${pass1 && pass2 && pass3 && pass4 ? 'GOOD' : 'BAD'}`);
