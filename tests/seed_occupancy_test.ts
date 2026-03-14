/**
 * Multi-seed occupancy uniqueness test.
 * Verifies that overlapping seeds never assign duplicate lattice sites,
 * and that seed placement order does not break occupancy invariants.
 */

import { CONFIG } from '../src/config';
import {
  ParticleSystem, FLOATS_PER_PARTICLE,
  OFF_PX, OFF_PY, OFF_ALPHA, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z,
} from '../src/particles/ParticleSystem';
import { FreezeSystem } from '../src/simulation/FreezeSystem';
import { siteKey3D } from '../src/simulation/occupancy';

const W = CONFIG.world.width;
const H = CONFIG.world.height;

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

function checkUniqueOccupancy(
  data: Float32Array, count: number, eqZ: Float32Array, label: string
): boolean {
  const siteMap = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const base = i * FLOATS_PER_PARTICLE;
    if (data[base + OFF_SEED_ID] < 0) continue;
    const key = siteKey3D(data[base + OFF_EQ_X], data[base + OFF_EQ_Y], eqZ[i]);
    if (!siteMap.has(key)) siteMap.set(key, []);
    siteMap.get(key)!.push(i);
  }
  let duplicates = 0;
  for (const [, ids] of siteMap) {
    if (ids.length > 1) duplicates++;
  }
  const ok = duplicates === 0;
  assert(ok, `${label}: no duplicate site assignments (${duplicates} duplicates found)`);
  return ok;
}

console.log('=== MULTI-SEED OCCUPANCY TEST ===');
console.log('');

// ---- Test 1: Two overlapping seeds ----
console.log('--- Test 1: Two overlapping seeds ---');
{
  const N = 200;
  const ps = new ParticleSystem(N);
  const fs = new FreezeSystem();
  const d = ps.data;

  // Place two seeds close together (overlapping radii)
  const seedSpacing = CONFIG.freeze.seedRadius * 0.8; // intentional overlap
  const cx = W / 2, cy = H / 2;

  await new Promise(r => setTimeout(r, 600));
  fs.placeSeed(cx, cy, d, N, ps.eqZ);

  // Reset cooldown for second seed
  await new Promise(r => setTimeout(r, 600));
  fs.placeSeed(cx + seedSpacing, cy, d, N, ps.eqZ);

  checkUniqueOccupancy(d, N, ps.eqZ, 'Two overlapping seeds');

  // Count how many particles got assigned
  let assigned = 0;
  for (let i = 0; i < N; i++) {
    if (d[i * FLOATS_PER_PARTICLE + OFF_SEED_ID] >= 0) assigned++;
  }
  console.log(`  Info: ${assigned}/${N} particles assigned to seeds`);
}
console.log('');

// ---- Test 2: Seed order independence for occupancy invariant ----
console.log('--- Test 2: Seed order independence ---');
{
  const N = 200;
  const seedSpacing = CONFIG.freeze.seedRadius * 0.6;
  const cx = W / 2, cy = H / 2;

  // Run A then B
  const psAB = new ParticleSystem(N);
  const fsAB = new FreezeSystem();
  await new Promise(r => setTimeout(r, 600));
  fsAB.placeSeed(cx, cy, psAB.data, N, psAB.eqZ);
  await new Promise(r => setTimeout(r, 600));
  fsAB.placeSeed(cx + seedSpacing, cy, psAB.data, N, psAB.eqZ);

  const okAB = checkUniqueOccupancy(psAB.data, N, psAB.eqZ, 'Order A→B');

  // Run B then A (same initial state)
  const psBA = new ParticleSystem(N);
  const fsBA = new FreezeSystem();
  await new Promise(r => setTimeout(r, 600));
  fsBA.placeSeed(cx + seedSpacing, cy, psBA.data, N, psBA.eqZ);
  await new Promise(r => setTimeout(r, 600));
  fsBA.placeSeed(cx, cy, psBA.data, N, psBA.eqZ);

  const okBA = checkUniqueOccupancy(psBA.data, N, psBA.eqZ, 'Order B→A');

  assert(okAB && okBA, 'Both orderings maintain uniqueness');
}
console.log('');

// ---- Test 3: Propagation after multi-seed also respects occupancy ----
console.log('--- Test 3: Occupancy after propagation ---');
{
  const N = 300;
  const ps = new ParticleSystem(N);
  const fs = new FreezeSystem();
  const d = ps.data;

  await new Promise(r => setTimeout(r, 600));
  fs.placeSeed(W / 2, H / 2, d, N, ps.eqZ);
  await new Promise(r => setTimeout(r, 600));
  fs.placeSeed(W / 2 + 50, H / 2, d, N, ps.eqZ);

  // Run propagation
  for (let frame = 0; frame < 100; frame++) {
    fs.update(d, N, ps.eqZ);
  }

  checkUniqueOccupancy(d, N, ps.eqZ, 'After 100 propagation frames');
}
console.log('');

// ---- Summary ----
console.log('=== SUMMARY ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  console.log('SEED OCCUPANCY: FAIL');
  process.exit(1);
} else {
  console.log('SEED OCCUPANCY: PASS');
}
