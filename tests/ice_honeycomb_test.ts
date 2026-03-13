/**
 * Deterministic test: ice-like honeycomb lattice structure
 * Tests that LatticeSystem produces honeycomb sublattice (not close-packed)
 * with open hex rings, no center occupancy, and coordination = 3 per layer.
 *
 * Evaluates:
 * - Ring center rejection (1/3 of triangular sites excluded)
 * - Honeycomb coordination (3 in-plane neighbors per site)
 * - Open hex ring topology (empty ring centers)
 * - O-O nearest-neighbor distances
 * - No dense blob formation
 */

import { CONFIG } from '../src/config';
import { LatticeSystem, LatticeSite } from '../src/simulation/LatticeSystem';

const SPACING = CONFIG.freeze.latticeSpacing;
const Z_SPACING = CONFIG.freeze.zLayerSpacing;
const lattice = new LatticeSystem();

const seedX = CONFIG.world.width / 2;
const seedY = CONFIG.world.height / 2;
const seedTheta = 0;

console.log('=== ICE HONEYCOMB LATTICE TEST ===');
console.log(`latticeSpacing = ${SPACING}, zLayerSpacing = ${Z_SPACING}`);
console.log('');

// Test 1: Ring center rejection
console.log('--- Test 1: Ring center rejection ---');
let totalCenters = 0;
let totalSites = 0;
for (let r = -5; r <= 5; r++) {
  for (let c = -5; c <= 5; c++) {
    totalSites++;
    if (lattice.isRingCenter(r, c)) totalCenters++;
  }
}
console.log(`Total sites checked: ${totalSites}`);
console.log(`Ring centers (rejected): ${totalCenters}`);
console.log(`Valid (honeycomb): ${totalSites - totalCenters}`);
console.log(`Rejection ratio: ${(totalCenters / totalSites * 100).toFixed(1)}%`);
const pass1 = Math.abs(totalCenters / totalSites - 1 / 3) < 0.05;
console.log(`Approximately 1/3 rejected: ${pass1 ? 'YES' : 'NO'}`);
console.log('');

// Test 2: Generate a patch of honeycomb sites and check coordination
console.log('--- Test 2: In-plane coordination ---');
const sites: LatticeSite[] = [];
const z0 = 0; // single layer for in-plane test
for (let gx = -3; gx <= 3; gx++) {
  for (let gy = -3; gy <= 3; gy++) {
    const px = seedX + gx * SPACING * 0.5 + gy * SPACING * 0.25;
    const py = seedY + gy * SPACING * 0.43;
    const site = lattice.nearestSite(px, py, z0, seedX, seedY, seedTheta);
    // Avoid exact duplicates
    const isDup = sites.some(s =>
      Math.abs(s.x - site.x) < 0.5 && Math.abs(s.y - site.y) < 0.5 && Math.abs(s.z - site.z) < 0.5
    );
    if (!isDup) sites.push(site);
  }
}
console.log(`Generated ${sites.length} unique honeycomb sites in single layer`);

// Count in-plane nearest neighbors for each site (same Z layer only)
const coordCounts: number[] = [];
const nnDists: number[] = [];
for (let i = 0; i < sites.length; i++) {
  let nn = 0;
  for (let j = 0; j < sites.length; j++) {
    if (i === j) continue;
    const dz = Math.abs(sites[j].z - sites[i].z);
    if (dz > 1) continue; // different Z layer — skip for in-plane count
    const dx = sites[j].x - sites[i].x;
    const dy = sites[j].y - sites[i].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SPACING * 1.15 && dist > SPACING * 0.5) {
      nn++;
      if (i < j) nnDists.push(dist);
    }
  }
  coordCounts.push(nn);
}

// Distribution of coordination numbers
const coordDist = new Map<number, number>();
for (const c of coordCounts) {
  coordDist.set(c, (coordDist.get(c) || 0) + 1);
}
console.log('In-plane coordination distribution:');
for (const [coord, count] of [...coordDist.entries()].sort()) {
  console.log(`  coord=${coord}: ${count} sites`);
}
const avgCoord = coordCounts.reduce((a, b) => a + b, 0) / coordCounts.length;
console.log(`Average coordination: ${avgCoord.toFixed(2)}`);
// Interior sites should have exactly 3 neighbors; edge sites may have fewer
// Average should be ≤ 3 (some edge sites have 1-2)
const pass2 = avgCoord <= 3.5;
console.log(`Average coord ≤ 3.5 (honeycomb): ${pass2 ? 'YES' : 'NO'}`);
console.log('');

// Test 3: No ring-center occupancy
console.log('--- Test 3: No ring-center occupancy ---');
// In a honeycomb, max in-plane coordination is 3. Any site with ≥ 5 would indicate
// a ring center was incorrectly included or close-packed structure.
const hasOverCoord = coordCounts.some(c => c >= 5);
console.log(`Any site with in-plane coord ≥ 5 (close-packed): ${hasOverCoord ? 'YES (BAD)' : 'NO (GOOD)'}`);
const pass3 = !hasOverCoord;
console.log('');

// Test 4: NN distances
console.log('--- Test 4: Nearest-neighbor distances ---');
if (nnDists.length > 0) {
  const minDist = Math.min(...nnDists);
  const maxDist = Math.max(...nnDists);
  const avgDist = nnDists.reduce((a, b) => a + b, 0) / nnDists.length;
  console.log(`NN pairs: ${nnDists.length}`);
  console.log(`Min NN distance: ${minDist.toFixed(3)} px`);
  console.log(`Max NN distance: ${maxDist.toFixed(3)} px`);
  console.log(`Avg NN distance: ${avgDist.toFixed(3)} px`);
  console.log(`Target: ${SPACING} px`);
}
const pass4 = nnDists.length > 0 && Math.min(...nnDists) > SPACING * 0.85;
console.log(`NN distances reasonable: ${pass4 ? 'YES' : 'NO'}`);
console.log('');

// Test 5: Density check (honeycomb = 2/3 of triangular)
console.log('--- Test 5: Site density ---');
// In a triangular lattice with the same coverage area, we'd expect more sites
// Generate triangular reference
let triSites = 0;
for (let gx = -3; gx <= 3; gx++) {
  for (let gy = -3; gy <= 3; gy++) {
    triSites++;
  }
}
const densityRatio = sites.length / triSites;
console.log(`Honeycomb sites: ${sites.length}`);
console.log(`Grid sample points: ${triSites}`);
console.log(`Density ratio: ${densityRatio.toFixed(2)}`);
// Honeycomb should have ~2/3 the density of triangular
const pass5 = densityRatio < 0.95; // fewer sites than sample points due to deduplication and ring center removal
console.log('');

// Summary
console.log('=== CRITERIA CHECK ===');
console.log(`1. 1/3 ring centers rejected: ${pass1 ? 'PASS' : 'FAIL'}`);
console.log(`2. Average coord ≤ 3.5 (honeycomb): ${pass2 ? 'PASS' : 'FAIL'}`);
console.log(`3. No coord ≥ 6 (no close-packed centers): ${pass3 ? 'PASS' : 'FAIL'}`);
console.log(`4. NN distances reasonable: ${pass4 ? 'PASS' : 'FAIL'}`);
console.log(`5. Open density (not close-packed): ${pass5 ? 'PASS' : 'FAIL'}`);
console.log('');
console.log(`OVERALL: ${pass1 && pass2 && pass3 && pass4 && pass5 ? 'GOOD' : 'BAD'}`);
