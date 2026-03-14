// Shared lattice-site occupancy utilities.
// Used by both SeedRegistry (initial placement) and FreezeSystem (propagation)
// to enforce unique 3D lattice site assignments.

import { FLOATS_PER_PARTICLE, OFF_SEED_ID, OFF_EQ_X, OFF_EQ_Y } from '../particles/ParticleSystem';

/**
 * Compute a unique numeric key for a 3D lattice site (rounded to 1px precision).
 * Encodes (x, y, z) into a single number for Set<number> lookups.
 */
export function siteKey3D(x: number, y: number, z: number): number {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rz = Math.round(z + 200); // shift z to positive range
  return rx * 1000000 + ry * 1000 + rz;
}

/**
 * Build a set of all currently occupied 3D lattice site keys.
 * Scans all particles that have a seed assignment (seedId >= 0).
 */
export function buildOccupiedSiteSet(
  data: Float32Array,
  count: number,
  eqZ: Float32Array,
): Set<number> {
  const occupied = new Set<number>();
  for (let i = 0; i < count; i++) {
    const base = i * FLOATS_PER_PARTICLE;
    if (data[base + OFF_SEED_ID] >= 0) {
      occupied.add(siteKey3D(data[base + OFF_EQ_X], data[base + OFF_EQ_Y], eqZ[i]));
    }
  }
  return occupied;
}
