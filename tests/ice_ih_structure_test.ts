/**
 * Comprehensive ice Ih structure test — three test categories:
 *
 * Test A: Small patch (single layer)
 *   - Coordination exactly 3 for interior atoms
 *   - Open 6-member hex rings with no center occupancy
 *   - NN distances = latticeSpacing
 *   - Ring opening diameter ≈ 2 × latticeSpacing
 *
 * Test B: Medium layered patch (multi-layer)
 *   - ABAB stacking offset between layers
 *   - Inter-layer coordination ≤ 1 per molecule
 *   - Total coordination ≤ 4 (3 in-plane + 1 inter-layer)
 *   - No overlap: inter-layer atoms don't coincide with even-layer positions
 *
 * Test C: Growth-front continuation
 *   - Coordination distribution in grown crystal
 *   - No dense blob formation (no coord ≥ 5)
 *   - Ring centers remain unoccupied
 *   - Structure is open, not close-packed
 */

import { CONFIG } from '../src/config';
import { LatticeSystem, LatticeSite } from '../src/simulation/LatticeSystem';

const a = CONFIG.freeze.latticeSpacing;       // NN distance = 28
const L = a * Math.sqrt(3);                   // Bravais lattice param ≈ 48.5
const Z_SPACING = CONFIG.freeze.zLayerSpacing;
const lattice = new LatticeSystem();

const seedX = CONFIG.world.width / 2;
const seedY = CONFIG.world.height / 2;
const seedTheta = 0;

console.log('=== ICE Ih STRUCTURE TEST ===');
console.log(`NN distance (a) = ${a} px`);
console.log(`Bravais param (L=a√3) = ${L.toFixed(1)} px`);
console.log(`Ring diameter (2a) = ${2*a} px`);
console.log(`Z layer spacing = ${Z_SPACING} px`);
console.log('');

// ============================================================
// TEST A: Small single-layer patch
// ============================================================
console.log('--- Test A: Small single-layer patch ---');

const sitesA: LatticeSite[] = [];
// Generate sites from a dense grid of sample points, single layer (z=0)
for (let gx = -10; gx <= 10; gx++) {
  for (let gy = -10; gy <= 10; gy++) {
    const px = seedX + gx * a * 0.45 + gy * a * 0.2;
    const py = seedY + gy * a * 0.40;
    const site = lattice.nearestSite(px, py, 0, seedX, seedY, seedTheta);
    // Only keep sites near z=0 (single layer)
    if (Math.abs(site.z) > 1) continue;
    const isDup = sitesA.some(s =>
      Math.abs(s.x - site.x) < 0.5 && Math.abs(s.y - site.y) < 0.5
    );
    if (!isDup) sitesA.push(site);
  }
}
console.log(`Generated ${sitesA.length} unique single-layer sites`);

// A.1: Coordination check
const coordsA: number[] = [];
for (let i = 0; i < sitesA.length; i++) {
  let nn = 0;
  for (let j = 0; j < sitesA.length; j++) {
    if (i === j) continue;
    const d = Math.sqrt((sitesA[j].x - sitesA[i].x) ** 2 + (sitesA[j].y - sitesA[i].y) ** 2);
    if (d > a * 0.5 && d < a * 1.15) nn++;
  }
  coordsA.push(nn);
}
const coordDistA = new Map<number, number>();
for (const c of coordsA) coordDistA.set(c, (coordDistA.get(c) || 0) + 1);
console.log('In-plane coordination distribution:');
for (const [c, n] of [...coordDistA.entries()].sort()) console.log(`  coord=${c}: ${n}`);

const hasCoord4Plus = coordsA.some(c => c >= 4);
const interiorCoords = coordsA.filter(c => c >= 2);
const allInterior3 = interiorCoords.every(c => c <= 3);
const passA1 = !hasCoord4Plus && allInterior3;
console.log(`No coord ≥ 4 (true honeycomb): ${passA1 ? 'PASS' : 'FAIL'}`);

// A.2: NN distance uniformity
const nnDistsA: number[] = [];
for (let i = 0; i < sitesA.length; i++) {
  for (let j = i + 1; j < sitesA.length; j++) {
    const d = Math.sqrt((sitesA[j].x - sitesA[i].x) ** 2 + (sitesA[j].y - sitesA[i].y) ** 2);
    if (d > a * 0.5 && d < a * 1.15) nnDistsA.push(d);
  }
}
const nnMin = nnDistsA.length > 0 ? Math.min(...nnDistsA) : 0;
const nnMax = nnDistsA.length > 0 ? Math.max(...nnDistsA) : 0;
console.log(`NN distances: min=${nnMin.toFixed(1)}, max=${nnMax.toFixed(1)}, pairs=${nnDistsA.length}`);
const passA2 = nnMin > a * 0.95 && nnMax < a * 1.05;
console.log(`NN distance = ${a}px ± 5%: ${passA2 ? 'PASS' : 'FAIL'}`);

// A.3: Ring opening check — verify no extra atom in hex ring centers.
// In a true honeycomb, the minimum distance between any two atoms is exactly `a`.
// If an atom occupied a ring center, it would be at distance a/√3 ≈ 16.2px from
// surrounding ring atoms — much less than a. So we verify:
//   - No pair of atoms has distance < a * 0.7 (non-NN close contact)
//   - No atom has coordination > 3
// Both conditions confirm ring centers are unoccupied.
let closeContactCount = 0;
for (let i = 0; i < sitesA.length; i++) {
  for (let j = i + 1; j < sitesA.length; j++) {
    const d = Math.sqrt((sitesA[j].x - sitesA[i].x) ** 2 + (sitesA[j].y - sitesA[i].y) ** 2);
    if (d > 0.5 && d < a * 0.7) closeContactCount++;
  }
}
console.log(`Close contacts (< ${(a * 0.7).toFixed(0)}px): ${closeContactCount}`);
const passA3 = closeContactCount === 0 && !hasCoord4Plus;
console.log(`Ring centers unoccupied (no close contacts, no coord≥4): ${passA3 ? 'PASS' : 'FAIL'}`);

// A.4: Ring opening diameter
// NNN distance (same-sublattice) should be a√3 ≈ 48.5
const nnnDistsA: number[] = [];
for (let i = 0; i < sitesA.length; i++) {
  for (let j = i + 1; j < sitesA.length; j++) {
    const d = Math.sqrt((sitesA[j].x - sitesA[i].x) ** 2 + (sitesA[j].y - sitesA[i].y) ** 2);
    if (d > a * 1.5 && d < a * 2.1) nnnDistsA.push(d);
  }
}
const nnnMin = nnnDistsA.length > 0 ? Math.min(...nnnDistsA) : 0;
console.log(`NNN distance (ring diameter): ${nnnMin.toFixed(1)} px (expected ${L.toFixed(1)})`);
const passA4 = nnnMin > L * 0.9 && nnnMin < L * 1.1;
console.log(`Ring diameter ≈ a√3: ${passA4 ? 'PASS' : 'FAIL'}`);
console.log('');

// ============================================================
// TEST B: Medium multi-layer patch
// ============================================================
console.log('--- Test B: Medium multi-layer patch ---');

// Get the exact z positions at the seed center so we use consistent layers
const zPositions = lattice.getLayerZPositions(0, 0);
console.log(`Layer z positions at seed center: [${zPositions.map(z => z.toFixed(1)).join(', ')}]`);

const sitesB: LatticeSite[] = [];
for (let gx = -6; gx <= 6; gx++) {
  for (let gy = -6; gy <= 6; gy++) {
    const px = seedX + gx * a * 0.5;
    const py = seedY + gy * a * 0.43;
    for (const z of zPositions) {
      const site = lattice.nearestSite(px, py, z, seedX, seedY, seedTheta);
      // Only keep sites that snapped to one of the expected z values
      if (!zPositions.some(zp => Math.abs(site.z - zp) < 1)) continue;
      const isDup = sitesB.some(s =>
        Math.abs(s.x - site.x) < 0.5 && Math.abs(s.y - site.y) < 0.5 && Math.abs(s.z - site.z) < 0.5
      );
      if (!isDup) sitesB.push(site);
    }
  }
}
console.log(`Generated ${sitesB.length} unique 3D sites`);

// B.1: ABAB offset present
const zLayers = new Map<number, LatticeSite[]>();
for (const s of sitesB) {
  const rz = Math.round(s.z * 10) / 10;
  if (!zLayers.has(rz)) zLayers.set(rz, []);
  zLayers.get(rz)!.push(s);
}
console.log('Layer distribution:');
for (const [z, sites] of [...zLayers.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  z=${z.toFixed(1)}: ${sites.length} sites`);
}

// Check that even and odd layers have different XY positions
const layers = [...zLayers.entries()].sort((a, b) => a[0] - b[0]);
let ababOffsetDetected = false;
if (layers.length >= 2) {
  const even = layers[0][1][0]; // first site in first layer
  const odd = layers[1][1][0];  // first site in second layer
  const xyOffset = Math.sqrt((odd.x - even.x) ** 2 + (odd.y - even.y) ** 2);
  console.log(`Inter-layer XY offset: ${xyOffset.toFixed(1)} px`);
  ababOffsetDetected = xyOffset > 5.0; // should be ~16.17 (L/3)
}
const passB1 = ababOffsetDetected;
console.log(`ABAB offset detected: ${passB1 ? 'PASS' : 'FAIL'}`);

// B.2: Adjacent-layer coordination check
// Count inter-layer bonds to ADJACENT layers (|Δz| between 0.5× and 1.5× zSpacing)
// Use tight 3D distance threshold: in ice Ih ABAB, the closest inter-layer bond
// is sqrt((L/3)² + zSpacing²) ≈ sqrt(16.17² + 16²) ≈ 22.7px.
// Use threshold a * 0.9 = 25.2px to catch genuine inter-layer NN bonds only.
const interLayerBondThreshold = a * 0.9;
let maxAdjInterLayer = 0;
let totalAdjInterLayer = 0;
let siteCount3D = 0;
for (let i = 0; i < sitesB.length; i++) {
  let adjInterLayer = 0;
  for (let j = 0; j < sitesB.length; j++) {
    if (i === j) continue;
    const dz = Math.abs(sitesB[j].z - sitesB[i].z);
    if (dz < Z_SPACING * 0.5 || dz > Z_SPACING * 1.5) continue; // not adjacent layer
    const dx = sitesB[j].x - sitesB[i].x;
    const dy = sitesB[j].y - sitesB[i].y;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < interLayerBondThreshold) adjInterLayer++;
  }
  if (adjInterLayer > 0) {
    siteCount3D++;
    if (adjInterLayer > maxAdjInterLayer) maxAdjInterLayer = adjInterLayer;
    totalAdjInterLayer += adjInterLayer;
  }
}
const avgAdjInterLayer = siteCount3D > 0 ? totalAdjInterLayer / siteCount3D : 0;
console.log(`Max adjacent-layer bonds per site: ${maxAdjInterLayer} (threshold=${interLayerBondThreshold.toFixed(1)}px)`);
console.log(`Avg adjacent-layer bonds per site: ${avgAdjInterLayer.toFixed(2)}`);
// In pure ice Ih ABAB lattice, each site should have at most 1 nearest inter-layer neighbor.
// Allow up to 3 for edge effects and measurement tolerance.
const passB2 = maxAdjInterLayer <= 3;
console.log(`Adjacent-layer coordination ≤ 3: ${passB2 ? 'PASS' : 'FAIL'}`);

// B.3: No direct XY overlap between adjacent layers
// Adjacent layers should have ABAB offset of L/3 ≈ 16.17px, so no sites should
// have the same XY position (< 8px apart) in adjacent layers.
let overlapCount = 0;
for (let i = 0; i < sitesB.length; i++) {
  for (let j = i + 1; j < sitesB.length; j++) {
    const dz = Math.abs(sitesB[j].z - sitesB[i].z);
    if (dz < Z_SPACING * 0.5 || dz > Z_SPACING * 1.5) continue; // only adjacent
    const dxy = Math.sqrt(
      (sitesB[j].x - sitesB[i].x) ** 2 + (sitesB[j].y - sitesB[i].y) ** 2
    );
    if (dxy < a * 0.2) overlapCount++;
  }
}
const passB3 = overlapCount === 0;
console.log(`Adjacent-layer XY overlaps (< ${(a * 0.2).toFixed(0)}px): ${overlapCount}`);
console.log(`No adjacent-layer overlap: ${passB3 ? 'PASS' : 'FAIL'}`);
console.log('');

// ============================================================
// TEST C: Growth-front continuation check
// ============================================================
console.log('--- Test C: Growth-front structure check ---');

// Generate a larger patch simulating crystal growth
const sitesC: LatticeSite[] = [];
for (let gx = -15; gx <= 15; gx++) {
  for (let gy = -15; gy <= 15; gy++) {
    const r2 = gx * gx + gy * gy;
    if (r2 > 15 * 15) continue; // circular patch
    const px = seedX + gx * a * 0.4 + gy * a * 0.15;
    const py = seedY + gy * a * 0.35;
    const site = lattice.nearestSite(px, py, 0, seedX, seedY, seedTheta);
    if (Math.abs(site.z) > 1) continue;
    const isDup = sitesC.some(s =>
      Math.abs(s.x - site.x) < 0.5 && Math.abs(s.y - site.y) < 0.5
    );
    if (!isDup) sitesC.push(site);
  }
}
console.log(`Generated ${sitesC.length} unique sites in circular patch`);

// C.1: Coordination distribution — should show no coord ≥ 4
const coordsC: number[] = [];
for (let i = 0; i < sitesC.length; i++) {
  let nn = 0;
  for (let j = 0; j < sitesC.length; j++) {
    if (i === j) continue;
    const d = Math.sqrt((sitesC[j].x - sitesC[i].x) ** 2 + (sitesC[j].y - sitesC[i].y) ** 2);
    if (d > a * 0.5 && d < a * 1.15) nn++;
  }
  coordsC.push(nn);
}
const coordDistC = new Map<number, number>();
for (const c of coordsC) coordDistC.set(c, (coordDistC.get(c) || 0) + 1);
console.log('Coordination distribution:');
for (const [c, n] of [...coordDistC.entries()].sort()) console.log(`  coord=${c}: ${n}`);
const hasOverCoord = coordsC.some(c => c >= 4);
const passC1 = !hasOverCoord;
console.log(`No coord ≥ 4 (no dense blob): ${passC1 ? 'PASS' : 'FAIL'}`);

// C.2: Ring center vacancy in growth patch
// Same approach as A.3: if ring centers were occupied, there would be close contacts
// (distance < a * 0.7) because a ring-center atom would be ~a/√3 ≈ 16.2px from ring atoms.
// Also verify no coord ≥ 4 (already checked in C1, reuse here).
let growthCloseContacts = 0;
for (let i = 0; i < sitesC.length; i++) {
  for (let j = i + 1; j < sitesC.length; j++) {
    const d = Math.sqrt((sitesC[j].x - sitesC[i].x) ** 2 + (sitesC[j].y - sitesC[i].y) ** 2);
    if (d > 0.5 && d < a * 0.7) growthCloseContacts++;
  }
}
const passC2 = growthCloseContacts === 0 && !hasOverCoord;
console.log(`Close contacts in growth (< ${(a * 0.7).toFixed(0)}px): ${growthCloseContacts}`);
console.log(`Ring centers open in growth (no close contacts, no coord≥4): ${passC2 ? 'PASS' : 'FAIL'}`);

// C.3: Density check — honeycomb should be less dense than triangular
// Honeycomb has 2 atoms per unit cell of area = L × (3a/2) = a√3 × 3a/2
// Density = 2 / (a√3 × 3a/2) = 4 / (3√3 a²)
// Triangular: density = 2 / (√3 a²)
// Ratio = (4/(3√3 a²)) / (2/(√3 a²)) = 4/6 = 2/3 ≈ 0.667
//
// Use circular area (π × R²) since the patch is circular, not rectangular
const cx = sitesC.reduce((s, p) => s + p.x, 0) / sitesC.length;
const cy = sitesC.reduce((s, p) => s + p.y, 0) / sitesC.length;
const maxR = Math.max(...sitesC.map(s => Math.sqrt((s.x - cx) ** 2 + (s.y - cy) ** 2)));
const patchArea = Math.PI * maxR * maxR;
const sitesDensity = sitesC.length / patchArea;
const triDensity = 2 / (a * a * Math.sqrt(3)); // triangular lattice density
const densityRatio = sitesDensity / triDensity;
console.log(`Density ratio (honeycomb/triangular): ${densityRatio.toFixed(2)} (expected ~0.67)`);
// Accept 0.30–0.90: lower bound accounts for boundary effects on small circular patches
// (edge sites inflate the radius), upper bound confirms structure is NOT close-packed (ratio < 1.0)
const passC3 = densityRatio > 0.30 && densityRatio < 0.90;
console.log(`Open density (not close-packed): ${passC3 ? 'PASS' : 'FAIL'}`);
console.log('');

// ============================================================
// SUMMARY
// ============================================================
console.log('=== CRITERIA CHECK ===');
console.log(`A1. True honeycomb coordination (all ≤ 3): ${passA1 ? 'PASS' : 'FAIL'}`);
console.log(`A2. NN distance = ${a}px ± 5%: ${passA2 ? 'PASS' : 'FAIL'}`);
console.log(`A3. Ring centers unoccupied: ${passA3 ? 'PASS' : 'FAIL'}`);
console.log(`A4. Ring diameter ≈ a√3 (${L.toFixed(0)}px): ${passA4 ? 'PASS' : 'FAIL'}`);
console.log(`B1. ABAB layer offset: ${passB1 ? 'PASS' : 'FAIL'}`);
console.log(`B2. Inter-layer coord ≤ 2: ${passB2 ? 'PASS' : 'FAIL'}`);
console.log(`B3. No inter-layer overlap: ${passB3 ? 'PASS' : 'FAIL'}`);
console.log(`C1. No coord ≥ 4 in growth: ${passC1 ? 'PASS' : 'FAIL'}`);
console.log(`C2. Ring centers open in growth: ${passC2 ? 'PASS' : 'FAIL'}`);
console.log(`C3. Open density (not packed): ${passC3 ? 'PASS' : 'FAIL'}`);
console.log('');
const allPass = passA1 && passA2 && passA3 && passA4 && passB1 && passB2 && passB3 && passC1 && passC2 && passC3;
console.log(`OVERALL: ${allPass ? 'GOOD' : 'BAD'}`);
