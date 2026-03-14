/**
 * Structural diagnostics for ice Ih lattice quality evaluation.
 *
 * Reports:
 * 1. Oxygen coordination number distribution
 * 2. O–O distance distribution (NN and NNN)
 * 3. Hydrogen bond count estimate (coordination-based)
 * 4. 6-member ring detection
 * 5. Density comparison: honeycomb vs triangular (ice vs liquid proxy)
 */

import { CONFIG } from '../src/config';
import { LatticeSystem, LatticeSite } from '../src/simulation/LatticeSystem';

const a = CONFIG.freeze.latticeSpacing;       // 28 px
const L = a * Math.sqrt(3);                   // ≈ 48.5 px
const Z_SPACING = CONFIG.freeze.zLayerSpacing;
const lattice = new LatticeSystem();

const seedX = CONFIG.world.width / 2;
const seedY = CONFIG.world.height / 2;

console.log('=== STRUCTURAL DIAGNOSTICS ===');
console.log(`latticeSpacing (a) = ${a} px`);
console.log(`Bravais param (L=a√3) = ${L.toFixed(1)} px`);
console.log(`Z layer spacing = ${Z_SPACING} px`);
console.log('');

// Generate a medium-sized single-layer patch for diagnostics
const sites: LatticeSite[] = [];
for (let gx = -12; gx <= 12; gx++) {
  for (let gy = -12; gy <= 12; gy++) {
    const px = seedX + gx * a * 0.45 + gy * a * 0.2;
    const py = seedY + gy * a * 0.40;
    const site = lattice.nearestSite(px, py, 0, seedX, seedY, 0);
    if (Math.abs(site.z) > 1) continue;
    const isDup = sites.some(s =>
      Math.abs(s.x - site.x) < 0.5 && Math.abs(s.y - site.y) < 0.5
    );
    if (!isDup) sites.push(site);
  }
}
console.log(`Generated ${sites.length} unique single-layer sites`);
console.log('');

// -------------------------------------------------------
// 1. Oxygen coordination number distribution
// -------------------------------------------------------
console.log('--- 1. Oxygen Coordination Numbers ---');
const coords: number[] = [];
for (let i = 0; i < sites.length; i++) {
  let nn = 0;
  for (let j = 0; j < sites.length; j++) {
    if (i === j) continue;
    const d = Math.sqrt((sites[j].x - sites[i].x) ** 2 + (sites[j].y - sites[i].y) ** 2);
    if (d > a * 0.5 && d < a * 1.15) nn++;
  }
  coords.push(nn);
}
const coordDist = new Map<number, number>();
for (const c of coords) coordDist.set(c, (coordDist.get(c) || 0) + 1);
for (const [c, n] of [...coordDist.entries()].sort()) {
  console.log(`  coord=${c}: ${n} sites (${(n / sites.length * 100).toFixed(0)}%)`);
}
const interior = coords.filter(c => c >= 2);
const avg = interior.reduce((s, c) => s + c, 0) / interior.length;
console.log(`Interior average coordination: ${avg.toFixed(2)}`);
console.log(`Sites with coord ≥ 4: ${coords.filter(c => c >= 4).length}`);
console.log('');

// -------------------------------------------------------
// 2. O–O distance distribution
// -------------------------------------------------------
console.log('--- 2. O–O Distance Distribution ---');
const allDists: number[] = [];
for (let i = 0; i < sites.length; i++) {
  for (let j = i + 1; j < sites.length; j++) {
    const d = Math.sqrt((sites[j].x - sites[i].x) ** 2 + (sites[j].y - sites[i].y) ** 2);
    if (d < a * 2.5) allDists.push(d);
  }
}
// Histogram in bins
const bins = [
  { label: `< ${(a * 0.7).toFixed(0)}px (sub-NN, should be 0)`, lo: 0, hi: a * 0.7, count: 0 },
  { label: `${(a * 0.85).toFixed(0)}–${(a * 1.15).toFixed(0)}px (NN = ${a}px)`, lo: a * 0.85, hi: a * 1.15, count: 0 },
  { label: `${(a * 1.5).toFixed(0)}–${(a * 2.1).toFixed(0)}px (NNN ≈ ${L.toFixed(0)}px)`, lo: a * 1.5, hi: a * 2.1, count: 0 },
];
for (const d of allDists) {
  for (const b of bins) {
    if (d >= b.lo && d < b.hi) { b.count++; break; }
  }
}
for (const b of bins) console.log(`  ${b.label}: ${b.count} pairs`);

const nnDists = allDists.filter(d => d > a * 0.85 && d < a * 1.15);
if (nnDists.length > 0) {
  const nnAvg = nnDists.reduce((s, d) => s + d, 0) / nnDists.length;
  const nnStd = Math.sqrt(nnDists.reduce((s, d) => s + (d - nnAvg) ** 2, 0) / nnDists.length);
  console.log(`NN distance: mean=${nnAvg.toFixed(1)}px, std=${nnStd.toFixed(2)}px, count=${nnDists.length}`);
}
console.log('');

// -------------------------------------------------------
// 3. Hydrogen bond count estimate
// -------------------------------------------------------
console.log('--- 3. Hydrogen Bond Count (proxy) ---');
// In ice Ih, each O has 4 H-bonds (2 donor + 2 acceptor).
// In basal plane: 3 in-plane bonds. With ABAB: +1 inter-layer = 4 total.
// Here we report in-plane coordination as H-bond proxy.
const totalBonds = coords.reduce((s, c) => s + c, 0) / 2; // each bond counted twice
console.log(`Total in-plane bonds: ${totalBonds}`);
console.log(`Bonds per molecule (in-plane): ${(totalBonds * 2 / sites.length).toFixed(2)}`);
console.log(`Expected for honeycomb (interior): 3.0`);
console.log(`With inter-layer (ice Ih total): up to 4.0`);
console.log('');

// -------------------------------------------------------
// 4. Six-member ring detection
// -------------------------------------------------------
console.log('--- 4. Six-Member Ring Detection ---');
// Build adjacency list
const adj: number[][] = sites.map(() => []);
for (let i = 0; i < sites.length; i++) {
  for (let j = i + 1; j < sites.length; j++) {
    const d = Math.sqrt((sites[j].x - sites[i].x) ** 2 + (sites[j].y - sites[i].y) ** 2);
    if (d > a * 0.5 && d < a * 1.15) {
      adj[i].push(j);
      adj[j].push(i);
    }
  }
}

// Find 6-member rings by DFS (enumerate cycles of length 6)
// Use canonical ordering to avoid duplicates
let ringCount = 0;
const ringExamples: number[][] = [];

for (let start = 0; start < sites.length; start++) {
  // DFS to find 6-cycles starting from `start`
  const stack: { node: number; path: number[]; depth: number }[] = [];
  for (const n of adj[start]) {
    if (n > start) stack.push({ node: n, path: [start, n], depth: 1 });
  }
  while (stack.length > 0) {
    const { node, path, depth } = stack.pop()!;
    if (depth === 5) {
      // Check if we can close back to start
      if (adj[node].includes(start)) {
        ringCount++;
        if (ringExamples.length < 3) ringExamples.push([...path]);
      }
      continue;
    }
    for (const next of adj[node]) {
      if (next <= start) continue; // canonical ordering
      if (path.includes(next)) continue; // no revisit
      stack.push({ node: next, path: [...path, next], depth: depth + 1 });
    }
  }
}

// Each 6-ring is found 2× (CW and CCW traversal from same start), divide by 2
// Actually with canonical start, each ring is found starting from its minimum index
// and traversed in 2 directions. So divide by 2.
const uniqueRings = Math.floor(ringCount / 2);
console.log(`6-member rings detected: ${uniqueRings}`);
if (ringExamples.length > 0) {
  console.log(`Example ring sites (first ${ringExamples.length}):`);
  for (const ring of ringExamples) {
    const coords6 = ring.map(i => `(${sites[i].x.toFixed(0)},${sites[i].y.toFixed(0)})`);
    console.log(`  ${coords6.join(' → ')}`);
  }
}

// Verify ring centers are open
let occupiedCenters = 0;
for (let r = 0; r < Math.min(ringCount, ringExamples.length); r++) {
  const ring = ringExamples[r];
  const cx = ring.reduce((s, i) => s + sites[i].x, 0) / ring.length;
  const cy = ring.reduce((s, i) => s + sites[i].y, 0) / ring.length;
  for (const s of sites) {
    const d = Math.sqrt((s.x - cx) ** 2 + (s.y - cy) ** 2);
    if (d < a * 0.5) { occupiedCenters++; break; }
  }
}
console.log(`Ring centers occupied: ${occupiedCenters}/${ringExamples.length} checked`);
console.log('');

// -------------------------------------------------------
// 5. Density comparison
// -------------------------------------------------------
console.log('--- 5. Density Comparison ---');
// Honeycomb (ice) unit cell: 2 atoms per cell of area L × 3a/2
const honeycombCellArea = L * (1.5 * a);
const honeycombDensity = 2 / honeycombCellArea;
// Triangular (liquid proxy) unit cell: 1 atom per cell of area √3/2 × σ²
const sigmaOO = CONFIG.state.sigmaOO;
const triCellArea = Math.sqrt(3) / 2 * sigmaOO * sigmaOO;
const triDensity = 1 / triCellArea;
// Liquid: from packing fraction
const liquidAreaPerMol = Math.PI * (sigmaOO / 2) ** 2 / CONFIG.state.targetPackingFraction;
const liquidDensity = 1 / liquidAreaPerMol;

console.log(`Honeycomb (ice) density: ${(honeycombDensity * 1e4).toFixed(2)} × 10⁻⁴ per px²`);
console.log(`Triangular close-packed density: ${(triDensity * 1e4).toFixed(2)} × 10⁻⁴ per px²`);
console.log(`Liquid density (from packing): ${(liquidDensity * 1e4).toFixed(2)} × 10⁻⁴ per px²`);
console.log(`Ice/liquid density ratio: ${(honeycombDensity / liquidDensity).toFixed(3)}`);
const iceIsLessDense = honeycombDensity < liquidDensity;
console.log(`Ice less dense than liquid: ${iceIsLessDense ? 'YES' : 'NO'} (real ice: YES)`);
console.log('');

// -------------------------------------------------------
// SUMMARY
// -------------------------------------------------------
console.log('=== DIAGNOSTIC SUMMARY ===');
console.log(`Coordination: all interior ≤ 3 (honeycomb) = ${coords.filter(c => c >= 4).length === 0 ? 'YES' : 'NO'}`);
console.log(`NN distance uniform at ${a}px = ${nnDists.length > 0 && Math.max(...nnDists) - Math.min(...nnDists) < 1 ? 'YES' : 'NO'}`);
console.log(`Sub-NN contacts (< ${(a * 0.7).toFixed(0)}px) = ${bins[0].count} (should be 0)`);
console.log(`6-member rings found = ${uniqueRings}`);
console.log(`Ring centers open = ${occupiedCenters === 0 ? 'YES' : 'NO'}`);
console.log(`Ice less dense than liquid = ${iceIsLessDense ? 'YES' : 'NO'}`);
