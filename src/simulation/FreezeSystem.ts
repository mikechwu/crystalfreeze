// Freezing front propagation — per-frame alpha spreading via local neighbor rules.
// Each frame, liquid particles near frozen neighbors get their alpha increased.
// Once alpha crosses a threshold, the particle is assigned a lattice site.

import { CONFIG } from '../config';
import {
  FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_ALPHA,
  OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y,
} from '../particles/ParticleSystem';
import { SpatialHash } from '../utils/SpatialHash';
import { LatticeSystem } from './LatticeSystem';
import { SeedRegistry } from './SeedRegistry';

export class FreezeSystem {
  private lattice: LatticeSystem;
  private registry: SeedRegistry;
  private worldWidth: number;
  private worldHeight: number;

  // Reusable spatial hash for frozen particle lookup
  private frozenHash: SpatialHash;

  // Mutable temperature: 0.0 = cold (freezing), 1.0 = warm (melting)
  private _temperature: number;

  // Mutable propagation rate (advanced user control)
  private _propagationRate: number;

  constructor() {
    this.lattice = new LatticeSystem();
    this.registry = new SeedRegistry(this.lattice);
    this.worldWidth = CONFIG.world.width;
    this.worldHeight = CONFIG.world.height;
    this.frozenHash = new SpatialHash(CONFIG.freeze.propagationRadius);
    this._temperature = CONFIG.temperature.initial;
    this._propagationRate = CONFIG.freeze.propagationRate;
  }

  get temperature(): number { return this._temperature; }
  set temperature(t: number) { this._temperature = Math.max(0, Math.min(1, t)); }

  get propagationRate(): number { return this._propagationRate; }
  set propagationRate(r: number) { this._propagationRate = Math.max(0.002, Math.min(0.04, r)); }

  getSeedRegistry(): SeedRegistry {
    return this.registry;
  }

  /**
   * Place a nucleation seed at world coordinates.
   */
  placeSeed(wx: number, wy: number, data: Float32Array, count: number): boolean {
    const seed = this.registry.placeSeed(wx, wy, data, count);
    return seed !== null;
  }

  /**
   * Per-frame freezing front propagation + temperature-dependent melting.
   * Temperature controls the balance:
   *   - Below freezeThreshold: freezing proceeds, no melting
   *   - Between thresholds: freezing slows, boundary molecules may melt
   *   - Above meltThreshold: net melting — ice gradually returns to water
   */
  update(data: Float32Array, count: number): void {
    const seeds = this.registry.getSeeds();
    const hasSeeds = seeds.length > 0;

    const { propagationRadius } = CONFIG.freeze;
    const propagationRate = this._propagationRate;
    const { freezeThreshold, meltThreshold, meltRate, freezeBias } = CONFIG.temperature;
    const temp = this._temperature;
    const W = this.worldWidth;
    const H = this.worldHeight;
    const halfW = W * 0.5;
    const halfH = H * 0.5;
    const alphaThreshold = 0.15;

    // Temperature-dependent freezing rate: scales down as temperature rises
    // At temp=0: full rate. At freezeThreshold: rate=0. Above: no freezing.
    const freezeScale = temp < freezeThreshold
      ? freezeBias * (1.0 - temp / freezeThreshold)
      : 0.0;

    // Temperature-dependent melting: above meltThreshold, alpha decays
    const meltActive = temp > meltThreshold;
    const meltStrength = meltActive
      ? meltRate * ((temp - meltThreshold) / (1.0 - meltThreshold))
      : 0.0;

    // Rebuild frozen hash
    this.frozenHash.clear();
    let hasFrozen = false;
    for (let i = 0; i < count; i++) {
      const base = i * FLOATS_PER_PARTICLE;
      if (data[base + OFF_ALPHA] > alphaThreshold) {
        this.frozenHash.insert(data[base + OFF_PX], data[base + OFF_PY], i);
        hasFrozen = true;
      }
    }

    // Melting pass: reduce alpha for frozen particles when temperature is high
    if (meltActive && hasFrozen) {
      for (let i = 0; i < count; i++) {
        const base = i * FLOATS_PER_PARTICLE;
        const alpha = data[base + OFF_ALPHA];
        if (alpha <= 0) continue;

        // Boundary molecules (lower alpha) melt first — more physically realistic
        // Molecules deep in the bulk (alpha≈1) resist melting longer
        const meltEase = 1.0 - alpha * 0.5; // α=0.3 melts faster than α=1.0
        const deltaAlpha = meltStrength * meltEase;
        const newAlpha = Math.max(0, alpha - deltaAlpha);
        data[base + OFF_ALPHA] = newAlpha;

        // If fully melted, reset to liquid state
        if (newAlpha <= 0.01) {
          data[base + OFF_ALPHA] = 0;
          data[base + OFF_SEED_ID] = -1;
          data[base + OFF_EQ_X] = 0;
          data[base + OFF_EQ_Y] = 0;
        }
      }
    }

    if (!hasSeeds || !hasFrozen) return;
    if (freezeScale <= 0) return; // too warm for freezing

    // Propagate freezing front (temperature-modulated)
    for (let i = 0; i < count; i++) {
      const base = i * FLOATS_PER_PARTICLE;
      const alpha = data[base + OFF_ALPHA];
      if (alpha >= 1.0) continue;

      const px = data[base + OFF_PX];
      const py = data[base + OFF_PY];

      const neighbors = this.frozenHash.query(px, py, propagationRadius);

      let frozenInfluence = 0;
      let closestSeedId = -1;
      let closestDist = Infinity;

      for (let ni = 0; ni < neighbors.length; ni++) {
        const j = neighbors[ni];
        if (j === i) continue;
        const bj = j * FLOATS_PER_PARTICLE;
        const aj = data[bj + OFF_ALPHA];
        if (aj < alphaThreshold) continue;

        let dx = data[bj + OFF_PX] - px;
        let dy = data[bj + OFF_PY] - py;
        if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
        if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < propagationRadius) {
          const weight = aj * (1.0 - dist / propagationRadius);
          frozenInfluence += weight;

          if (dist < closestDist) {
            closestDist = dist;
            closestSeedId = data[bj + OFF_SEED_ID];
          }
        }
      }

      if (frozenInfluence > 0) {
        // Temperature-modulated freezing rate
        const deltaAlpha = frozenInfluence * propagationRate * freezeScale;
        const newAlpha = Math.min(1.0, alpha + deltaAlpha);
        data[base + OFF_ALPHA] = newAlpha;

        // Delay lattice site assignment until alpha exceeds threshold.
        // This gives molecules near the phase boundary time to find
        // better positions via thermal motion before locking to a site.
        const assignThreshold = CONFIG.freeze.latticeAssignThreshold;
        if (data[base + OFF_SEED_ID] < 0 && closestSeedId >= 0 && newAlpha >= assignThreshold) {
          data[base + OFF_SEED_ID] = closestSeedId;

          const seed = seeds.find(s => s.id === closestSeedId);
          if (seed) {
            const site = this.lattice.nearestSite(px, py, seed.x, seed.y, seed.theta);
            data[base + OFF_EQ_X] = site.x;
            data[base + OFF_EQ_Y] = site.y;
          }
        }
      }
    }
  }
}
