// Nucleation seed management
// Tracks placed seeds and handles initial particle freezing around seed site.

import { CONFIG } from '../config';
import {
  FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_ALPHA,
  OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y,
} from '../particles/ParticleSystem';
import { LatticeSystem } from './LatticeSystem';

export interface Seed {
  id: number;
  x: number;
  y: number;
  theta: number;  // lattice orientation
}

export class SeedRegistry {
  private seeds: Seed[] = [];
  private nextId = 0;
  private lattice: LatticeSystem;
  private lastSeedTime = 0;

  constructor(lattice: LatticeSystem) {
    this.lattice = lattice;
  }

  getSeeds(): readonly Seed[] {
    return this.seeds;
  }

  canPlace(): boolean {
    const now = performance.now();
    if (this.seeds.length >= CONFIG.ui.maxSeeds) return false;
    if (now - this.lastSeedTime < CONFIG.ui.seedCooldown) return false;
    return true;
  }

  /**
   * Place a nucleation seed at world coordinates (wx, wy).
   * Immediately freezes nearby particles within seedRadius.
   */
  placeSeed(
    wx: number, wy: number,
    data: Float32Array, count: number
  ): Seed | null {
    if (!this.canPlace()) return null;

    const seed: Seed = {
      id: this.nextId++,
      x: wx,
      y: wy,
      theta: Math.random() * Math.PI / 3, // random orientation within 60° (hex symmetry)
    };
    this.seeds.push(seed);
    this.lastSeedTime = performance.now();

    // Freeze particles within seed radius
    const { seedRadius, seedAlphaMin } = CONFIG.freeze;
    const seedRadius2 = seedRadius * seedRadius;
    const W = CONFIG.world.width;
    const H = CONFIG.world.height;
    const halfW = W * 0.5;
    const halfH = H * 0.5;

    for (let i = 0; i < count; i++) {
      const base = i * FLOATS_PER_PARTICLE;
      if (data[base + OFF_ALPHA] > 0.5) continue; // already frozen

      let dx = data[base + OFF_PX] - wx;
      let dy = data[base + OFF_PY] - wy;
      if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
      if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
      const dist2 = dx * dx + dy * dy;

      if (dist2 < seedRadius2) {
        const dist = Math.sqrt(dist2);
        const t = 1.0 - dist / seedRadius; // 1 at center, 0 at edge
        const alpha = seedAlphaMin + t * (1.0 - seedAlphaMin);

        // Assign lattice site
        const site = this.lattice.nearestSite(
          data[base + OFF_PX], data[base + OFF_PY],
          seed.x, seed.y, seed.theta
        );

        data[base + OFF_ALPHA] = Math.max(data[base + OFF_ALPHA], alpha);
        data[base + OFF_SEED_ID] = seed.id;
        data[base + OFF_EQ_X] = site.x;
        data[base + OFF_EQ_Y] = site.y;
      }
    }

    return seed;
  }
}
