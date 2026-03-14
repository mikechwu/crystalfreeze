/**
 * One-off audit: verify coordination numbers in current lattice.
 * A true honeycomb has coordination 3 for ALL interior atoms.
 */
import { CONFIG } from '../src/config';
import { LatticeSystem } from '../src/simulation/LatticeSystem';

const lattice = new LatticeSystem();
const a = CONFIG.freeze.latticeSpacing;
const seedX = CONFIG.world.width / 2;
const seedY = CONFIG.world.height / 2;

// Generate a large single-layer patch
const sites: {x:number,y:number,z:number}[] = [];
for (let gx = -8; gx <= 8; gx++) {
  for (let gy = -8; gy <= 8; gy++) {
    const px = seedX + gx * a * 0.5 + gy * a * 0.25;
    const py = seedY + gy * a * 0.43;
    const site = lattice.nearestSite(px, py, 0, seedX, seedY, 0);
    if (Math.abs(site.z) < 1) {
      const isDup = sites.some(s => Math.abs(s.x-site.x)<0.5 && Math.abs(s.y-site.y)<0.5);
      if (!isDup) sites.push(site);
    }
  }
}

console.log(`Generated ${sites.length} unique sites in single layer`);

// Check coordination (NN within 15% of target spacing)
const coords: number[] = [];
for (let i = 0; i < sites.length; i++) {
  let nn = 0;
  for (let j = 0; j < sites.length; j++) {
    if (i === j) continue;
    const d = Math.sqrt((sites[j].x-sites[i].x)**2 + (sites[j].y-sites[i].y)**2);
    if (d > a*0.5 && d < a*1.15) nn++;
  }
  coords.push(nn);
}

const dist = new Map<number,number>();
for (const c of coords) dist.set(c, (dist.get(c)||0)+1);
console.log('\nCoordination distribution:');
for (const [c,n] of [...dist.entries()].sort()) console.log(`  coord=${c}: ${n} sites`);

// Interior sites (coord >= 2) — what fraction have coord=4?
const interior = coords.filter(c => c >= 2);
const coord4 = interior.filter(c => c === 4).length;
const coord3 = interior.filter(c => c === 3).length;
console.log(`\nInterior sites: ${interior.length}`);
console.log(`  coord=3: ${coord3} (${(coord3/interior.length*100).toFixed(0)}%)`);
console.log(`  coord=4: ${coord4} (${(coord4/interior.length*100).toFixed(0)}%)`);
console.log(`\nTrue honeycomb requires ALL interior coord=3`);
console.log(`Current lattice has coord=4 sites: ${coord4 > 0 ? 'YES — NOT a true honeycomb' : 'NO — true honeycomb'}`);

// NN distance statistics
const nnDists: number[] = [];
for (let i = 0; i < sites.length; i++) {
  for (let j = i+1; j < sites.length; j++) {
    const d = Math.sqrt((sites[j].x-sites[i].x)**2 + (sites[j].y-sites[i].y)**2);
    if (d > a*0.5 && d < a*1.15) nnDists.push(d);
  }
}
if (nnDists.length > 0) {
  console.log(`\nNN distances: min=${Math.min(...nnDists).toFixed(1)}, max=${Math.max(...nnDists).toFixed(1)}, count=${nnDists.length}`);
}

// Check second-nearest neighbor distances
const nnnDists: number[] = [];
for (let i = 0; i < sites.length; i++) {
  for (let j = i+1; j < sites.length; j++) {
    const d = Math.sqrt((sites[j].x-sites[i].x)**2 + (sites[j].y-sites[i].y)**2);
    if (d > a*1.15 && d < a*2.0) nnnDists.push(d);
  }
}
if (nnnDists.length > 0) {
  console.log(`NNN distances: min=${Math.min(...nnnDists).toFixed(1)}, max=${Math.max(...nnnDists).toFixed(1)}, count=${nnnDists.length}`);
  console.log(`\nFor true honeycomb: NNN should be at ${(a*Math.sqrt(3)).toFixed(1)} px (= a×√3)`);
}
