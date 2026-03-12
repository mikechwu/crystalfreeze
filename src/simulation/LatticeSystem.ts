// Dynamic lattice generation — analytical hex lattice site computation
// Given a seed (position + orientation), computes nearest hex lattice site for any point.

import { CONFIG } from '../config';

export interface LatticeSite {
  x: number;
  y: number;
  /** Orientation angle the molecule should align to in solid state */
  orientTarget: number;
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
   * Find nearest hex lattice site for a particle at (px, py) belonging to a seed.
   * O(1) computation — no stored site list needed.
   *
   * The hex lattice is defined by:
   * - seed position (sx, sy) as origin
   * - seed orientation theta as rotation angle
   * - CONFIG.freeze.latticeSpacing as the column spacing
   */
  nearestSite(
    px: number, py: number,
    seedX: number, seedY: number, seedTheta: number
  ): LatticeSite {
    const spacing = CONFIG.freeze.latticeSpacing;
    const rowSpacing = spacing * 0.8660254; // sqrt(3)/2

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

    // Find nearest hex site in local coords
    // Try both possible rows (rounding can be ambiguous for hex)
    const rowFloat = ly / rowSpacing;
    const row0 = Math.floor(rowFloat);
    const row1 = row0 + 1;

    let bestDist = Infinity;
    let bestSx = 0;
    let bestSy = 0;

    for (const row of [row0, row1]) {
      const xOffset = (((row % 2) + 2) % 2) * spacing * 0.5; // handle negative rows
      const col = Math.round((lx - xOffset) / spacing);

      // Check col and col±1 for closest
      for (let dc = -1; dc <= 1; dc++) {
        const c = col + dc;
        const sx = c * spacing + xOffset;
        const sy = row * rowSpacing;
        const ddx = sx - lx;
        const ddy = sy - ly;
        const dist = ddx * ddx + ddy * ddy;
        if (dist < bestDist) {
          bestDist = dist;
          bestSx = sx;
          bestSy = sy;
        }
      }
    }

    // Rotate back to world coordinates
    const cosPos = Math.cos(seedTheta);
    const sinPos = Math.sin(seedTheta);
    const wx = bestSx * cosPos - bestSy * sinPos + seedX;
    const wy = bestSx * sinPos + bestSy * cosPos + seedY;

    // Wrap periodically
    return {
      x: ((wx % this.worldWidth) + this.worldWidth) % this.worldWidth,
      y: ((wy % this.worldHeight) + this.worldHeight) % this.worldHeight,
      orientTarget: seedTheta, // all molecules in a seed align to seed orientation
    };
  }
}
