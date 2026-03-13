/**
 * Morphology-focused growth test.
 * Purpose: evaluate crystal SHAPE over multiple rings, not just local spacing.
 *
 * Creates a larger liquid pool around a seed, runs FreezeSystem growth,
 * then measures:
 * - per-molecule lattice neighbor count (should be 2-6, never >6)
 * - angular distribution of neighbors (should show 60° hex peaks)
 * - overall crystal shape (AR, extent, compactness)
 * - whether the pattern resembles hex lattice or messy aggregate
 */

import { CONFIG } from '../src/config';
import { ParticleSystem, FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_VX, OFF_VY,
  OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z, OFF_QX, OFF_QY, OFF_QZ } from '../src/particles/ParticleSystem';
import { FreezeSystem } from '../src/simulation/FreezeSystem';

const SPACING = CONFIG.freeze.latticeSpacing;
const sigma = CONFIG.interaction.sigmaOO;
const cx = CONFIG.world.width / 2;
const cy = CONFIG.world.height / 2;

// Generate dense liquid pool around center
const gridSpacing = sigma * 1.05;
const rowSpacing = gridSpacing * 0.866;
const outerRadius = 180;
const positions: [number, number][] = [];

for (let row = -Math.ceil(outerRadius / rowSpacing); row <= Math.ceil(outerRadius / rowSpacing); row++) {
  const yOff = row * rowSpacing;
  const xOff = (((row % 2) + 2) % 2) * gridSpacing * 0.5;
  for (let col = -Math.ceil(outerRadius / gridSpacing); col <= Math.ceil(outerRadius / gridSpacing); col++) {
    const x = cx + col * gridSpacing + xOff + (Math.random() - 0.5) * gridSpacing * 0.3;
    const y = cy + yOff + (Math.random() - 0.5) * gridSpacing * 0.3;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist < outerRadius) {
      positions.push([x, y]);
    }
  }
}

const N = positions.length;
console.log(`=== MORPHOLOGY GROWTH TEST ===`);
console.log(`N=${N} liquid molecules in ${outerRadius}px radius pool`);
console.log(`latticeSpacing=${SPACING}, sigmaOO=${sigma}`);
console.log('');

const ps = new ParticleSystem(N);
const fs = new FreezeSystem();
const d = ps.data;
const dt = CONFIG.dynamics.dt;

// Initialize all as liquid
for (let i = 0; i < N; i++) {
  const base = i * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = positions[i][0];
  d[base + OFF_PY] = positions[i][1];
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

// Place seed at center
await new Promise(r => setTimeout(r, 600));
const seedOk = fs.placeSeed(cx, cy, d, N);
console.log(`placeSeed: ${seedOk}`);

// Count initial frozen
let initFrozen = 0;
for (let i = 0; i < N; i++) {
  if (d[i * FLOATS_PER_PARTICLE + OFF_ALPHA] > 0.3) initFrozen++;
}
console.log(`Initially frozen: ${initFrozen}`);
console.log('');

// Run growth
const TOTAL = 2000;
const SAMPLE = 200;

console.log('frame | frozen | sited | avgOO  | maxNN | >6nn');
for (let frame = 0; frame < TOTAL; frame++) {
  fs.update(d, N);
  ps.update(dt);

  if (frame % SAMPLE === 0 || frame === TOTAL - 1) {
    let frozenCount = 0, sitedCount = 0;
    const hw = CONFIG.world.width / 2;
    const hh = CONFIG.world.height / 2;

    // Collect sited molecules
    const sited: number[] = [];
    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      if (d[bi + OFF_ALPHA] > 0.5) frozenCount++;
      if (d[bi + OFF_SEED_ID] >= 0) {
        sitedCount++;
        sited.push(i);
      }
    }

    // Neighbor counts
    let maxNN = 0, overCoordinated = 0;
    let ooDistSum = 0, ooCount = 0;
    for (let ii = 0; ii < sited.length; ii++) {
      const i = sited[ii];
      const bi = i * FLOATS_PER_PARTICLE;
      let nn = 0;
      for (let jj = 0; jj < sited.length; jj++) {
        if (jj === ii) continue;
        const j = sited[jj];
        const bj = j * FLOATS_PER_PARTICLE;
        let edx = d[bj + OFF_EQ_X] - d[bi + OFF_EQ_X];
        let edy = d[bj + OFF_EQ_Y] - d[bi + OFF_EQ_Y];
        if (edx > hw) edx -= CONFIG.world.width; else if (edx < -hw) edx += CONFIG.world.width;
        if (edy > hh) edy -= CONFIG.world.height; else if (edy < -hh) edy += CONFIG.world.height;
        const eqDist = Math.sqrt(edx * edx + edy * edy);
        if (eqDist < SPACING * 1.15 && eqDist > SPACING * 0.5) {
          nn++;
          if (ii < jj) {
            // Actual O-O distance
            let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
            let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
            if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
            if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
            ooDistSum += Math.sqrt(dx * dx + dy * dy);
            ooCount++;
          }
        }
      }
      if (nn > maxNN) maxNN = nn;
      if (nn > 6) overCoordinated++;
    }
    const avgOO = ooCount > 0 ? ooDistSum / ooCount : 0;

    console.log(
      `${String(frame).padStart(5)} | ${String(frozenCount).padStart(6)} | ${String(sitedCount).padStart(5)} | ${avgOO.toFixed(2).padStart(6)} | ${String(maxNN).padStart(5)} | ${overCoordinated}`
    );
  }
}

// Final morphology analysis
console.log('');
console.log('=== FINAL MORPHOLOGY ANALYSIS ===');

const hw = CONFIG.world.width / 2;
const hh = CONFIG.world.height / 2;

const sited: number[] = [];
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  if (d[bi + OFF_SEED_ID] >= 0) sited.push(i);
}
console.log(`Frozen+sited: ${sited.length}/${N}`);

// Neighbor count distribution
const nnCounts: number[] = new Array(sited.length).fill(0);
for (let ii = 0; ii < sited.length; ii++) {
  const i = sited[ii];
  const bi = i * FLOATS_PER_PARTICLE;
  for (let jj = ii + 1; jj < sited.length; jj++) {
    const j = sited[jj];
    const bj = j * FLOATS_PER_PARTICLE;
    let edx = d[bj + OFF_EQ_X] - d[bi + OFF_EQ_X];
    let edy = d[bj + OFF_EQ_Y] - d[bi + OFF_EQ_Y];
    if (edx > hw) edx -= CONFIG.world.width; else if (edx < -hw) edx += CONFIG.world.width;
    if (edy > hh) edy -= CONFIG.world.height; else if (edy < -hh) edy += CONFIG.world.height;
    const eqDist = Math.sqrt(edx * edx + edy * edy);
    if (eqDist < SPACING * 1.15 && eqDist > SPACING * 0.5) {
      nnCounts[ii]++;
      nnCounts[jj]++;
    }
  }
}

const nnDist: Record<number, number> = {};
for (const nc of nnCounts) nnDist[nc] = (nnDist[nc] || 0) + 1;
console.log(`Neighbor count distribution: ${JSON.stringify(nnDist)}`);

const overCoord = nnCounts.filter(n => n > 6).length;
console.log(`Over-coordinated (>6 neighbors): ${overCoord}/${sited.length}`);

// Angular analysis: for molecules with 5-6 neighbors, measure angles between consecutive neighbors
let hexAngles: number[] = [];
for (let ii = 0; ii < sited.length; ii++) {
  if (nnCounts[ii] < 5 || nnCounts[ii] > 6) continue;
  const i = sited[ii];
  const bi = i * FLOATS_PER_PARTICLE;
  const neighborAngles: number[] = [];
  for (let jj = 0; jj < sited.length; jj++) {
    if (jj === ii) continue;
    const j = sited[jj];
    const bj = j * FLOATS_PER_PARTICLE;
    let edx = d[bj + OFF_EQ_X] - d[bi + OFF_EQ_X];
    let edy = d[bj + OFF_EQ_Y] - d[bi + OFF_EQ_Y];
    if (edx > hw) edx -= CONFIG.world.width; else if (edx < -hw) edx += CONFIG.world.width;
    if (edy > hh) edy -= CONFIG.world.height; else if (edy < -hh) edy += CONFIG.world.height;
    const eqDist = Math.sqrt(edx * edx + edy * edy);
    if (eqDist < SPACING * 1.15 && eqDist > SPACING * 0.5) {
      neighborAngles.push(Math.atan2(edy, edx));
    }
  }
  neighborAngles.sort((a, b) => a - b);
  for (let k = 0; k < neighborAngles.length; k++) {
    let diff = neighborAngles[(k + 1) % neighborAngles.length] - neighborAngles[k];
    if (diff < 0) diff += 2 * Math.PI;
    hexAngles.push(diff * 180 / Math.PI);
  }
}

if (hexAngles.length > 0) {
  hexAngles.sort((a, b) => a - b);
  const meanAngle = hexAngles.reduce((s, v) => s + v, 0) / hexAngles.length;
  const stdAngle = Math.sqrt(hexAngles.reduce((s, v) => s + (v - meanAngle) ** 2, 0) / hexAngles.length);
  console.log(`\nAngular analysis (5-6 coordinated molecules):`);
  console.log(`  Mean inter-neighbor angle: ${meanAngle.toFixed(1)}° (ideal: 60°)`);
  console.log(`  Std dev: ${stdAngle.toFixed(1)}°`);
  console.log(`  Min: ${hexAngles[0].toFixed(1)}°, Max: ${hexAngles[hexAngles.length - 1].toFixed(1)}°`);
}

// Duplicate sites
const siteMap = new Map<string, number[]>();
for (const i of sited) {
  const bi = i * FLOATS_PER_PARTICLE;
  const key = `${Math.round(d[bi + OFF_EQ_X] * 10)},${Math.round(d[bi + OFF_EQ_Y] * 10)}`;
  if (!siteMap.has(key)) siteMap.set(key, []);
  siteMap.get(key)!.push(i);
}
let dupSites = 0;
for (const [, ids] of siteMap) if (ids.length > 1) dupSites++;
console.log(`\nDuplicate sites: ${dupSites}`);
console.log(`Unique sites: ${siteMap.size}`);

// Crystal shape
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const i of sited) {
  const bi = i * FLOATS_PER_PARTICLE;
  const eqx = d[bi + OFF_EQ_X], eqy = d[bi + OFF_EQ_Y];
  if (eqx < minX) minX = eqx; if (eqx > maxX) maxX = eqx;
  if (eqy < minY) minY = eqy; if (eqy > maxY) maxY = eqy;
}
if (sited.length > 0) {
  console.log(`\nCrystal extent: ${(maxX - minX).toFixed(1)} × ${(maxY - minY).toFixed(1)} px`);
  console.log(`Aspect ratio: ${((maxX - minX) / (maxY - minY) || 0).toFixed(2)}`);
}

// GOOD/BAD morphology criteria
console.log('');
console.log('=== MORPHOLOGY CRITERIA ===');
const pass1 = overCoord === 0;
const pass2 = hexAngles.length > 0 && Math.abs(hexAngles.reduce((s, v) => s + v, 0) / hexAngles.length - 60) < 10;
const pass3 = dupSites === 0;
const pass4 = sited.length >= 20;

console.log(`1. No over-coordinated (>6 NN): ${overCoord} molecules ${pass1 ? 'PASS' : 'FAIL'}`);
console.log(`2. Mean angle near 60°: ${hexAngles.length > 0 ? (hexAngles.reduce((s, v) => s + v, 0) / hexAngles.length).toFixed(1) : 'N/A'}° ${pass2 ? 'PASS' : 'FAIL'}`);
console.log(`3. No duplicate sites: ${dupSites} ${pass3 ? 'PASS' : 'FAIL'}`);
console.log(`4. Sufficient growth (≥20 sited): ${sited.length} ${pass4 ? 'PASS' : 'FAIL'}`);
console.log(`MORPHOLOGY: ${pass1 && pass2 && pass3 && pass4 ? 'GOOD' : 'BAD'}`);
