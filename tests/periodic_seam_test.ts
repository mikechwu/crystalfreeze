/**
 * Periodic seam correctness test.
 * Verifies that the periodic SpatialHash allows particles near opposite
 * boundaries to discover each other, and that the resulting dynamics
 * (velocity changes from interaction forces) match an equivalent interior
 * configuration.
 *
 * Tests:
 * 1. SpatialHash periodic query finds cross-boundary neighbors
 * 2. Non-periodic hash misses them (control, confirms the bug existed)
 * 3. Interaction equivalence: a pair at the seam has the same minimum-image
 *    distance, neighbor count, and torque as the same pair in the interior
 * 4. Freeze propagation crosses the periodic seam
 * 5. Constructor rejects invalid periodic configuration
 */

import { CONFIG } from '../src/config';
import { SpatialHash } from '../src/utils/SpatialHash';
import {
  ParticleSystem, FLOATS_PER_PARTICLE,
  OFF_PX, OFF_PY, OFF_VX, OFF_VY, OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z,
  OFF_QX, OFF_QY, OFF_QZ,
} from '../src/particles/ParticleSystem';
import { FreezeSystem } from '../src/simulation/FreezeSystem';

const W = CONFIG.world.width;
const H = CONFIG.world.height;
const cutoff = CONFIG.interaction.cutoff;
const sigma = CONFIG.interaction.sigmaOO;

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    failed++;
  }
}

console.log('=== PERIODIC SEAM TEST ===');
console.log('');

// ---- Test 1: SpatialHash cross-boundary query ----
console.log('--- Test 1: SpatialHash periodic query ---');
{
  const hash = new SpatialHash(cutoff, {
    periodicX: true, periodicY: true,
    worldWidth: W, worldHeight: H,
  });

  // Particle A near left edge, Particle B near right edge
  const ax = 5, ay = H / 2;
  const bx = W - 5, by = H / 2;

  hash.insert(ax, ay, 0);
  hash.insert(bx, by, 1);

  const fromA = hash.query(ax, ay, cutoff);
  assert(fromA.includes(1), `Query from near-left finds near-right particle (got ${fromA.length} results)`);

  const fromB = hash.query(bx, by, cutoff);
  assert(fromB.includes(0), `Query from near-right finds near-left particle (got ${fromB.length} results)`);

  // Y-axis seam: top-bottom
  const hash2 = new SpatialHash(cutoff, {
    periodicX: true, periodicY: true,
    worldWidth: W, worldHeight: H,
  });
  hash2.insert(W / 2, 3, 10);
  hash2.insert(W / 2, H - 3, 11);

  const fromTop = hash2.query(W / 2, 3, cutoff);
  assert(fromTop.includes(11), `Query from near-top finds near-bottom particle`);
}
console.log('');

// ---- Test 2: Non-periodic hash misses cross-boundary neighbors (control) ----
console.log('--- Test 2: Non-periodic hash misses seam neighbors (control) ---');
{
  const hash = new SpatialHash(cutoff);

  hash.insert(5, H / 2, 0);
  hash.insert(W - 5, H / 2, 1);

  const fromA = hash.query(5, H / 2, cutoff);
  assert(!fromA.includes(1), `Non-periodic hash does NOT find cross-boundary neighbor (confirms bug existed)`);
}
console.log('');

// ---- Test 3: Interaction equivalence — seam pair vs interior pair ----
// Place two particles at the same minimum-image separation. In config A they
// straddle the X seam; in config B they sit in the domain interior.
// Verify that (a) both configurations find the same number of neighbors,
// (b) the minimum-image distances are identical, and (c) one physics step
// produces the same avgNeighbors and avgTorque in the debug stats (which
// reflect the deterministic force computation, independent of stochastic noise).
console.log('--- Test 3: Interaction equivalence (seam vs interior) ---');
{
  const separation = sigma * 0.9; // within interaction range, slight overlap → repulsion

  function makeSystem(x0: number, y0: number, x1: number, y1: number): ParticleSystem {
    const ps = new ParticleSystem(2);
    const d = ps.data;
    d.fill(0);
    ps.eqZ.fill(0);
    for (const [i, x, y] of [[0, x0, y0], [1, x1, y1]] as [number, number, number][]) {
      const b = i * FLOATS_PER_PARTICLE;
      d[b + OFF_PX] = x;
      d[b + OFF_PY] = y;
      d[b + OFF_QZ] = 0.3; // some yaw so H atoms are off-axis
    }
    return ps;
  }

  // Config A: straddles X seam
  const seamPS = makeSystem(3, H / 2, W - separation + 3, H / 2);
  // Config B: interior, same separation
  const intPS = makeSystem(W / 2 - separation / 2, H / 2, W / 2 + separation / 2, H / 2);

  // Verify minimum-image distance is the same
  function minImageDist(ps: ParticleSystem): number {
    const d = ps.data;
    let dx = d[1 * FLOATS_PER_PARTICLE + OFF_PX] - d[0 * FLOATS_PER_PARTICLE + OFF_PX];
    let dy = d[1 * FLOATS_PER_PARTICLE + OFF_PY] - d[0 * FLOATS_PER_PARTICLE + OFF_PY];
    const halfW = W * 0.5, halfH = H * 0.5;
    if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
    if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const seamDist = minImageDist(seamPS);
  const intDist = minImageDist(intPS);
  assert(
    Math.abs(seamDist - intDist) < 0.01,
    `Minimum-image distance matches: seam=${seamDist.toFixed(3)}, interior=${intDist.toFixed(3)}`
  );

  // Run one physics step and compare deterministic debug stats
  const dt = CONFIG.dynamics.dt;
  seamPS.update(dt);
  intPS.update(dt);

  // avgNeighbors reflects spatial hash query results — should be identical
  assert(
    seamPS.debugStats.avgNeighbors === intPS.debugStats.avgNeighbors,
    `avgNeighbors match: seam=${seamPS.debugStats.avgNeighbors}, interior=${intPS.debugStats.avgNeighbors}`
  );

  // avgTorque reflects the deterministic force/torque computation
  // (same geometry + same orientation → same torque, independent of noise)
  const torqueRatio = seamPS.debugStats.avgTorque / Math.max(intPS.debugStats.avgTorque, 1e-10);
  assert(
    Math.abs(torqueRatio - 1.0) < 0.01,
    `avgTorque matches: seam=${seamPS.debugStats.avgTorque.toFixed(4)}, interior=${intPS.debugStats.avgTorque.toFixed(4)}, ratio=${torqueRatio.toFixed(4)}`
  );
}
console.log('');

// ---- Test 4: Freeze propagation across seam ----
console.log('--- Test 4: Freeze propagation crosses periodic seam ---');
{
  const N = 20;
  const ps = new ParticleSystem(N);
  const fs = new FreezeSystem();
  const d = ps.data;

  d.fill(0);
  ps.eqZ.fill(0);

  // Frozen cluster near x=15 (left edge)
  const frozenCount = 5;
  for (let i = 0; i < frozenCount; i++) {
    const base = i * FLOATS_PER_PARTICLE;
    d[base + OFF_PX] = 15 + i * 5;
    d[base + OFF_PY] = H / 2;
    d[base + OFF_ALPHA] = 1.0;
    d[base + OFF_SEED_ID] = 0;
    d[base + OFF_EQ_X] = d[base + OFF_PX];
    d[base + OFF_EQ_Y] = d[base + OFF_PY];
  }

  // Liquid particles near x=W-15 (right edge, close via periodic boundary)
  for (let i = frozenCount; i < N; i++) {
    const base = i * FLOATS_PER_PARTICLE;
    d[base + OFF_PX] = W - 15 + (i - frozenCount) * 2;
    d[base + OFF_PY] = H / 2 + (Math.random() - 0.5) * 10;
    d[base + OFF_ALPHA] = 0;
    d[base + OFF_SEED_ID] = -1;
  }

  await new Promise(r => setTimeout(r, 600));
  fs.placeSeed(15, H / 2, d, N, ps.eqZ);

  for (let frame = 0; frame < 200; frame++) {
    fs.update(d, N, ps.eqZ);
  }

  let seamFreezing = 0;
  for (let i = frozenCount; i < N; i++) {
    if (d[i * FLOATS_PER_PARTICLE + OFF_ALPHA] > 0.01) seamFreezing++;
  }

  assert(seamFreezing > 0, `Right-edge particles gained freezing influence across seam (${seamFreezing}/${N - frozenCount})`);
}
console.log('');

// ---- Test 5: Constructor rejects invalid periodic config ----
console.log('--- Test 5: Constructor validation ---');
{
  let threw = false;
  try {
    new SpatialHash(10, { periodicX: true }); // missing worldWidth
  } catch {
    threw = true;
  }
  assert(threw, `Constructor throws when periodicX=true but worldWidth missing`);

  threw = false;
  try {
    new SpatialHash(10, { periodicY: true, worldHeight: 0 }); // zero height
  } catch {
    threw = true;
  }
  assert(threw, `Constructor throws when periodicY=true but worldHeight=0`);

  threw = false;
  try {
    new SpatialHash(10, { periodicX: true, worldWidth: 100 }); // valid
  } catch {
    threw = true;
  }
  assert(!threw, `Constructor accepts valid periodic config`);
}
console.log('');

// ---- Summary ----
console.log('=== SUMMARY ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  console.log('PERIODIC SEAM: FAIL');
  process.exit(1);
} else {
  console.log('PERIODIC SEAM: PASS');
}
