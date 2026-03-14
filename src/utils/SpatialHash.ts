// Spatial hash with optional periodic XY wrapping.
// When periodic, cell indices are wrapped via modulo so particles near
// opposite boundaries discover each other as neighbors.

export interface SpatialHashOptions {
  periodicX?: boolean;
  periodicY?: boolean;
  worldWidth?: number;
  worldHeight?: number;
}

export class SpatialHash {
  private cellSize: number;
  private cells: Map<number, number[]>;

  // Periodic wrapping state
  private periodicX: boolean;
  private periodicY: boolean;
  private cellsX: number; // total cell columns (only used when periodicX)
  private cellsY: number; // total cell rows    (only used when periodicY)

  constructor(cellSize: number, opts?: SpatialHashOptions) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.periodicX = opts?.periodicX ?? false;
    this.periodicY = opts?.periodicY ?? false;
    this.cellsX = opts?.worldWidth  ? Math.ceil(opts.worldWidth  / cellSize) : 0;
    this.cellsY = opts?.worldHeight ? Math.ceil(opts.worldHeight / cellSize) : 0;

    if (this.periodicX && this.cellsX <= 0) {
      throw new Error('SpatialHash: periodicX requires a positive worldWidth');
    }
    if (this.periodicY && this.cellsY <= 0) {
      throw new Error('SpatialHash: periodicY requires a positive worldHeight');
    }
  }

  /** Wrap a cell index into [0, count) — handles negatives correctly. */
  private wrapCell(ci: number, count: number): number {
    return ((ci % count) + count) % count;
  }

  private key(x: number, y: number): number {
    let cx = Math.floor(x / this.cellSize);
    let cy = Math.floor(y / this.cellSize);
    if (this.periodicX) cx = this.wrapCell(cx, this.cellsX);
    if (this.periodicY) cy = this.wrapCell(cy, this.cellsY);
    return cx * 73856093 ^ cy * 19349663;
  }

  clear(): void {
    this.cells.clear();
  }

  insert(x: number, y: number, id: number): void {
    const k = this.key(x, y);
    const cell = this.cells.get(k);
    if (cell) {
      cell.push(id);
    } else {
      this.cells.set(k, [id]);
    }
  }

  query(x: number, y: number, radius: number): number[] {
    const results: number[] = [];
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        let wcx = cx;
        let wcy = cy;
        if (this.periodicX) wcx = this.wrapCell(cx, this.cellsX);
        if (this.periodicY) wcy = this.wrapCell(cy, this.cellsY);
        const k = wcx * 73856093 ^ wcy * 19349663;
        const cell = this.cells.get(k);
        if (cell) {
          results.push(...cell);
        }
      }
    }
    return results;
  }
}
