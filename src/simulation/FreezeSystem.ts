// Freezing front propagation — per-frame alpha spreading via local neighbor rules.
// Each frame, liquid particles near frozen neighbors get their alpha increased.
// Once alpha crosses a threshold, the particle is assigned a 3D lattice site.
// Propagation uses true 3D distances (XY periodic, Z confined).

import { CONFIG } from '../config';
import {
  FLOATS_PER_PARTICLE, OFF_PX, OFF_PY, OFF_ALPHA,
  OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y, OFF_Z,
} from '../particles/ParticleSystem';
import { SpatialHash } from '../utils/SpatialHash';
import { LatticeSystem } from './LatticeSystem';
import { SeedRegistry } from './SeedRegistry';

export class FreezeSystem {
  private lattice: LatticeSystem;
  private registry: SeedRegistry;
  private worldWidth: number;
  private worldHeight: number;

  // Reusable spatial hash for frozen particle lookup (2D XY; Z checked inline)
  private frozenHash: SpatialHash;

  // Track occupied lattice sites (prevent duplicate assignments)
  // Key encodes rounded (x, y, z) to prevent collisions
  private occupiedSites: Set<number> = new Set();

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
  set propagationRate(r: number) { this._propagationRate = Math.max(0.0002, Math.min(0.02, r)); }

  getLattice(): LatticeSystem { return this.lattice; }

  getSeedRegistry(): SeedRegistry {
    return this.registry;
  }

  /**
   * Place a nucleation seed at world coordinates.
   */
  placeSeed(wx: number, wy: number, data: Float32Array, count: number, eqZ: Float32Array): boolean {
    const seed = this.registry.placeSeed(wx, wy, data, count, eqZ);
    return seed !== null;
  }

  /**
   * Compute a unique numeric key for a 3D lattice site (rounded to 1px precision).
   * Encodes (x, y, z) into a single number for Set<number> lookups.
   */
  private siteKey3D(x: number, y: number, z: number): number {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z + 200); // shift z to positive range
    return rx * 1000000 + ry * 1000 + rz;
  }

  /**
   * Per-frame freezing front propagation + temperature-dependent melting.
   * Now uses true 3D distances for propagation and neighbor validation.
   * Temperature controls the balance:
   *   - Below freezeThreshold: freezing proceeds, no melting
   *   - Between thresholds: freezing slows, boundary molecules may melt
   *   - Above meltThreshold: net melting — ice gradually returns to water
   */
  update(data: Float32Array, count: number, eqZ: Float32Array): void {
    const seeds = this.registry.getSeeds();
    const hasSeeds = seeds.length > 0;

    const { propagationRadius, hexBias } = CONFIG.freeze;
    const propagationRate = this._propagationRate;
    const { freezeThreshold, meltThreshold, meltRate, freezeBias } = CONFIG.temperature;
    const temp = this._temperature;
    const W = this.worldWidth;
    const H = this.worldHeight;
    const halfW = W * 0.5;
    const halfH = H * 0.5;
    // Only well-established frozen molecules can propagate freezing.
    const alphaThreshold = 0.35;

    // Temperature-dependent freezing rate
    const freezeScale = temp < freezeThreshold
      ? freezeBias * (1.0 - temp / freezeThreshold)
      : 0.0;

    // Temperature-dependent melting
    const meltActive = temp > meltThreshold;
    const meltStrength = meltActive
      ? meltRate * ((temp - meltThreshold) / (1.0 - meltThreshold))
      : 0.0;

    // Rebuild frozen hash (2D XY)
    this.frozenHash.clear();
    let hasFrozen = false;
    for (let i = 0; i < count; i++) {
      const base = i * FLOATS_PER_PARTICLE;
      if (data[base + OFF_ALPHA] > alphaThreshold) {
        this.frozenHash.insert(data[base + OFF_PX], data[base + OFF_PY], i);
        hasFrozen = true;
      }
    }

    // Melting pass
    if (meltActive && hasFrozen) {
      for (let i = 0; i < count; i++) {
        const base = i * FLOATS_PER_PARTICLE;
        const alpha = data[base + OFF_ALPHA];
        if (alpha <= 0) continue;

        const meltEase = 1.0 - alpha * 0.5;
        const deltaAlpha = meltStrength * meltEase;
        const newAlpha = Math.max(0, alpha - deltaAlpha);
        data[base + OFF_ALPHA] = newAlpha;

        if (newAlpha <= 0.01) {
          data[base + OFF_ALPHA] = 0;
          data[base + OFF_SEED_ID] = -1;
          data[base + OFF_EQ_X] = 0;
          data[base + OFF_EQ_Y] = 0;
          eqZ[i] = 0;
        }
      }
    }

    if (!hasSeeds || !hasFrozen) return;
    if (freezeScale <= 0) return;

    // Build set of occupied 3D lattice sites
    this.occupiedSites.clear();
    for (let i = 0; i < count; i++) {
      const base = i * FLOATS_PER_PARTICLE;
      if (data[base + OFF_SEED_ID] >= 0) {
        const key = this.siteKey3D(data[base + OFF_EQ_X], data[base + OFF_EQ_Y], eqZ[i]);
        this.occupiedSites.add(key);
      }
    }

    // Propagate freezing front (temperature-modulated, 3D-aware)
    for (let i = 0; i < count; i++) {
      const base = i * FLOATS_PER_PARTICLE;
      const alpha = data[base + OFF_ALPHA];
      if (alpha >= 1.0) continue;

      const px = data[base + OFF_PX];
      const py = data[base + OFF_PY];
      const pz = data[base + OFF_Z];

      // 2D spatial hash query; filter by 3D distance inline
      const neighbors = this.frozenHash.query(px, py, propagationRadius);

      let frozenInfluence = 0;
      let closestSeedId = -1;
      let closestDist = Infinity;
      let frozenNeighborCount = 0;

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
        const dz = data[bj + OFF_Z] - pz; // Z: not periodic
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz); // 3D distance

        if (dist < propagationRadius) {
          let weight = aj * (1.0 - dist / propagationRadius);

          // Hexagonal directional bias: favor growth along lattice axes
          // Applied to XY projection angle (hex symmetry is in the basal plane)
          if (hexBias > 0) {
            const neighborSeedId = data[bj + OFF_SEED_ID];
            const neighborSeed = seeds.find(s => s.id === neighborSeedId);
            const seedTheta = neighborSeed ? neighborSeed.theta : 0;
            const angle = Math.atan2(dy, dx); // XY-plane angle
            const raw = 0.5 + 0.5 * Math.cos(6 * (angle - seedTheta));
            const hexMod = (1.0 - hexBias) + hexBias * raw * raw;
            weight *= hexMod;
          }

          frozenInfluence += weight;
          frozenNeighborCount++;

          if (dist < closestDist) {
            closestDist = dist;
            closestSeedId = data[bj + OFF_SEED_ID];
          }
        }
      }

      if (frozenInfluence > 0) {
        // Lattice-site proximity weighting (3D)
        if (closestSeedId >= 0) {
          const proxSeed = seeds.find(s => s.id === closestSeedId);
          if (proxSeed) {
            const site = this.lattice.nearestSite(px, py, pz, proxSeed.x, proxSeed.y, proxSeed.theta);
            let sdx = site.x - px, sdy = site.y - py;
            if (sdx > halfW) sdx -= W; else if (sdx < -halfW) sdx += W;
            if (sdy > halfH) sdy -= H; else if (sdy < -halfH) sdy += H;
            const sdz = site.z - pz;
            const siteDist = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz);
            const siteRadius = CONFIG.freeze.latticeSpacing * 0.5;
            const latticeFitness = siteDist < siteRadius
              ? 1.0 - 0.7 * (siteDist / siteRadius)
              : 0.3;
            frozenInfluence *= latticeFitness;
          }
        }

        const deltaAlpha = frozenInfluence * propagationRate * freezeScale;
        let newAlpha = Math.min(1.0, alpha + deltaAlpha);

        if (data[base + OFF_SEED_ID] < 0 && newAlpha > 0.5) {
          newAlpha = 0.5;
        }
        data[base + OFF_ALPHA] = newAlpha;

        // Site assignment gating: 3D-aware
        const assignThreshold = CONFIG.freeze.latticeAssignThreshold;
        const minNeighbors = 2;
        if (data[base + OFF_SEED_ID] < 0 && closestSeedId >= 0
            && newAlpha >= assignThreshold && frozenNeighborCount >= minNeighbors) {
          const seed = seeds.find(s => s.id === closestSeedId);
          if (seed) {
            const site = this.lattice.nearestSite(px, py, pz, seed.x, seed.y, seed.theta);

            // Strict crystal-continuation check (3D distances for adjacency)
            // Ice-like honeycomb: coordination cap = 4 (3 in-plane + 1 inter-layer)
            // This prevents dense blob-like packing and enforces open ring topology.
            const targetR = CONFIG.freeze.latticeSpacing;
            const zSpacing = CONFIG.freeze.zLayerSpacing;
            // 3D adjacency range for honeycomb nearest neighbors
            const maxNeighborDist = Math.sqrt(targetR * targetR + zSpacing * zSpacing) * 1.15;
            const adjLo = targetR * 0.70;
            const adjHi = maxNeighborDist;
            let adjacentCount = 0;
            let interLayerCount = 0; // new molecule's inter-layer bonds
            let wouldOverCoordinate = false;
            const zThreshold = zSpacing * 0.5; // |Δz| > this means inter-layer

            for (let ni = 0; ni < neighbors.length; ni++) {
              const j = neighbors[ni];
              if (j === i) continue;
              const bj = j * FLOATS_PER_PARTICLE;
              if (data[bj + OFF_SEED_ID] < 0) continue;

              // 3D distance between equilibrium sites
              let edx = data[bj + OFF_EQ_X] - site.x;
              let edy = data[bj + OFF_EQ_Y] - site.y;
              if (edx > halfW) edx -= W; else if (edx < -halfW) edx += W;
              if (edy > halfH) edy -= H; else if (edy < -halfH) edy += H;
              const edz = eqZ[j] - site.z;
              const eqDist = Math.sqrt(edx * edx + edy * edy + edz * edz);

              if (eqDist >= adjLo && eqDist <= adjHi) {
                adjacentCount++;

                // Track inter-layer bonds for the new molecule
                // Ice Ih: max 1 inter-layer bond (3 in-plane + 1 inter-layer = 4 total)
                if (Math.abs(edz) > zThreshold) {
                  interLayerCount++;
                  if (interLayerCount > 1) {
                    wouldOverCoordinate = true;
                    break;
                  }
                }

                // Count how many neighbors this existing molecule already has
                let existingNN = 0;
                let existingInterLayer = 0;
                for (let mi = 0; mi < neighbors.length; mi++) {
                  const k = neighbors[mi];
                  if (k === j || k === i) continue;
                  const bk = k * FLOATS_PER_PARTICLE;
                  if (data[bk + OFF_SEED_ID] < 0) continue;
                  let ekx = data[bk + OFF_EQ_X] - data[bj + OFF_EQ_X];
                  let eky = data[bk + OFF_EQ_Y] - data[bj + OFF_EQ_Y];
                  if (ekx > halfW) ekx -= W; else if (ekx < -halfW) ekx += W;
                  if (eky > halfH) eky -= H; else if (eky < -halfH) eky += H;
                  const ekz = eqZ[k] - eqZ[j];
                  const eDist = Math.sqrt(ekx * ekx + eky * eky + ekz * ekz);
                  if (eDist >= adjLo && eDist <= adjHi) {
                    existingNN++;
                    if (Math.abs(ekz) > zThreshold) existingInterLayer++;
                  }
                }
                // Ice Ih coordination cap: max 4 total, max 1 inter-layer
                // Adding this new molecule as neighbor: check both limits
                const isInterLayer = Math.abs(edz) > zThreshold;
                if (existingNN + 1 > 4 || (isInterLayer && existingInterLayer + 1 > 1)) {
                  wouldOverCoordinate = true;
                  break;
                }
              }
            }

            if (adjacentCount >= 2 && !wouldOverCoordinate) {
              const siteKey = this.siteKey3D(site.x, site.y, site.z);
              if (!this.occupiedSites.has(siteKey)) {
                this.occupiedSites.add(siteKey);
                data[base + OFF_SEED_ID] = closestSeedId;
                data[base + OFF_EQ_X] = site.x;
                data[base + OFF_EQ_Y] = site.y;
                eqZ[i] = site.z;
              }
            }
          }
        }
      }
    }
  }
}
