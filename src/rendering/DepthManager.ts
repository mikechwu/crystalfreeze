import { CONFIG } from '../config';

export class DepthManager {
  readonly focalLength: number;
  readonly slabHalf: number;

  constructor() {
    this.focalLength = CONFIG.depth.focalLength;
    this.slabHalf = CONFIG.depth.slabHalf;
  }

  perspectiveScale(z: number): number {
    return this.focalLength / (this.focalLength + z);
  }

  // Min/max perspective scale for the slab
  get minScale(): number {
    return this.perspectiveScale(this.slabHalf);
  }

  get maxScale(): number {
    return this.perspectiveScale(-this.slabHalf);
  }
}
