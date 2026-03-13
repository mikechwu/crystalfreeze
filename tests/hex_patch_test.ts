/**
 * Small controlled test: 7-molecule frozen hex patch
 * 1 center molecule + 6 nearest neighbors at latticeSpacing distance
 * All frozen (alpha=1), assigned to valid lattice sites.
 *
 * Measures:
 * - O-O nearest-neighbor distances vs target (latticeSpacing=20.5)
 * - Translational kinetic energy (frozen)
 * - Rotational kinetic energy (frozen)
 * - Whether energies decay, stabilize, or grow
 * - Vibration frequency estimate
 */

import { CONFIG } from '../src/config';
import { ParticleSystem, FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_VX, OFF_VY,
  OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z, OFF_QX, OFF_QY, OFF_QZ } from '../src/particles/ParticleSystem';

const SPACING = CONFIG.freeze.latticeSpacing; // 20.5
const N = 7; // 1 center + 6 neighbors

// Place center at world center
const cx = CONFIG.world.width / 2;
const cy = CONFIG.world.height / 2;

// 6 hex neighbors at 60° intervals
const hexPositions: [number, number][] = [[cx, cy]];
for (let k = 0; k < 6; k++) {
  const angle = k * Math.PI / 3;
  hexPositions.push([
    cx + SPACING * Math.cos(angle),
    cy + SPACING * Math.sin(angle),
  ]);
}

console.log('=== HEX PATCH TEST ===');
console.log(`latticeSpacing = ${SPACING}`);
console.log(`N = ${N}`);
console.log('');

// Print lattice site coordinates
console.log('--- Lattice site coordinates ---');
for (let i = 0; i < N; i++) {
  console.log(`  site[${i}]: (${hexPositions[i][0].toFixed(2)}, ${hexPositions[i][1].toFixed(2)})`);
}

// Print expected O-O distances
console.log('');
console.log('--- Expected O-O nearest-neighbor distances ---');
for (let i = 0; i < N; i++) {
  for (let j = i + 1; j < N; j++) {
    const dx = hexPositions[j][0] - hexPositions[i][0];
    const dy = hexPositions[j][1] - hexPositions[i][1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SPACING * 1.2) {
      console.log(`  [${i}]-[${j}]: ${dist.toFixed(3)} px (target: ${SPACING})`);
    }
  }
}

// Create particle system with N particles
const ps = new ParticleSystem(N);
const d = ps.data;

// Override particle data with hex patch
for (let i = 0; i < N; i++) {
  const base = i * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = hexPositions[i][0];
  d[base + OFF_PY] = hexPositions[i][1];
  d[base + OFF_VX] = 0;
  d[base + OFF_VY] = 0;
  d[base + OFF_ALPHA] = 1.0;  // fully frozen
  d[base + OFF_SEED_ID] = 0;  // seed id 0
  d[base + OFF_EQ_X] = hexPositions[i][0]; // eq site = current position
  d[base + OFF_EQ_Y] = hexPositions[i][1];
  d[base + OFF_Z] = 0;
  // Orientation: yaw=0 (quantized to 0°), no tilt
  d[base + OFF_QX] = 0;
  d[base + OFF_QY] = 0;
  d[base + OFF_QZ] = 0; // qw = 1 (identity rotation)
}

// Run simulation for 600 frames (10 seconds at 60fps), sample every 30 frames
const dt = CONFIG.dynamics.dt;
const TOTAL_FRAMES = 600;
const SAMPLE_INTERVAL = 30;

console.log('');
console.log('--- Simulation run: 600 frames ---');
console.log('frame | avgOO_dist | maxOO_dev | transKE    | rotKE      | maxOmega');

for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
  ps.update(dt);

  if (frame % SAMPLE_INTERVAL === 0 || frame === TOTAL_FRAMES - 1) {
    // Measure O-O distances for nearest neighbors
    let ooDistSum = 0;
    let ooCount = 0;
    let maxOODev = 0;
    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      for (let j = i + 1; j < N; j++) {
        const bj = j * FLOATS_PER_PARTICLE;
        let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
        let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
        const hw = CONFIG.world.width / 2;
        const hh = CONFIG.world.height / 2;
        if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
        if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < SPACING * 1.5) { // nearest neighbors only
          ooDistSum += dist;
          ooCount++;
          const dev = Math.abs(dist - SPACING);
          if (dev > maxOODev) maxOODev = dev;
        }
      }
    }
    const avgOO = ooCount > 0 ? ooDistSum / ooCount : 0;

    // Translational KE
    let transKE = 0;
    let rotKE = 0;
    let maxOmega = 0;
    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      const vx = d[bi + OFF_VX];
      const vy = d[bi + OFF_VY];
      transKE += 0.5 * (vx * vx + vy * vy);
    }
    // rotKE from debugStats
    rotKE = ps.debugStats.frozenAvgErot * N;
    maxOmega = ps.debugStats.maxOmega;

    console.log(
      `${String(frame).padStart(5)} | ${avgOO.toFixed(3).padStart(10)} | ${maxOODev.toFixed(3).padStart(9)} | ${transKE.toExponential(3).padStart(10)} | ${rotKE.toExponential(3).padStart(10)} | ${maxOmega.toFixed(4)}`
    );
  }
}

// Final position check
console.log('');
console.log('--- Final positions vs equilibrium ---');
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const px = d[bi + OFF_PX];
  const py = d[bi + OFF_PY];
  const eqx = d[bi + OFF_EQ_X];
  const eqy = d[bi + OFF_EQ_Y];
  const dx = px - eqx;
  const dy = py - eqy;
  const drift = Math.sqrt(dx * dx + dy * dy);
  console.log(`  mol[${i}]: pos=(${px.toFixed(2)}, ${py.toFixed(2)}) eq=(${eqx.toFixed(2)}, ${eqy.toFixed(2)}) drift=${drift.toFixed(3)}px`);
}

// Final O-O distances
console.log('');
console.log('--- Final O-O nearest-neighbor distances ---');
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  for (let j = i + 1; j < N; j++) {
    const bj = j * FLOATS_PER_PARTICLE;
    let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
    let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
    const hw = CONFIG.world.width / 2;
    const hh = CONFIG.world.height / 2;
    if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
    if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SPACING * 1.5) {
      const err = ((dist - SPACING) / SPACING * 100).toFixed(2);
      console.log(`  [${i}]-[${j}]: ${dist.toFixed(3)} px (err: ${err}%)`);
    }
  }
}

console.log('');
console.log('=== GOOD/BAD CRITERIA CHECK ===');
// Evaluate against criteria
const finalFrame = TOTAL_FRAMES - 1;
// Re-measure final state
let finalTransKE = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const vx = d[bi + OFF_VX];
  const vy = d[bi + OFF_VY];
  finalTransKE += 0.5 * (vx * vx + vy * vy);
}
const finalRotKE = ps.debugStats.frozenAvgErot * N;
const finalMaxOmega = ps.debugStats.maxOmega;

// Check max drift from eq
let maxDrift = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const dx = d[bi + OFF_PX] - d[bi + OFF_EQ_X];
  const dy = d[bi + OFF_PY] - d[bi + OFF_EQ_Y];
  const drift = Math.sqrt(dx * dx + dy * dy);
  if (drift > maxDrift) maxDrift = drift;
}

// Check O-O distance error
let maxOOErr = 0;
let nnCount = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  for (let j = i + 1; j < N; j++) {
    const bj = j * FLOATS_PER_PARTICLE;
    let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
    let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
    const hw = CONFIG.world.width / 2;
    const hh = CONFIG.world.height / 2;
    if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
    if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SPACING * 1.5) {
      const err = Math.abs(dist - SPACING) / SPACING;
      if (err > maxOOErr) maxOOErr = err;
      nnCount++;
    }
  }
}

console.log(`1. Max drift from equilibrium: ${maxDrift.toFixed(3)} px (GOOD < 2.0)`);
console.log(`2. Max O-O distance error: ${(maxOOErr * 100).toFixed(2)}% (GOOD < 5%)`);
console.log(`3. Final translational KE: ${finalTransKE.toExponential(3)} (GOOD < 0.01)`);
console.log(`4. Final rotational KE: ${finalRotKE.toExponential(3)} (GOOD < 0.001)`);
console.log(`5. Final max omega: ${finalMaxOmega.toFixed(4)} (GOOD < 0.1)`);
console.log(`6. Nearest neighbors found: ${nnCount} (expected: 12 for 7-mol hex)`);

const pass1 = maxDrift < 2.0;
const pass2 = maxOOErr < 0.05;
const pass3 = finalTransKE < 0.01;
const pass4 = finalRotKE < 0.001;
const pass5 = finalMaxOmega < 0.1;

console.log('');
console.log(`OVERALL: ${pass1 && pass2 && pass3 && pass4 && pass5 ? 'GOOD' : 'BAD'}`);
if (!pass1) console.log('  FAIL: drift too large');
if (!pass2) console.log('  FAIL: O-O distance error too large');
if (!pass3) console.log('  FAIL: translational KE too high');
if (!pass4) console.log('  FAIL: rotational KE too high');
if (!pass5) console.log('  FAIL: omega too high');
