/**
 * Growth simulation test: pre-frozen core + liquid shell, run FreezeSystem
 * Directly initializes a 7-molecule frozen core, surrounds with liquid,
 * then runs full simulation to test crystal growth at medium scale.
 */

import { CONFIG } from '../src/config';
import { ParticleSystem, FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_VX, OFF_VY,
  OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z, OFF_QX, OFF_QY, OFF_QZ } from '../src/particles/ParticleSystem';
import { FreezeSystem } from '../src/simulation/FreezeSystem';

const SPACING = CONFIG.freeze.latticeSpacing;
const sigma = CONFIG.interaction.sigmaOO;
const cx = CONFIG.world.width / 2;
const cy = CONFIG.world.height / 2;

// Generate hex core (1 center + 6 neighbors) as pre-frozen
const corePositions: [number, number][] = [[cx, cy]];
for (let k = 0; k < 6; k++) {
  const angle = k * Math.PI / 3;
  corePositions.push([cx + SPACING * Math.cos(angle), cy + SPACING * Math.sin(angle)]);
}
const CORE_N = corePositions.length;

// Generate liquid particles in a shell around the core (radius 30-150px)
const gridSpacing = sigma * 1.05;
const rowSpacing = gridSpacing * 0.866;
const liquidPositions: [number, number][] = [];
const outerRadius = 120;
const innerRadius = 10; // close to core to interact

for (let row = -Math.ceil(outerRadius / rowSpacing); row <= Math.ceil(outerRadius / rowSpacing); row++) {
  const yOff = row * rowSpacing;
  const xOff = (((row % 2) + 2) % 2) * gridSpacing * 0.5;
  for (let col = -Math.ceil(outerRadius / gridSpacing); col <= Math.ceil(outerRadius / gridSpacing); col++) {
    const x = cx + col * gridSpacing + xOff + (Math.random() - 0.5) * gridSpacing * 0.3;
    const y = cy + yOff + (Math.random() - 0.5) * gridSpacing * 0.3;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist > innerRadius && dist < outerRadius) {
      // Check not too close to core sites
      let tooClose = false;
      for (const [cx2, cy2] of corePositions) {
        if (Math.sqrt((x - cx2) ** 2 + (y - cy2) ** 2) < sigma * 0.8) { tooClose = true; break; }
      }
      if (!tooClose) liquidPositions.push([x, y]);
    }
  }
}

const N = CORE_N + liquidPositions.length;
console.log(`=== GROWTH SIMULATION TEST ===`);
console.log(`N=${N} (${CORE_N} frozen core + ${liquidPositions.length} liquid)`);
console.log(`latticeSpacing=${SPACING}`);

// Create systems
const ps = new ParticleSystem(N);
const fs = new FreezeSystem();
const d = ps.data;
const dt = CONFIG.dynamics.dt;

// Manually register a seed using the internal registry
// We need to access the registry to register the seed for the FreezeSystem
const registry = fs.getSeedRegistry();
// Bypass canPlace by calling internal setup:
// We can't easily bypass, so let's set up manually by directly manipulating data

// Set up core molecules (frozen, with seed and eq sites)
const seedTheta = 0; // fixed for reproducibility
for (let i = 0; i < CORE_N; i++) {
  const base = i * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = corePositions[i][0];
  d[base + OFF_PY] = corePositions[i][1];
  d[base + OFF_VX] = 0;
  d[base + OFF_VY] = 0;
  d[base + OFF_ALPHA] = 1.0;
  d[base + OFF_SEED_ID] = 0; // seed 0
  d[base + OFF_EQ_X] = corePositions[i][0];
  d[base + OFF_EQ_Y] = corePositions[i][1];
  d[base + OFF_Z] = 0;
  d[base + OFF_QX] = 0;
  d[base + OFF_QY] = 0;
  d[base + OFF_QZ] = 0;
}

// Set up liquid molecules
for (let i = 0; i < liquidPositions.length; i++) {
  const base = (CORE_N + i) * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = liquidPositions[i][0];
  d[base + OFF_PY] = liquidPositions[i][1];
  d[base + OFF_VX] = (Math.random() - 0.5) * CONFIG.dynamics.kT;
  d[base + OFF_VY] = (Math.random() - 0.5) * CONFIG.dynamics.kT;
  d[base + OFF_ALPHA] = 0;
  d[base + OFF_SEED_ID] = -1;
  d[base + OFF_EQ_X] = 0;
  d[base + OFF_EQ_Y] = 0;
  d[base + OFF_Z] = 0;
  const angle = Math.random() * Math.PI * 2;
  d[base + OFF_QX] = 0;
  d[base + OFF_QY] = 0;
  d[base + OFF_QZ] = Math.sin(angle * 0.5);
}

// We need the FreezeSystem to know about seed 0.
// Wait for seedCooldown then place seed (which will re-freeze already-frozen core)
await new Promise(r => setTimeout(r, 600)); // wait for cooldown
const seedOk = fs.placeSeed(cx, cy, d, N);
console.log(`placeSeed result: ${seedOk}`);

// Count frozen
let initFrozen = 0;
for (let i = 0; i < N; i++) {
  if (d[i * FLOATS_PER_PARTICLE + OFF_ALPHA] > 0.3) initFrozen++;
}
console.log(`Initially frozen: ${initFrozen}`);
console.log('');

// Run simulation
const TOTAL = 1200;
const SAMPLE = 60;

console.log('frame | frozen | sited | avgOO  | maxOOerr | transKE   | rotKE     | maxOmega | maxDrift');

for (let frame = 0; frame < TOTAL; frame++) {
  fs.update(d, N);
  ps.update(dt);

  if (frame % SAMPLE === 0 || frame === TOTAL - 1) {
    let frozenCount = 0, sitedCount = 0;
    let transKE = 0, maxDrift = 0;
    const hw = CONFIG.world.width / 2;
    const hh = CONFIG.world.height / 2;

    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      const alpha = d[bi + OFF_ALPHA];
      if (alpha > 0.5) frozenCount++;
      if (d[bi + OFF_SEED_ID] >= 0) sitedCount++;

      if (alpha > 0.5) {
        const vx = d[bi + OFF_VX], vy = d[bi + OFF_VY];
        transKE += 0.5 * (vx * vx + vy * vy);
        if (d[bi + OFF_SEED_ID] >= 0) {
          const dx = d[bi + OFF_PX] - d[bi + OFF_EQ_X];
          const dy = d[bi + OFF_PY] - d[bi + OFF_EQ_Y];
          const drift = Math.sqrt(dx * dx + dy * dy);
          if (drift > maxDrift) maxDrift = drift;
        }
      }
    }

    // O-O distances for lattice-neighbor frozen pairs
    let ooSum = 0, ooCount = 0, maxOOErr = 0;
    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      if (d[bi + OFF_ALPHA] < 0.5 || d[bi + OFF_SEED_ID] < 0) continue;
      for (let j = i + 1; j < N; j++) {
        const bj = j * FLOATS_PER_PARTICLE;
        if (d[bj + OFF_ALPHA] < 0.5 || d[bj + OFF_SEED_ID] < 0) continue;
        let edx = d[bj + OFF_EQ_X] - d[bi + OFF_EQ_X];
        let edy = d[bj + OFF_EQ_Y] - d[bi + OFF_EQ_Y];
        if (edx > hw) edx -= CONFIG.world.width; else if (edx < -hw) edx += CONFIG.world.width;
        if (edy > hh) edy -= CONFIG.world.height; else if (edy < -hh) edy += CONFIG.world.height;
        const eqDist = Math.sqrt(edx * edx + edy * edy);
        if (eqDist < SPACING * 1.2 && eqDist > SPACING * 0.3) {
          let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
          let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
          if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
          if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
          const dist = Math.sqrt(dx * dx + dy * dy);
          ooSum += dist;
          ooCount++;
          const err = Math.abs(dist - SPACING) / SPACING;
          if (err > maxOOErr) maxOOErr = err;
        }
      }
    }
    const avgOO = ooCount > 0 ? ooSum / ooCount : 0;

    console.log(
      `${String(frame).padStart(5)} | ${String(frozenCount).padStart(6)} | ${String(sitedCount).padStart(5)} | ${avgOO.toFixed(3).padStart(6)} | ${(maxOOErr * 100).toFixed(2).padStart(8)}% | ${transKE.toExponential(2).padStart(9)} | ${(ps.debugStats.frozenAvgErot * Math.max(1,frozenCount)).toExponential(2).padStart(9)} | ${ps.debugStats.maxOmega.toFixed(4).padStart(8)} | ${maxDrift.toFixed(3)}`
    );
  }
}

// Final analysis
console.log('');
console.log('--- Final crystal analysis ---');

let frozenSited: number[] = [];
for (let i = 0; i < N; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  if (d[bi + OFF_ALPHA] > 0.5 && d[bi + OFF_SEED_ID] >= 0) frozenSited.push(i);
}
console.log(`Frozen+sited molecules: ${frozenSited.length}/${N}`);

// Neighbor count distribution
const hw = CONFIG.world.width / 2;
const hh = CONFIG.world.height / 2;
let neighborCounts: number[] = new Array(frozenSited.length).fill(0);
for (let ii = 0; ii < frozenSited.length; ii++) {
  const i = frozenSited[ii];
  const bi = i * FLOATS_PER_PARTICLE;
  for (let jj = ii + 1; jj < frozenSited.length; jj++) {
    const j = frozenSited[jj];
    const bj = j * FLOATS_PER_PARTICLE;
    let edx = d[bj + OFF_EQ_X] - d[bi + OFF_EQ_X];
    let edy = d[bj + OFF_EQ_Y] - d[bi + OFF_EQ_Y];
    if (edx > hw) edx -= CONFIG.world.width; else if (edx < -hw) edx += CONFIG.world.width;
    if (edy > hh) edy -= CONFIG.world.height; else if (edy < -hh) edy += CONFIG.world.height;
    const eqDist = Math.sqrt(edx * edx + edy * edy);
    if (eqDist < SPACING * 1.2 && eqDist > SPACING * 0.3) {
      neighborCounts[ii]++;
      neighborCounts[jj]++;
    }
  }
}

const ncDist: Record<number, number> = {};
for (const nc of neighborCounts) {
  ncDist[nc] = (ncDist[nc] || 0) + 1;
}
console.log(`Lattice-neighbor distribution: ${JSON.stringify(ncDist)}`);

// Duplicate sites
const siteMap = new Map<string, number[]>();
for (const i of frozenSited) {
  const bi = i * FLOATS_PER_PARTICLE;
  const key = `${Math.round(d[bi + OFF_EQ_X] * 10)},${Math.round(d[bi + OFF_EQ_Y] * 10)}`;
  if (!siteMap.has(key)) siteMap.set(key, []);
  siteMap.get(key)!.push(i);
}
let dupSites = 0;
for (const [, ids] of siteMap) {
  if (ids.length > 1) dupSites++;
}
console.log(`Duplicate site assignments: ${dupSites}`);
console.log(`Unique lattice sites occupied: ${siteMap.size}`);

// Sample positions
console.log('');
for (let ii = 0; ii < Math.min(15, frozenSited.length); ii++) {
  const i = frozenSited[ii];
  const bi = i * FLOATS_PER_PARTICLE;
  const px = d[bi + OFF_PX], py = d[bi + OFF_PY];
  const eqx = d[bi + OFF_EQ_X], eqy = d[bi + OFF_EQ_Y];
  const drift = Math.sqrt((px - eqx) ** 2 + (py - eqy) ** 2);
  console.log(`  mol[${String(i).padStart(3)}]: pos=(${px.toFixed(1)}, ${py.toFixed(1)}) eq=(${eqx.toFixed(1)}, ${eqy.toFixed(1)}) alpha=${d[bi+OFF_ALPHA].toFixed(2)} drift=${drift.toFixed(2)} nn=${neighborCounts[ii]}`);
}

// Crystal shape
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const i of frozenSited) {
  const bi = i * FLOATS_PER_PARTICLE;
  const eqx = d[bi + OFF_EQ_X], eqy = d[bi + OFF_EQ_Y];
  if (eqx < minX) minX = eqx; if (eqx > maxX) maxX = eqx;
  if (eqy < minY) minY = eqy; if (eqy > maxY) maxY = eqy;
}
if (frozenSited.length > 0) {
  console.log(`\nCrystal: ${(maxX-minX).toFixed(1)} × ${(maxY-minY).toFixed(1)} px, AR=${((maxX-minX)/(maxY-minY)||0).toFixed(2)}`);
}
