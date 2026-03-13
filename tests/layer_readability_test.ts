/**
 * Deterministic test: layer distribution and front-layer bias
 * Tests that the LatticeSystem preferentially assigns sites to front (negative Z)
 * layers, reducing visual clutter from farther layers.
 *
 * Evaluates:
 * - Layer distribution with front-layer bias
 * - Whether front layers have more sites than back layers
 * - Total slab depth reduction (compared to old 7-layer spread)
 * - Whether in-plane structure is preserved despite bias
 */

import { CONFIG } from '../src/config';
import { LatticeSystem, LatticeSite } from '../src/simulation/LatticeSystem';

const SPACING = CONFIG.freeze.latticeSpacing;
const Z_SPACING = CONFIG.freeze.zLayerSpacing;
const lattice = new LatticeSystem();

const seedX = CONFIG.world.width / 2;
const seedY = CONFIG.world.height / 2;
const seedTheta = 0;

console.log('=== LAYER READABILITY TEST ===');
console.log(`latticeSpacing = ${SPACING}, zLayerSpacing = ${Z_SPACING}`);
console.log(`zLayerCount = ${CONFIG.freeze.zLayerCount}, zLayerVariation = ${CONFIG.freeze.zLayerVariation}`);
console.log('');

// Test 1: Layer count range
console.log('--- Test 1: Layer count range ---');
const layerCounts = new Map<number, number>();
for (let sx = -200; sx <= 200; sx += 40) {
  for (let sy = -200; sy <= 200; sy += 40) {
    const count = lattice.localLayerCount(sx, sy);
    layerCounts.set(count, (layerCounts.get(count) || 0) + 1);
  }
}
console.log('Layer count distribution:');
for (const [count, freq] of [...layerCounts.entries()].sort()) {
  console.log(`  ${count} layers: ${freq} points`);
}
const maxLayerCount = Math.max(...layerCounts.keys());
const minLayerCount = Math.min(...layerCounts.keys());
console.log(`Range: ${minLayerCount}-${maxLayerCount}`);
const pass1 = maxLayerCount <= 4 && minLayerCount >= 2;
console.log(`Layer range 2-4: ${pass1 ? 'YES' : 'NO'}`);
console.log('');

// Test 2: Z layer occupancy with front bias
console.log('--- Test 2: Front-layer bias ---');
const sites: LatticeSite[] = [];
// Generate sites from particles at z=0 (unbiased starting position)
for (let gx = -3; gx <= 3; gx++) {
  for (let gy = -3; gy <= 3; gy++) {
    const px = seedX + gx * SPACING * 0.5;
    const py = seedY + gy * SPACING * 0.43;
    const site = lattice.nearestSite(px, py, 0, seedX, seedY, seedTheta);
    const isDup = sites.some(s =>
      Math.abs(s.x - site.x) < 0.5 && Math.abs(s.y - site.y) < 0.5 && Math.abs(s.z - site.z) < 0.5
    );
    if (!isDup) sites.push(site);
  }
}

const zLayerDist = new Map<number, number>();
for (const site of sites) {
  const rz = Math.round(site.z * 10) / 10;
  zLayerDist.set(rz, (zLayerDist.get(rz) || 0) + 1);
}
console.log(`Total unique sites: ${sites.length}`);
console.log('Z layer distribution:');
let frontCount = 0, backCount = 0;
for (const [z, count] of [...zLayerDist.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  z = ${z.toFixed(1)}: ${count} sites`);
  if (z < 0) frontCount += count;
  else if (z > 0) backCount += count;
}
console.log(`Front (z<0): ${frontCount}, Center (z=0): ${(zLayerDist.get(0) || 0)}, Back (z>0): ${backCount}`);
const frontBiasPresent = frontCount >= backCount;
console.log(`Front-layer bias present: ${frontBiasPresent ? 'YES' : 'NO'}`);
console.log('');

// Test 3: Slab depth
console.log('--- Test 3: Slab depth ---');
const slabHalf = lattice.getSlabHalf();
const maxZ = Math.max(...sites.map(s => s.z));
const minZ = Math.min(...sites.map(s => s.z));
const totalDepth = maxZ - minZ;
console.log(`Slab half: ${slabHalf.toFixed(1)} px`);
console.log(`Lattice Z range: [${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
console.log(`Total lattice depth: ${totalDepth.toFixed(1)} px`);
const numZLayers = zLayerDist.size;
console.log(`Distinct Z layers: ${numZLayers}`);
// With 3 base layers and spacing 16, total depth should be ~32px (2 layers × 16)
const pass3 = totalDepth <= 64 && numZLayers <= 5;
console.log(`Depth ≤ 64px and ≤ 5 layers: ${pass3 ? 'YES' : 'NO'}`);
console.log('');

// Test 4: In-plane structure preserved
console.log('--- Test 4: In-plane structure preserved ---');
let nnPairs = 0;
let minNNDist = Infinity;
let maxNNDist = 0;
for (let i = 0; i < sites.length; i++) {
  for (let j = i + 1; j < sites.length; j++) {
    if (Math.abs(sites[j].z - sites[i].z) > 1) continue; // same layer only
    const dx = sites[j].x - sites[i].x;
    const dy = sites[j].y - sites[i].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SPACING * 1.15 && dist > SPACING * 0.5) {
      nnPairs++;
      if (dist < minNNDist) minNNDist = dist;
      if (dist > maxNNDist) maxNNDist = dist;
    }
  }
}
console.log(`In-plane NN pairs: ${nnPairs}`);
console.log(`Min NN distance: ${minNNDist.toFixed(3)} px`);
console.log(`Max NN distance: ${maxNNDist.toFixed(3)} px`);
const pass4 = nnPairs > 0 && minNNDist > SPACING * 0.85;
console.log(`Structure preserved: ${pass4 ? 'YES' : 'NO'}`);
console.log('');

// Summary
console.log('=== CRITERIA CHECK ===');
const pass2 = frontBiasPresent;
console.log(`1. Layer range 2-4 (not 3-5): ${pass1 ? 'PASS' : 'FAIL'}`);
console.log(`2. Front-layer bias: ${pass2 ? 'PASS' : 'FAIL'}`);
console.log(`3. Reduced slab depth: ${pass3 ? 'PASS' : 'FAIL'}`);
console.log(`4. In-plane structure preserved: ${pass4 ? 'PASS' : 'FAIL'}`);
console.log('');
console.log(`OVERALL: ${pass1 && pass2 && pass3 && pass4 ? 'GOOD' : 'BAD'}`);
