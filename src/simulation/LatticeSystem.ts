// Dynamic 3D lattice generation — thin-slab ice-like lattice site computation
// Given a seed (position + orientation), computes nearest 3D lattice site for any point.
// Uses a HONEYCOMB sublattice (1/3 of triangular sites removed) for open hex rings.
// ABAB layer stacking: even layers use standard honeycomb, odd layers offset.
// The local number of Z layers varies between 3 and 5 over XY regions
// using a deterministic smooth function for natural variation.
//
// Key difference from HCP: 1/3 of hex grid sites are classified as "ring centers"
// and excluded. The remaining 2/3 form a honeycomb with coordination 3 per layer,
// producing open 6-member rings with no center occupancy — matching ice Ih basal plane.

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
   * Returns a value between (base - variation) and (base + variation), clamped to [3, 5].
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
   * Check if a hex grid site (row, col) is a "ring center" in the honeycomb sublattice.
   * Ring centers are the 1/3 of triangular lattice sites that must be removed
   * to create a honeycomb (open hex rings with no center occupancy).
   *
   * In the triangular lattice, removing sites where ((row % 3) + (col % 3)) % 3 == 0
   * leaves a honeycomb with coordination 3.
   */
  isRingCenter(row: number, col: number): boolean {
    // Normalize to positive modular arithmetic
    const r3 = ((row % 3) + 3) % 3;
    const c3 = ((col % 3) + 3) % 3;
    return (r3 + c3) % 3 === 0;
  }

  /**
   * Find nearest 3D ice-like lattice site for a particle at (px, py, pz) belonging to a seed.
   * O(1) computation — iterates over bounded Z layers (3–5) × bounded XY candidates.
   *
   * Uses a HONEYCOMB sublattice: 1/3 of triangular grid sites are "ring centers" and
   * excluded, leaving open 6-member rings with coordination 3 per layer.
   *
   * The hex lattice is defined by:
   * - seed position (sx, sy) as origin
   * - seed orientation theta as rotation angle
   * - CONFIG.freeze.latticeSpacing as the column spacing
   * - ABAB stacking: even layers use standard honeycomb, odd layers offset
   */
  nearestSite(
    px: number, py: number, pz: number,
    seedX: number, seedY: number, seedTheta: number
  ): LatticeSite {
    const spacing = CONFIG.freeze.latticeSpacing;
    const rowSpacing = spacing * 0.8660254; // sqrt(3)/2
    const zSpacing = CONFIG.freeze.zLayerSpacing;

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

    // ABAB offset for odd layers
    const bOffsetX = spacing * 0.5;
    const bOffsetY = rowSpacing / 3.0; // sqrt(3)/6 * spacing

    let bestDist2 = Infinity;
    let bestSx = 0;
    let bestSy = 0;
    let bestSz = 0;
    let bestLayer = 0;

    // Iterate over Z layers
    // Front-layer bias: layers closer to camera (negative Z) get a distance bonus.
    // This makes frozen molecules preferentially assigned to front-visible layers,
    // reducing visual clutter from farther layers while preserving 3D structure.
    const frontBias = zSpacing * 0.3; // bias strength: 30% of layer spacing

    for (let k = 0; k < layerCount; k++) {
      const zLayer = -halfDepth + k * zSpacing;
      const dz = pz - zLayer;
      const dz2 = dz * dz;

      // Front-layer bonus: reduce effective distance for front layers (lower Z)
      // zLayer ranges from -halfDepth (front) to +halfDepth (back)
      // bias = frontBias * (zLayer / halfDepth) adds distance penalty for back layers
      const zBias = halfDepth > 0 ? frontBias * (zLayer / halfDepth) : 0;
      const biasedDz2 = dz2 + zBias * Math.abs(zBias);

      // Early skip: if Z distance alone exceeds best 3D distance, skip
      if (biasedDz2 > bestDist2) continue;

      // Apply ABAB offset for odd layers
      const isOdd = k % 2 !== 0;
      const offsetX = isOdd ? bOffsetX : 0;
      const offsetY = isOdd ? bOffsetY : 0;
      const adjLx = lx - offsetX;
      const adjLy = ly - offsetY;

      // Find nearest hex site in this layer, rejecting ring centers
      const rowFloat = adjLy / rowSpacing;
      const row0 = Math.floor(rowFloat);

      // Wider search radius to find valid honeycomb sites when nearest is a ring center
      for (let dr = -1; dr <= 2; dr++) {
        const row = row0 + dr;
        const xOffset = (((row % 2) + 2) % 2) * spacing * 0.5;
        const col = Math.round((adjLx - xOffset) / spacing);

        for (let dc = -2; dc <= 2; dc++) {
          const c = col + dc;

          // Skip ring-center sites (honeycomb sublattice filter)
          if (this.isRingCenter(row, c)) continue;

          const sx = c * spacing + xOffset + offsetX;
          const sy = row * rowSpacing + offsetY;
          const ddx = sx - lx;
          const ddy = sy - ly;
          const dist2 = ddx * ddx + ddy * ddy + biasedDz2;
          if (dist2 < bestDist2) {
            bestDist2 = dist2;
            bestSx = sx;
            bestSy = sy;
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
