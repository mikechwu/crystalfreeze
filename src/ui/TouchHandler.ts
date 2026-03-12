import { CONFIG } from '../config';

export interface TouchCallbacks {
  onSeedPlace: (x: number, y: number) => void;
}

export class TouchHandler {
  private canvas: HTMLCanvasElement;
  private callbacks: TouchCallbacks;
  private touchStartTime = 0;
  private touchStartPos = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, callbacks: TouchCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Mouse click
    this.canvas.addEventListener('click', (e) => {
      this.callbacks.onSeedPlace(e.clientX, e.clientY);
    });

    // Touch with tap detection
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.touchStartTime = performance.now();
        this.touchStartPos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }
    }, { passive: true });

    this.canvas.addEventListener('touchend', (e) => {
      const elapsed = performance.now() - this.touchStartTime;
      if (elapsed > CONFIG.ui.tapMaxDuration) return;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - this.touchStartPos.x;
      const dy = touch.clientY - this.touchStartPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > CONFIG.ui.tapMaxDistance) return;

      e.preventDefault();
      this.callbacks.onSeedPlace(touch.clientX, touch.clientY);
    });
  }

  dispose(): void {
    // Listeners are garbage collected with the canvas
  }
}
