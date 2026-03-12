// Spatial hash map — stub for Phase 0, used in Phase 3+ for lattice lookup
export class SpatialHash {
  private cellSize: number;
  private cells: Map<number, number[]>;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  private key(x: number, y: number): number {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
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
        const k = cx * 73856093 ^ cy * 19349663;
        const cell = this.cells.get(k);
        if (cell) {
          results.push(...cell);
        }
      }
    }
    return results;
  }
}
