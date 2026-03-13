/**
 * Growth test: Start with 3 frozen molecules, add 4 liquid neighbors
 * Tests whether growth transition creates excessive vibration
 * and whether the spring network produces high-frequency jitter
 */

import { CONFIG } from '../src/config';
import { ParticleSystem, FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_VX, OFF_VY,
  OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z, OFF_QX, OFF_QY, OFF_QZ } from '../src/particles/ParticleSystem';

const SPACING = CONFIG.freeze.latticeSpacing;
const cx = CONFIG.world.width / 2;
const cy = CONFIG.world.height / 2;

// Start with 3 frozen molecules in a triangle + 4 liquid neighbors nearby
const N = 20; // Need enough for ParticleSystem spatial hash to work
const ps = new ParticleSystem(N);
const d = ps.data;

// Set all to liquid first, move far away
for (let i = 0; i < N; i++) {
  const base = i * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = 100 + i * 30;
  d[base + OFF_PY] = 100;
  d[base + OFF_VX] = 0;
  d[base + OFF_VY] = 0;
  d[base + OFF_ALPHA] = 0;
  d[base + OFF_SEED_ID] = -1;
  d[base + OFF_EQ_X] = 0;
  d[base + OFF_EQ_Y] = 0;
  d[base + OFF_Z] = 0;
  d[base + OFF_QX] = 0;
  d[base + OFF_QY] = 0;
  d[base + OFF_QZ] = 0;
}

// Place 3 frozen molecules in hex triangle
const frozenPositions: [number, number][] = [
  [cx, cy],
  [cx + SPACING, cy],
  [cx + SPACING * 0.5, cy + SPACING * 0.866],
];

for (let i = 0; i < 3; i++) {
  const base = i * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = frozenPositions[i][0];
  d[base + OFF_PY] = frozenPositions[i][1];
  d[base + OFF_ALPHA] = 1.0;
  d[base + OFF_SEED_ID] = 0;
  d[base + OFF_EQ_X] = frozenPositions[i][0];
  d[base + OFF_EQ_Y] = frozenPositions[i][1];
}

// Place 4 transitioning molecules (alpha=0.3-0.6) near valid lattice sites
// These simulate molecules that are in the process of freezing
const transPositions: [number, number, number][] = [
  // position + alpha
  [cx - SPACING * 0.5, cy + SPACING * 0.866, 0.5], // valid hex neighbor
  [cx + SPACING * 1.5, cy + SPACING * 0.866, 0.4], // valid hex neighbor
  [cx - SPACING, cy, 0.3], // valid hex neighbor
  [cx + SPACING * 0.5, cy - SPACING * 0.866, 0.6], // valid hex neighbor
];

for (let i = 0; i < 4; i++) {
  const base = (i + 3) * FLOATS_PER_PARTICLE;
  d[base + OFF_PX] = transPositions[i][0] + (Math.random() - 0.5) * 3; // slight offset
  d[base + OFF_PY] = transPositions[i][1] + (Math.random() - 0.5) * 3;
  d[base + OFF_ALPHA] = transPositions[i][2];
  d[base + OFF_SEED_ID] = 0;
  d[base + OFF_EQ_X] = transPositions[i][0];
  d[base + OFF_EQ_Y] = transPositions[i][1];
}

console.log('=== GROWTH TRANSITION TEST ===');
console.log(`3 frozen + 4 transitioning molecules`);
console.log('');
console.log('--- Initial state ---');
for (let i = 0; i < 7; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  console.log(`  mol[${i}]: pos=(${d[bi+OFF_PX].toFixed(2)}, ${d[bi+OFF_PY].toFixed(2)}) alpha=${d[bi+OFF_ALPHA].toFixed(2)} eq=(${d[bi+OFF_EQ_X].toFixed(2)}, ${d[bi+OFF_EQ_Y].toFixed(2)})`);
}

const dt = CONFIG.dynamics.dt;
const TOTAL = 300;
const INTERVAL = 15;

console.log('');
console.log('frame | frozenTransKE | frozenRotKE | maxVel   | maxOmega | avgOO_dist');

for (let frame = 0; frame < TOTAL; frame++) {
  ps.update(dt);

  if (frame % INTERVAL === 0 || frame === TOTAL - 1) {
    let transKE = 0;
    let maxVel = 0;
    let ooSum = 0;
    let ooN = 0;
    for (let i = 0; i < 7; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      const vx = d[bi + OFF_VX];
      const vy = d[bi + OFF_VY];
      const v = Math.sqrt(vx * vx + vy * vy);
      transKE += 0.5 * (vx * vx + vy * vy);
      if (v > maxVel) maxVel = v;

      for (let j = i + 1; j < 7; j++) {
        const bj = j * FLOATS_PER_PARTICLE;
        let dx = d[bj + OFF_PX] - d[bi + OFF_PX];
        let dy = d[bj + OFF_PY] - d[bi + OFF_PY];
        const hw = CONFIG.world.width / 2;
        const hh = CONFIG.world.height / 2;
        if (dx > hw) dx -= CONFIG.world.width; else if (dx < -hw) dx += CONFIG.world.width;
        if (dy > hh) dy -= CONFIG.world.height; else if (dy < -hh) dy += CONFIG.world.height;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < SPACING * 1.5) {
          ooSum += dist;
          ooN++;
        }
      }
    }
    const avgOO = ooN > 0 ? ooSum / ooN : 0;

    console.log(
      `${String(frame).padStart(5)} | ${transKE.toExponential(3).padStart(13)} | ${(ps.debugStats.frozenAvgErot * 7).toExponential(3).padStart(11)} | ${maxVel.toFixed(4).padStart(8)} | ${ps.debugStats.maxOmega.toFixed(4).padStart(8)} | ${avgOO.toFixed(3)}`
    );
  }
}

console.log('');
console.log('--- Final state ---');
for (let i = 0; i < 7; i++) {
  const bi = i * FLOATS_PER_PARTICLE;
  const px = d[bi + OFF_PX];
  const py = d[bi + OFF_PY];
  const eqx = d[bi + OFF_EQ_X];
  const eqy = d[bi + OFF_EQ_Y];
  const alpha = d[bi + OFF_ALPHA];
  const vx = d[bi + OFF_VX];
  const vy = d[bi + OFF_VY];
  const v = Math.sqrt(vx * vx + vy * vy);
  const drift = Math.sqrt((px - eqx) ** 2 + (py - eqy) ** 2);
  console.log(`  mol[${i}]: alpha=${alpha.toFixed(3)} vel=${v.toFixed(4)} drift=${drift.toFixed(3)}px`);
}
