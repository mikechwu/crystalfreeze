/**
 * Density audit: measure liquid vs frozen O-O spacing and local density.
 * Creates a mixed system: half liquid, half frozen hex patch.
 * Runs simulation and measures nearest-neighbor distances in each phase.
 */

import { CONFIG } from '../src/config';
import { ParticleSystem, FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_VX, OFF_VY,
  OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z, OFF_QX, OFF_QY, OFF_QZ } from '../src/particles/ParticleSystem';

const sigma = CONFIG.interaction.sigmaOO;
const SPACING = CONFIG.freeze.latticeSpacing;
const cx = CONFIG.world.width / 2;
const cy = CONFIG.world.height / 2;

console.log('=== DENSITY AUDIT TEST ===');
console.log(`sigmaOO = ${sigma}`);
console.log(`latticeSpacing = ${SPACING}`);
console.log(`ratio latticeSpacing/sigmaOO = ${(SPACING / sigma).toFixed(4)}`);
console.log('');

// Generate liquid particles in left half of a local region
// and a frozen hex patch in right half
const ROW_SPACING = SPACING * 0.8660254; // sqrt(3)/2

// Frozen hex patch (3 rings) centered at (cx+100, cy)
const frozenCx = cx + 100;
const frozenCy = cy;
const frozenSites: { x: number; y: number }[] = [];
const siteSet = new Set<string>();

for (let q = -4; q <= 4; q++) {
  for (let r = -4; r <= 4; r++) {
    const x = frozenCx + SPACING * (q + r * 0.5);
    const y = frozenCy + ROW_SPACING * r;
    const dist = Math.sqrt((x - frozenCx) ** 2 + (y - frozenCy) ** 2);
    if (dist < SPACING * 3.5) {
      const key = `${Math.round(x * 10)},${Math.round(y * 10)}`;
      if (!siteSet.has(key)) {
        siteSet.add(key);
        frozenSites.push({ x, y });
      }
    }
  }
}

// Liquid particles in left region, using sigma-based spacing
const liquidCx = cx - 100;
const liquidCy = cy;
const liquidSpacing = sigma * 1.05; // slightly above sigma for liquid
const liquidRowSpacing = liquidSpacing * 0.866;
const liquidPositions: { x: number; y: number }[] = [];
const liquidRadius = 80;

for (let row = -Math.ceil(liquidRadius / liquidRowSpacing); row <= Math.ceil(liquidRadius / liquidRowSpacing); row++) {
  const yOff = row * liquidRowSpacing;
  const xOff = (((row % 2) + 2) % 2) * liquidSpacing * 0.5;
  for (let col = -Math.ceil(liquidRadius / liquidSpacing); col <= Math.ceil(liquidRadius / liquidSpacing); col++) {
    const x = liquidCx + col * liquidSpacing + xOff + (Math.random() - 0.5) * liquidSpacing * 0.3;
    const y = liquidCy + yOff + (Math.random() - 0.5) * liquidSpacing * 0.3;
    const dist = Math.sqrt((x - liquidCx) ** 2 + (y - liquidCy) ** 2);
    if (dist < liquidRadius) {
      liquidPositions.push({ x, y });
    }
  }
}

const N_FROZEN = frozenSites.length;
const N_LIQUID = liquidPositions.length;
const N = N_FROZEN + N_LIQUID;

console.log(`Frozen patch: ${N_FROZEN} molecules (3-ring hex at spacing=${SPACING})`);
console.log(`Liquid region: ${N_LIQUID} molecules (random at ~${liquidSpacing.toFixed(1)}px)`);
console.log(`Total: ${N}`);
console.log('');

// Create system
const ps = new ParticleSystem(N);
const d = ps.data;

// Set up frozen molecules
for (let i = 0; i < N_FROZEN; i++) {
  const base = i * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = frozenSites[i].x;
  d[base + OFF_PY] = frozenSites[i].y;
  d[base + OFF_VX] = 0;
  d[base + OFF_VY] = 0;
  d[base + OFF_ALPHA] = 1.0;
  d[base + OFF_SEED_ID] = 0;
  d[base + OFF_EQ_X] = frozenSites[i].x;
  d[base + OFF_EQ_Y] = frozenSites[i].y;
  d[base + OFF_Z] = 0;
  d[base + OFF_QX] = 0;
  d[base + OFF_QY] = 0;
  d[base + OFF_QZ] = 0;
}

// Set up liquid molecules
for (let i = 0; i < N_LIQUID; i++) {
  const base = (N_FROZEN + i) * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = liquidPositions[i].x;
  d[base + OFF_PY] = liquidPositions[i].y;
  d[base + OFF_VX] = (Math.random() - 0.5) * CONFIG.dynamics.kT;
  d[base + OFF_VY] = (Math.random() - 0.5) * CONFIG.dynamics.kT;
  d[base + OFF_ALPHA] = 0;
  d[base + OFF_SEED_ID] = -1;
  d[base + OFF_EQ_X] = 0;
  d[base + OFF_EQ_Y] = 0;
  d[base + OFF_Z] = 0;
  d[base + OFF_QX] = 0;
  d[base + OFF_QY] = 0;
  d[base + OFF_QZ] = Math.sin(Math.random() * Math.PI);
}

// Run simulation to let liquid equilibrate
const dt = CONFIG.dynamics.dt;
const EQUIL_FRAMES = 300;
console.log(`Equilibrating ${EQUIL_FRAMES} frames...`);
for (let frame = 0; frame < EQUIL_FRAMES; frame++) {
  ps.update(dt);
}
console.log('Done.\n');

// Measure O-O nearest-neighbor distances
const hw = CONFIG.world.width / 2;
const hh = CONFIG.world.height / 2;
const nnCutoff = sigma * 1.5; // count neighbors within 1.5σ

// Frozen phase analysis
let frozenNNDistances: number[] = [];
for (let i = 0; i < N_FROZEN; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  let minDist = Infinity;
  for (let j = 0; j < N_FROZEN; j++) {
    if (j === i) continue;
    const bj = j * FLOATS_PER_PARTICLE;
    let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
    let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
    if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
    if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) minDist = dist;
  }
  if (minDist < nnCutoff) frozenNNDistances.push(minDist);
}

// Liquid phase analysis
let liquidNNDistances: number[] = [];
for (let i = N_FROZEN; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  let minDist = Infinity;
  for (let j = N_FROZEN; j < N; j++) {
    if (j === i) continue;
    const bj = j * FLOATS_PER_PARTICLE;
    let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
    let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
    if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
    if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) minDist = dist;
  }
  if (minDist < nnCutoff) liquidNNDistances.push(minDist);
}

// Statistics
frozenNNDistances.sort((a, b) => a - b);
liquidNNDistances.sort((a, b) => a - b);

const frozenMean = frozenNNDistances.reduce((s, v) => s + v, 0) / frozenNNDistances.length;
const liquidMean = liquidNNDistances.reduce((s, v) => s + v, 0) / liquidNNDistances.length;

const frozenStd = Math.sqrt(frozenNNDistances.reduce((s, v) => s + (v - frozenMean) ** 2, 0) / frozenNNDistances.length);
const liquidStd = Math.sqrt(liquidNNDistances.reduce((s, v) => s + (v - liquidMean) ** 2, 0) / liquidNNDistances.length);

console.log('=== NEAREST-NEIGHBOR O-O DISTANCE COMPARISON ===');
console.log('');
console.log('--- Frozen phase ---');
console.log(`  Count: ${frozenNNDistances.length}`);
console.log(`  Mean NN distance: ${frozenMean.toFixed(3)} px`);
console.log(`  Std dev: ${frozenStd.toFixed(3)} px`);
console.log(`  Min: ${frozenNNDistances[0]?.toFixed(3)} px`);
console.log(`  Max: ${frozenNNDistances[frozenNNDistances.length - 1]?.toFixed(3)} px`);
console.log(`  Ratio to σ: ${(frozenMean / sigma).toFixed(4)}`);
console.log('');
console.log('--- Liquid phase ---');
console.log(`  Count: ${liquidNNDistances.length}`);
console.log(`  Mean NN distance: ${liquidMean.toFixed(3)} px`);
console.log(`  Std dev: ${liquidStd.toFixed(3)} px`);
console.log(`  Min: ${liquidNNDistances[0]?.toFixed(3)} px`);
console.log(`  Max: ${liquidNNDistances[liquidNNDistances.length - 1]?.toFixed(3)} px`);
console.log(`  Ratio to σ: ${(liquidMean / sigma).toFixed(4)}`);
console.log('');

// Area density comparison
// For frozen: count molecules in a circle of known radius, compute area density
const frozenRadius = SPACING * 2.5;
let frozenInCircle = 0;
for (let i = 0; i < N_FROZEN; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const dx = d[bi + OFF_PX] - frozenCx;
  const dy = d[bi + OFF_PY] - frozenCy;
  if (Math.sqrt(dx * dx + dy * dy) < frozenRadius) frozenInCircle++;
}
const frozenAreaDensity = frozenInCircle / (Math.PI * frozenRadius * frozenRadius);

const liquidRadius2 = liquidRadius * 0.7; // inner region for density
let liquidInCircle = 0;
for (let i = N_FROZEN; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const dx = d[bi + OFF_PX] - liquidCx;
  const dy = d[bi + OFF_PY] - liquidCy;
  if (Math.sqrt(dx * dx + dy * dy) < liquidRadius2) liquidInCircle++;
}
const liquidAreaDensity = liquidInCircle / (Math.PI * liquidRadius2 * liquidRadius2);

console.log('=== AREA DENSITY COMPARISON ===');
console.log(`  Frozen: ${frozenInCircle} molecules in r=${frozenRadius.toFixed(1)}px circle → ${(frozenAreaDensity * 1000).toFixed(3)} per 1000px²`);
console.log(`  Liquid: ${liquidInCircle} molecules in r=${liquidRadius2.toFixed(1)}px circle → ${(liquidAreaDensity * 1000).toFixed(3)} per 1000px²`);
console.log(`  Density ratio (frozen/liquid): ${(frozenAreaDensity / liquidAreaDensity).toFixed(3)}`);
console.log('');

// Verdict
const densityRatio = frozenAreaDensity / liquidAreaDensity;
const spacingRatio = frozenMean / liquidMean;
console.log('=== VERDICT ===');
console.log(`  Frozen NN spacing: ${frozenMean.toFixed(2)} px`);
console.log(`  Liquid NN spacing: ${liquidMean.toFixed(2)} px`);
console.log(`  Spacing ratio (frozen/liquid): ${spacingRatio.toFixed(4)}`);
console.log(`  Density ratio (frozen/liquid): ${densityRatio.toFixed(4)}`);
console.log(`  latticeSpacing / sigmaOO: ${(SPACING / sigma).toFixed(4)}`);
console.log('');
if (spacingRatio < 0.95) {
  console.log('  PROBLEM: Frozen phase is MORE densely packed than liquid.');
  console.log(`  Frozen NN spacing is ${((1 - spacingRatio) * 100).toFixed(1)}% tighter than liquid.`);
  console.log('  Ice should NOT be denser than water in this 2D projection.');
} else if (spacingRatio > 1.05) {
  console.log('  OK: Frozen phase is less dense than liquid (physically correct for ice).');
} else {
  console.log('  OK: Frozen and liquid densities are approximately equal.');
}
