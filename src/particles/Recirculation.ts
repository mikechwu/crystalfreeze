// Recirculation is integrated directly into ParticleSystem.update()
// This module provides the Wang hash PRNG for deterministic recirculation
// and will be expanded in Phase 5 for GPU-side recirculation

export function wangHash(seed: number): number {
  seed = ((seed ^ 61) ^ (seed >>> 16)) >>> 0;
  seed = (seed * 9) >>> 0;
  seed = (seed ^ (seed >>> 4)) >>> 0;
  seed = (seed * 0x27d4eb2d) >>> 0;
  seed = (seed ^ (seed >>> 15)) >>> 0;
  return seed;
}

export function hashToFloat(h: number): number {
  return (h >>> 0) / 4294967296.0;
}
