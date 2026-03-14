// Dynamic 3D lattice generation — thin-slab ice Ih lattice site computation.
// Given a seed (position + orientation), computes nearest 3D lattice site for any point.
//
// Uses a PROPER HONEYCOMB lattice with two explicit sublattices (A and B).
// This is the correct oxygen sublattice of ice Ih (basal plane):
//   - Coordination 3 for ALL atoms (not 4 as in the old depleted-triangular approach)
//   - Open 6-member rings with diameter 2×spacing (56px at spacing=28)
//   - Each ring has 6 atoms (3 type-A, 3 type-B) — no center occupancy
//
// Lattice geometry:
//   NN distance (A↔B) = a = CONFIG.freeze.latticeSpacing
//   Bravais lattice parameter = L = a × √3
//   Bravais vectors: a1 = (L, 0), a2 = (L/2, 3a/2)
//   Sublattice offset: d_B = (0, a) relative to sublattice A
//
// ABAB layer stacking: even layers use standard honeycomb, odd layers offset
// by (L/3, 0) to interleave with even layers — matching ice Ih wurtzite-like stacking.
// The local number of Z layers varies between 2 and 4 over XY regions.

import { CONFIG } from '../config';

export interface LatticeSite {
  x: number;
  y: number;
  z: number;
  /** Orientation angle the molecule should align to in solid state */
  orientTarget: number;
  /** Which Z layer index this site belongs to (0 = bottom) */
  layerIndex: number;
}

export class LatticeSystem {
  private worldWidth: number;
  private worldHeight: number;
  private halfW: number;
  private halfH: number;

  constructor() {
    this.worldWidth = CONFIG.world.width;
    this.worldHeight = CONFIG.world.height;
    this.halfW = this.worldWidth * 0.5;
    this.halfH = this.worldHeight * 0.5;
  }

  /**
   * Compute how many Z layers exist at a given XY position in seed-local coords.
   * Returns a value between (base - variation) and (base + variation), clamped to [2, 4].
   * Uses a smooth sin-based hash of seed-local position for deterministic, flicker-free variation.
   */
  localLayerCount(localX: number, localY: number): number {
    const base = CONFIG.freeze.zLayerCount as number;
    const variation = CONFIG.freeze.zLayerVariation as number;
    if (variation === 0) return base;

    // Smooth spatial variation at ~150px scale (about 5× lattice spacing)
    const scale = 1.0 / 150.0;
    const hash = Math.sin(localX * scale * 3.17 + 1.23) *
                 Math.sin(localY * scale * 2.71 + 4.56);
    // hash is in [-1, 1]; round to integer variation
    const delta = Math.round(hash * variation);
    return Math.max(2, Math.min(4, base + delta));
  }

  /**
   * Get the Z positions of all layers at a given local XY position.
   * Layers are centered around z=0.
   */
  getLayerZPositions(localX: number, localY: number): number[] {
    const layerCount = this.localLayerCount(localX, localY);
    const spacing = CONFIG.freeze.zLayerSpacing;
    const positions: number[] = [];
    const halfDepth = (layerCount - 1) * spacing * 0.5;
    for (let k = 0; k < layerCount; k++) {
      positions.push(-halfDepth + k * spacing);
    }
    return positions;
  }

  /**
   * Compute the effective slab half-depth (for Z boundary confinement).
   * Based on maximum possible layer count + margin.
   */
  getSlabHalf(): number {
    const maxLayers = Math.min(4, CONFIG.freeze.zLayerCount + CONFIG.freeze.zLayerVariation);
    const halfDepth = (maxLayers - 1) * CONFIG.freeze.zLayerSpacing * 0.5;
    return halfDepth + CONFIG.freeze.zSlabMargin;
  }

  /**
   * Legacy ring-center check (kept for backward compatibility with older tests).
   * The new honeycomb lattice does NOT use this — it uses explicit two-sublattice construction.
   */
  isRingCenter(row: number, col: number): boolean {
    const r3 = ((row % 3) + 3) % 3;
    const c3 = ((col % 3) + 3) % 3;
    return (r3 + c3) % 3 === 0;
  }

  /**
   * Find nearest 3D ice Ih lattice site for a particle at (px, py, pz) belonging to a seed.
   * O(1) computation — iterates over bounded Z layers (2–4) × bounded XY candidates.
   *
   * Uses a PROPER HONEYCOMB with two sublattices:
   *   Sublattice A at Bravais lattice points
   *   Sublattice B at Bravais lattice points + (0, a)
   *
   * This gives exact coordination 3 for all atoms and open 6-member rings
   * with diameter 2a = 56px — the correct ice Ih basal plane topology.
   *
   * ABAB stacking: odd layers offset by (L/3, 0) to interleave with even layers.
   */
  nearestSite(
    px: number, py: number, pz: number,
    seedX: number, seedY: number, seedTheta: number
  ): LatticeSite {
    const a = CONFIG.freeze.latticeSpacing;       // NN distance (A↔B) = 28px
    const L = a * 1.7320508075688772;             // lattice param = a√3 ≈ 48.50px
    const zSpacing = CONFIG.freeze.zLayerSpacing;

    // Bravais lattice vectors
    const a1x = L;
    const a1y = 0;
    const a2x = L * 0.5;
    const a2y = a * 1.5; // = 3a/2 = 42.0px

    // Sublattice B offset from A within each unit cell
    const dBx = 0;
    const dBy = a; // = 28px

    // ABAB offset for odd layers: L/3 along x
    // This interleaves layers without overlapping any even-layer positions.
    // L/3 ≈ 16.17px — same magnitude as old offset, but geometrically motivated.
    const ababX = L / 3;
    const ababY = 0;

    // Vector from seed to particle (minimum image)
    let dx = px - seedX;
    let dy = py - seedY;
    if (dx > this.halfW) dx -= this.worldWidth;
    else if (dx < -this.halfW) dx += this.worldWidth;
    if (dy > this.halfH) dy -= this.worldHeight;
    else if (dy < -this.halfH) dy += this.worldHeight;

    // Rotate to lattice-local coordinates
    const cosNeg = Math.cos(-seedTheta);
    const sinNeg = Math.sin(-seedTheta);
    const lx = dx * cosNeg - dy * sinNeg;
    const ly = dx * sinNeg + dy * cosNeg;

    // Determine local layer count at this XY position
    const layerCount = this.localLayerCount(lx, ly);
    const halfDepth = (layerCount - 1) * zSpacing * 0.5;

    // Front-layer bias: layers closer to camera (negative Z) get a distance bonus
    const frontBias = zSpacing * 0.3;

    // Inverse Bravais matrix determinant: det([a1x a2x; a1y a2y]) = a1x*a2y - a1y*a2x
    const det = a1x * a2y; // since a1y = 0

    let bestDist2 = Infinity;
    let bestSx = 0;
    let bestSy = 0;
    let bestSz = 0;
    let bestLayer = 0;

    for (let k = 0; k < layerCount; k++) {
      const zLayer = -halfDepth + k * zSpacing;
      const dz = pz - zLayer;
      const dz2 = dz * dz;

      // Front-layer bias
      const zBias = halfDepth > 0 ? frontBias * (zLayer / halfDepth) : 0;
      const biasedDz2 = dz2 + zBias * Math.abs(zBias);
      if (biasedDz2 > bestDist2) continue;

      // Apply ABAB offset for odd layers
      const isOdd = k % 2 !== 0;
      const offX = isOdd ? ababX : 0;
      const offY = isOdd ? ababY : 0;
      const adjLx = lx - offX;
      const adjLy = ly - offY;

      // Find nearest unit cell via inverse Bravais transform
      // [n] = [a2y  -a2x] [adjLx] / det
      // [m]   [-a1y  a1x] [adjLy]
      const nf = (a2y * adjLx - a2x * adjLy) / det;
      const mf = a1x * adjLy / det; // simplified since a1y = 0

      const n0 = Math.floor(nf);
      const m0 = Math.floor(mf);

      // Search 3×3 neighborhood of unit cells
      for (let dn = -1; dn <= 1; dn++) {
        for (let dm = -1; dm <= 1; dm++) {
          const n = n0 + dn;
          const m = m0 + dm;

          // Cell origin (Bravais lattice point)
          const cx = n * a1x + m * a2x;
          const cy = n * a1y + m * a2y;

          // Check sublattice A
          const sax = cx + offX;
          const say = cy + offY;
          const dax = sax - lx;
          const day = say - ly;
          const distA2 = dax * dax + day * day + biasedDz2;
          if (distA2 < bestDist2) {
            bestDist2 = distA2;
            bestSx = sax;
            bestSy = say;
            bestSz = zLayer;
            bestLayer = k;
          }

          // Check sublattice B
          const sbx = cx + dBx + offX;
          const sby = cy + dBy + offY;
          const dbx = sbx - lx;
          const dby = sby - ly;
          const distB2 = dbx * dbx + dby * dby + biasedDz2;
          if (distB2 < bestDist2) {
            bestDist2 = distB2;
            bestSx = sbx;
            bestSy = sby;
            bestSz = zLayer;
            bestLayer = k;
          }
        }
      }
    }

    // Rotate back to world coordinates
    const cosPos = Math.cos(seedTheta);
    const sinPos = Math.sin(seedTheta);
    const wx = bestSx * cosPos - bestSy * sinPos + seedX;
    const wy = bestSx * sinPos + bestSy * cosPos + seedY;

    // Wrap periodically (XY only — Z is confined, not periodic)
    return {
      x: ((wx % this.worldWidth) + this.worldWidth) % this.worldWidth,
      y: ((wy % this.worldHeight) + this.worldHeight) % this.worldHeight,
      z: bestSz,
      orientTarget: seedTheta,
      layerIndex: bestLayer,
    };
  }
}
