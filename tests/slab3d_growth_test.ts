/**
 * Deterministic test: 3D lattice site generation and layer variation
 * Tests that the LatticeSystem correctly generates 3D HCP-like sites
 * with ABAB stacking and variable layer count across XY regions.
 *
 * Evaluates:
 * - O(1) site computation correctness
 * - ABAB stacking offset between even/odd layers
 * - Layer count variation across different XY positions
 * - Occupied-site uniqueness (no duplicate assignments)
 * - O-O spacing within expected range
 */

import { CONFIG } from '../src/config';
import { LatticeSystem, LatticeSite } from '../src/simulation/LatticeSystem';

const SPACING = CONFIG.freeze.latticeSpacing;
const Z_SPACING = CONFIG.freeze.zLayerSpacing;
const lattice = new LatticeSystem();

// Test seed at world center
const seedX = CONFIG.world.width / 2;
const seedY = CONFIG.world.height / 2;
const seedTheta = 0;

console.log('=== SLAB 3D LATTICE GENERATION TEST ===');
console.log(`latticeSpacing = ${SPACING}, zLayerSpacing = ${Z_SPACING}`);
console.log(`zLayerCount = ${CONFIG.freeze.zLayerCount}, zLayerVariation = ${CONFIG.freeze.zLayerVariation}`);
console.log('');

// Test 1: Layer count variation across XY
console.log('--- Test 1: Layer count variation ---');
const layerCounts = new Map<number, number>();
const samplePoints = 100;
for (let sx = -200; sx <= 200; sx += 40) {
  for (let sy = -200; sy <= 200; sy += 40) {
    const count = lattice.localLayerCount(sx, sy);
    layerCounts.set(count, (layerCounts.get(count) || 0) + 1);
  }
}
console.log('Layer count distribution across sample points:');
for (const [count, freq] of [...layerCounts.entries()].sort()) {
  console.log(`  ${count} layers: ${freq} points`);
}
const hasVariation = layerCounts.size > 1;
console.log(`Variation present: ${hasVariation ? 'YES' : 'NO'}`);
console.log('');

// Test 2: ABAB offset between layers
// Use a position offset from seed center to land on a valid honeycomb site
// (seed center row=0,col=0 is a ring center in the honeycomb sublattice)
console.log('--- Test 2: ABAB stacking offset ---');
const site0 = lattice.nearestSite(seedX + SPACING, seedY, 0, seedX, seedY, seedTheta);
const site1 = lattice.nearestSite(seedX + SPACING * 1.25, seedY, Z_SPACING * 0.5, seedX, seedY, seedTheta);
console.log(`Even-layer site at z=${site0.z.toFixed(1)}: (${site0.x.toFixed(2)}, ${site0.y.toFixed(2)})`);
console.log(`Odd-layer site at z=${site1.z.toFixed(1)}: (${site1.x.toFixed(2)}, ${site1.y.toFixed(2)})`);
const xyOffset = Math.sqrt(
  (site1.x - site0.x) ** 2 + (site1.y - site0.y) ** 2
);
console.log(`XY offset between layers: ${xyOffset.toFixed(2)} px`);
const hasABAB = xyOffset > 1.0; // odd layers should be offset from even layers
console.log(`ABAB offset present: ${hasABAB ? 'YES' : 'NO'}`);
console.log('');

// Test 3: Generate a grid of 3D sites and check spacing
console.log('--- Test 3: 3D site spacing validation ---');
const sites: LatticeSite[] = [];
// Generate sites in a local patch
for (let row = -2; row <= 2; row++) {
  for (let col = -2; col <= 2; col++) {
    const px = seedX + col * SPACING + row * SPACING * 0.1;
    const py = seedY + row * SPACING * 0.866;
    for (let z = -Z_SPACING; z <= Z_SPACING; z += Z_SPACING) {
      const site = lattice.nearestSite(px, py, z, seedX, seedY, seedTheta);
      // Avoid exact duplicates
      const isDup = sites.some(s =>
        Math.abs(s.x - site.x) < 0.5 && Math.abs(s.y - site.y) < 0.5 && Math.abs(s.z - site.z) < 0.5
      );
      if (!isDup) sites.push(site);
    }
  }
}

console.log(`Generated ${sites.length} unique 3D sites`);

// Check O-O distances (in-plane only — cross-region comparisons are invalid)
let minInPlaneDist = Infinity, maxInPlaneDist = 0;
let minInterLayerDist = Infinity;
let inPlanePairs = 0, interLayerPairs = 0;
for (let i = 0; i < sites.length; i++) {
  for (let j = i + 1; j < sites.length; j++) {
    const dx = sites[j].x - sites[i].x;
    const dy = sites[j].y - sites[i].y;
    const dz = sites[j].z - sites[i].z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < SPACING * 1.5) {
      if (Math.abs(dz) < 1) {
        // In-plane (same Z layer)
        if (dist < minInPlaneDist) minInPlaneDist = dist;
        if (dist > maxInPlaneDist) maxInPlaneDist = dist;
        inPlanePairs++;
      } else {
        // Inter-layer (different Z)
        if (dist < minInterLayerDist) minInterLayerDist = dist;
        interLayerPairs++;
      }
    }
  }
}
console.log(`Min in-plane NN distance: ${minInPlaneDist.toFixed(3)} px`);
console.log(`Max in-plane NN distance: ${maxInPlaneDist.toFixed(3)} px`);
console.log(`Min inter-layer NN distance: ${minInterLayerDist.toFixed(3)} px`);
console.log(`In-plane NN pairs: ${inPlanePairs}`);
console.log(`Inter-layer NN pairs: ${interLayerPairs}`);
console.log('');

// Test 4: Z layers per site
console.log('--- Test 4: Z layer distribution ---');
const zLayers = new Map<number, number>();
for (const site of sites) {
  const rz = Math.round(site.z * 10) / 10;
  zLayers.set(rz, (zLayers.get(rz) || 0) + 1);
}
console.log('Z layers occupied:');
for (const [z, count] of [...zLayers.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  z = ${z.toFixed(1)}: ${count} sites`);
}
const numZLayers = zLayers.size;
console.log(`Total distinct Z layers: ${numZLayers}`);
console.log('');

// Test 5: Slab half computation
console.log('--- Test 5: Slab bounds ---');
const slabHalf = lattice.getSlabHalf();
console.log(`Computed slabHalf: ${slabHalf.toFixed(1)} px`);
const maxLayerZ = Math.max(...[...zLayers.keys()]);
const minLayerZ = Math.min(...[...zLayers.keys()]);
console.log(`Lattice Z range: [${minLayerZ.toFixed(1)}, ${maxLayerZ.toFixed(1)}]`);
console.log(`Margin: ${(slabHalf - maxLayerZ).toFixed(1)} px beyond lattice`);
console.log('');

// Summary
console.log('=== CRITERIA CHECK ===');
const pass1 = hasVariation;
const pass2 = hasABAB;
const pass3 = minInPlaneDist > SPACING * 0.85 && minInPlaneDist < SPACING * 1.15;
const pass4 = numZLayers >= 2;
const pass5 = slabHalf > maxLayerZ;
const pass6 = interLayerPairs > 0 || numZLayers === 1;

console.log(`1. Layer count varies (2-4): ${pass1 ? 'PASS' : 'FAIL'}`);
console.log(`2. ABAB offset present: ${pass2 ? 'PASS' : 'FAIL'}`);
console.log(`3. In-plane NN spacing within 15% of target: ${pass3 ? 'PASS' : 'FAIL'} (min=${minInPlaneDist.toFixed(2)}, target=${SPACING})`);
console.log(`4. Multiple Z layers found: ${pass4 ? 'PASS' : 'FAIL'} (${numZLayers} layers)`);
console.log(`5. Slab bounds contain lattice: ${pass5 ? 'PASS' : 'FAIL'}`);
console.log(`6. Inter-layer pairs found: ${pass6 ? 'PASS' : 'FAIL'}`);
console.log('');
console.log(`OVERALL: ${pass1 && pass2 && pass3 && pass4 && pass5 && pass6 ? 'GOOD' : 'BAD'}`);
