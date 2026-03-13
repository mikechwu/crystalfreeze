/**
 * Larger controlled test: 37-molecule frozen hex patch (3 rings)
 * Ring 0: 1 center
 * Ring 1: 6 neighbors at 1× latticeSpacing
 * Ring 2: 12 neighbors at √3× and 2× latticeSpacing
 * Ring 3: 18 neighbors at 2×, √7× latticeSpacing
 *
 * Tests medium-scale behavior: whether the structure holds,
 * whether energy grows with cluster size, whether vibration
 * frequency increases compared to the 7-molecule patch.
 */

import { CONFIG } from '../src/config';
import { ParticleSystem, FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_VX, OFF_VY,
  OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z, OFF_QX, OFF_QY, OFF_QZ } from '../src/particles/ParticleSystem';

const SPACING = CONFIG.freeze.latticeSpacing; // 20.5
const ROW_SPACING = SPACING * 0.8660254; // sqrt(3)/2

// Generate hex lattice sites for 3 rings around center
const cx = CONFIG.world.width / 2;
const cy = CONFIG.world.height / 2;

interface Site { x: number; y: number; ring: number; }
const sites: Site[] = [];
const siteSet = new Set<string>();

function addSite(x: number, y: number, ring: number) {
  const key = `${Math.round(x*10)},${Math.round(y*10)}`;
  if (!siteSet.has(key)) {
    siteSet.add(key);
    sites.push({ x, y, ring });
  }
}

// Generate hex grid sites within 3.5× latticeSpacing of center
// Use axial coordinates for hex grid
for (let q = -4; q <= 4; q++) {
  for (let r = -4; r <= 4; r++) {
    // Axial to cartesian
    const x = cx + SPACING * (q + r * 0.5);
    const y = cy + ROW_SPACING * r;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    const ring = Math.round(dist / SPACING);
    if (dist < SPACING * 3.5) {
      addSite(x, y, ring);
    }
  }
}

const N = sites.length;
console.log(`=== 3-RING HEX PATCH TEST (${N} molecules) ===`);
console.log(`latticeSpacing = ${SPACING}`);

// Count by ring
const ringCounts: Record<number, number> = {};
for (const s of sites) {
  ringCounts[s.ring] = (ringCounts[s.ring] || 0) + 1;
}
console.log('Ring distribution:', JSON.stringify(ringCounts));

// Print sites
console.log('');
console.log('--- Lattice site coordinates ---');
for (let i = 0; i < N; i++) {
  const s = sites[i];
  const dist = Math.sqrt((s.x - cx) ** 2 + (s.y - cy) ** 2);
  console.log(`  site[${String(i).padStart(2)}]: (${s.x.toFixed(2)}, ${s.y.toFixed(2)}) ring=${s.ring} dist=${dist.toFixed(2)}`);
}

// Count nearest-neighbor pairs
let nnPairs = 0;
for (let i = 0; i < N; i++) {
  for (let j = i + 1; j < N; j++) {
    const dx = sites[j].x - sites[i].x;
    const dy = sites[j].y - sites[i].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SPACING * 1.15) nnPairs++;
  }
}
console.log(`\nNearest-neighbor pairs: ${nnPairs}`);

// Create particle system
const ps = new ParticleSystem(N);
const d = ps.data;

// Override all particles with hex patch
for (let i = 0; i < N; i++) {
  const base = i * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = sites[i].x;
  d[base + OFF_PY] = sites[i].y;
  d[base + OFF_VX] = 0;
  d[base + OFF_VY] = 0;
  d[base + OFF_ALPHA] = 1.0;
  d[base + OFF_SEED_ID] = 0;
  d[base + OFF_EQ_X] = sites[i].x;
  d[base + OFF_EQ_Y] = sites[i].y;
  d[base + OFF_Z] = 0;
  d[base + OFF_QX] = 0;
  d[base + OFF_QY] = 0;
  d[base + OFF_QZ] = 0;
}

// Run simulation
const dt = CONFIG.dynamics.dt;
const TOTAL_FRAMES = 600;
const SAMPLE_INTERVAL = 30;

console.log('');
console.log('--- Simulation run: 600 frames ---');
console.log('frame | avgOO_dist | maxOO_dev | transKE    | rotKE      | maxOmega | maxVel   | maxDrift');

for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
  ps.update(dt);

  if (frame % SAMPLE_INTERVAL === 0 || frame === TOTAL_FRAMES - 1) {
    let ooDistSum = 0, ooCount = 0, maxOODev = 0;
    let transKE = 0, maxVel = 0, maxDrift = 0;
    const hw = CONFIG.world.width / 2;
    const hh = CONFIG.world.height / 2;

    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      const vx = d[bi + OFF_VX], vy = d[bi + OFF_VY];
      const v = Math.sqrt(vx * vx + vy * vy);
      transKE += 0.5 * (vx * vx + vy * vy);
      if (v > maxVel) maxVel = v;

      const driftX = d[bi + OFF_PX] - d[bi + OFF_EQ_X];
      const driftY = d[bi + OFF_PY] - d[bi + OFF_EQ_Y];
      const drift = Math.sqrt(driftX * driftX + driftY * driftY);
      if (drift > maxDrift) maxDrift = drift;

      for (let j = i + 1; j < N; j++) {
        const bj = j * FLOATS_PER_PARTICLE;
        let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
        let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
        if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
        if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < SPACING * 1.15) {
          ooDistSum += dist;
          ooCount++;
          const dev = Math.abs(dist - SPACING);
          if (dev > maxOODev) maxOODev = dev;
        }
      }
    }
    const avgOO = ooCount > 0 ? ooDistSum / ooCount : 0;
    const rotKE = ps.debugStats.frozenAvgErot * N;

    console.log(
      `${String(frame).padStart(5)} | ${avgOO.toFixed(3).padStart(10)} | ${maxOODev.toFixed(3).padStart(9)} | ${transKE.toExponential(3).padStart(10)} | ${rotKE.toExponential(3).padStart(10)} | ${ps.debugStats.maxOmega.toFixed(4).padStart(8)} | ${maxVel.toFixed(4).padStart(8)} | ${maxDrift.toFixed(3)}`
    );
  }
}

// Final analysis
console.log('');
console.log('--- Final O-O distance statistics ---');
let ooAll: number[] = [];
const hw = CONFIG.world.width / 2;
const hh = CONFIG.world.height / 2;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  for (let j = i + 1; j < N; j++) {
    const bj = j * FLOATS_PER_PARTICLE;
    let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
    let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
    if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
    if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SPACING * 1.15) ooAll.push(dist);
  }
}
ooAll.sort((a, b) => a - b);
const mean = ooAll.reduce((s, v) => s + v, 0) / ooAll.length;
const stddev = Math.sqrt(ooAll.reduce((s, v) => s + (v - mean) ** 2, 0) / ooAll.length);
console.log(`  NN pairs: ${ooAll.length}`);
console.log(`  Mean O-O: ${mean.toFixed(4)} (target: ${SPACING})`);
console.log(`  Std dev: ${stddev.toFixed(4)}`);
console.log(`  Min: ${ooAll[0].toFixed(4)}`);
console.log(`  Max: ${ooAll[ooAll.length - 1].toFixed(4)}`);
console.log(`  Max error: ${((Math.max(Math.abs(ooAll[0] - SPACING), Math.abs(ooAll[ooAll.length-1] - SPACING)) / SPACING) * 100).toFixed(3)}%`);

// Final drift
let maxFinalDrift = 0;
let avgFinalDrift = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const dx = d[bi + OFF_PX] - d[bi + OFF_EQ_X];
  const dy = d[bi + OFF_PY] - d[bi + OFF_EQ_Y];
  const drift = Math.sqrt(dx * dx + dy * dy);
  avgFinalDrift += drift;
  if (drift > maxFinalDrift) maxFinalDrift = drift;
}
avgFinalDrift /= N;

console.log('');
console.log('--- Final drift from equilibrium ---');
console.log(`  Max drift: ${maxFinalDrift.toFixed(4)} px`);
console.log(`  Avg drift: ${avgFinalDrift.toFixed(4)} px`);

// Final energy
let finalTransKE = 0;
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  finalTransKE += 0.5 * (d[bi + OFF_VX] ** 2 + d[bi + OFF_VY] ** 2);
}

console.log('');
console.log('=== GOOD/BAD CRITERIA CHECK ===');
const pass1 = maxFinalDrift < 2.0;
const pass2 = ((Math.max(Math.abs(ooAll[0] - SPACING), Math.abs(ooAll[ooAll.length-1] - SPACING)) / SPACING)) < 0.05;
const pass3 = finalTransKE < 0.1;
const pass4 = ps.debugStats.frozenAvgErot * N < 0.01;
const pass5 = ps.debugStats.maxOmega < 0.1;

console.log(`1. Max drift: ${maxFinalDrift.toFixed(4)} px (GOOD < 2.0) ${pass1 ? 'PASS' : 'FAIL'}`);
console.log(`2. Max O-O error: ${((Math.max(Math.abs(ooAll[0] - SPACING), Math.abs(ooAll[ooAll.length-1] - SPACING)) / SPACING) * 100).toFixed(3)}% (GOOD < 5%) ${pass2 ? 'PASS' : 'FAIL'}`);
console.log(`3. Total transKE: ${finalTransKE.toExponential(3)} (GOOD < 0.1) ${pass3 ? 'PASS' : 'FAIL'}`);
console.log(`4. Total rotKE: ${(ps.debugStats.frozenAvgErot * N).toExponential(3)} (GOOD < 0.01) ${pass4 ? 'PASS' : 'FAIL'}`);
console.log(`5. Max omega: ${ps.debugStats.maxOmega.toFixed(4)} (GOOD < 0.1) ${pass5 ? 'PASS' : 'FAIL'}`);
console.log(`6. NN pairs: ${ooAll.length} (expected: ${nnPairs}) ${ooAll.length === nnPairs ? 'PASS' : 'FAIL'}`);

console.log('');
console.log(`OVERALL: ${pass1 && pass2 && pass3 && pass4 && pass5 ? 'GOOD' : 'BAD'}`);
if (!pass1) console.log('  FAIL: drift too large');
if (!pass2) console.log('  FAIL: O-O distance error too large');
if (!pass3) console.log('  FAIL: translational KE too high');
if (!pass4) console.log('  FAIL: rotational KE too high');
if (!pass5) console.log('  FAIL: omega too high');

// Compare per-molecule energy with 7-molecule test
console.log('');
console.log('--- Scaling comparison ---');
console.log(`  Per-molecule transKE: ${(finalTransKE / N).toExponential(3)} (7-mol test: ~3e-5)`);
console.log(`  Per-molecule rotKE: ${ps.debugStats.frozenAvgErot.toExponential(3)} (7-mol test: ~3e-5)`);
console.log(`  Ratio (should be ~1.0 if no scaling issue): transKE=${(finalTransKE / N / 3e-5).toFixed(2)}x, rotKE=${(ps.debugStats.frozenAvgErot / 3e-5).toFixed(2)}x`);
