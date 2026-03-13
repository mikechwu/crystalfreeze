import { CONFIG, type Theme, type MoleculeStyle } from './config';
import { ParticleSystem } from './particles/ParticleSystem';
import { ParticleRenderer, RenderMode } from './rendering/ParticleRenderer';
import { SceneSetup } from './rendering/SceneSetup';
import { FreezeSystem } from './simulation/FreezeSystem';
import { Overlay } from './ui/Overlay';
import { TouchHandler } from './ui/TouchHandler';

class CrystalFreezeApp {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private particles: ParticleSystem;
  private freezeSystem: FreezeSystem;
  private renderer: ParticleRenderer;
  private scene: SceneSetup;
  private overlay: Overlay;
  private _touchHandler: TouchHandler;
  private animationId: number = 0;
  private lastTime: number = 0;
  private theme: Theme;
  private simSpeed: number = CONFIG.simulation.defaultSpeed;

  // Performance profiling — lightweight timing markers
  private perfLog: { particles: number; freeze: number; render: number } = { particles: 0, freeze: 0, render: 0 };
  private perfFrameCount: number = 0;

  // Viewport offset into the fixed world domain
  // Centers the viewport in the world
  private viewportOffsetX: number = 0;
  private viewportOffsetY: number = 0;

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!this.canvas) throw new Error('Canvas element not found');

    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      this.showFallback('WebGL2 is not supported on this device.');
      throw new Error('WebGL2 not supported');
    }
    this.gl = gl;

    const maxTF = gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS);
    console.log(`WebGL2 initialized: TF components=${maxTF}`);

    this.resizeCanvas();

    // Particle system uses fixed world domain — no viewport dependency
    const particleCount = CONFIG.particles.default;
    this.particles = new ParticleSystem(particleCount);
    this.freezeSystem = new FreezeSystem();
    this.renderer = new ParticleRenderer(gl, particleCount);
    this.scene = new SceneSetup(gl);

    // Initialize theme
    this.theme = CONFIG.defaultTheme;

    // Compute initial viewport offset (center the viewport in the world)
    this.updateViewportOffset();

    // UI
    const overlayEl = document.getElementById('overlay')!;
    this.overlay = new Overlay(overlayEl, {
      onModeChange: (mode: RenderMode) => {
        this.renderer.setMode(mode);
      },
      onThemeChange: (theme: Theme) => {
        this.setTheme(theme);
      },
      onStyleChange: (style: MoleculeStyle) => {
        this.renderer.setMoleculeStyle(style);
      },
      onTemperatureChange: (temperature: number) => {
        this.freezeSystem.temperature = temperature;
      },
      onSpeedChange: (speed: number) => {
        this.simSpeed = speed;
      },
      onPropagationRateChange: (rate: number) => {
        this.freezeSystem.propagationRate = rate;
      },
      onHbondToggle: (enabled: boolean) => {
        this.renderer.setHbondEnabled(enabled);
      },
      onORadiusChange: (r: number) => {
        this.renderer.setORadius(r);
      },
      onHRadiusChange: (r: number) => {
        this.renderer.setHRadius(r);
      },
      onBondWidthChange: (w: number) => {
        this.renderer.setBondWidth(w);
      },
      onHbondWidthChange: (w: number) => {
        this.renderer.setHbondWidth(w);
      },
      onZLayerCountChange: (count: number) => {
        // Update config — affects new lattice site generation
        (CONFIG.freeze as any).zLayerCount = count;
      },
      onZLayerSpacingChange: (spacing: number) => {
        // Update config — affects new lattice site generation
        (CONFIG.freeze as any).zLayerSpacing = spacing;
      },
    });

    this._touchHandler = new TouchHandler(this.canvas, {
      onSeedPlace: (screenX: number, screenY: number) => {
        this.handleSeedPlace(screenX, screenY);
      },
    });

    // No auto-seed: freezing only starts when user clicks.
    // Water remains liquid until user places a nucleation seed.

    // Resize only updates canvas + viewport offset, never particle state
    window.addEventListener('resize', () => this.handleResize());

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost');
      cancelAnimationFrame(this.animationId);
    });

    this.canvas.addEventListener('webglcontextrestored', () => {
      console.log('WebGL context restored');
      this.start();
    });

    this.renderer.uploadParticleData(this.particles.data);
  }

  private setTheme(theme: Theme): void {
    this.theme = theme;
    this.renderer.setTheme(theme);
    this.scene.setTheme(theme);

    // Update body class for CSS theme overrides
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(`theme-${theme}`);

    // True light presentation mode: proper white background
    document.body.style.background = CONFIG.themes[theme].bodyBg;
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private updateViewportOffset(): void {
    // Center the zoomed viewport in the world domain
    const zoom = CONFIG.viewport.zoom;
    const vpWorldW = window.innerWidth / zoom;   // visible world width
    const vpWorldH = window.innerHeight / zoom;  // visible world height
    this.viewportOffsetX = (CONFIG.world.width - vpWorldW) / 2;
    this.viewportOffsetY = (CONFIG.world.height - vpWorldH) / 2;
  }

  private handleResize(): void {
    // Only update canvas size and viewport projection — never touch particles
    this.resizeCanvas();
    this.updateViewportOffset();
  }

  private handleSeedPlace(screenX: number, screenY: number): void {
    // Convert screen coordinates to world coordinates
    const zoom = CONFIG.viewport.zoom;
    const worldX = this.viewportOffsetX + screenX / zoom;
    const worldY = this.viewportOffsetY + screenY / zoom;

    // Wrap to world domain
    const wx = ((worldX % CONFIG.world.width) + CONFIG.world.width) % CONFIG.world.width;
    const wy = ((worldY % CONFIG.world.height) + CONFIG.world.height) % CONFIG.world.height;

    const placed = this.freezeSystem.placeSeed(wx, wy, this.particles.data, this.particles.count, this.particles.eqZ);
    if (placed) {
      console.log(`Seed placed at world (${wx.toFixed(0)}, ${wy.toFixed(0)})`);
    }
  }

  start(): void {
    this.lastTime = performance.now();
    this.loop();
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 1 / 30);
    this.lastTime = now;

    // Speed control: separate physics from freeze-front acceleration.
    // Physics always runs once per frame at full dt for stability.
    // Only freeze propagation is called multiple times for faster crystallization.
    // This prevents unphysical bulk drift at high speed multipliers.
    const t0 = performance.now();
    this.particles.update(dt);
    const t1 = performance.now();
    for (let s = 0; s < this.simSpeed; s++) {
      this.freezeSystem.update(this.particles.data, this.particles.count, this.particles.eqZ);
    }
    const t2 = performance.now();

    // Update H-bond lines (before upload) — pass viewport offset for pre-wrapping
    this.renderer.updateHbonds(this.particles.data, this.particles.count,
      this.viewportOffsetX, this.viewportOffsetY);

    // Upload to GPU
    this.renderer.uploadParticleData(this.particles.data);

    // Clear
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Render background gradient
    this.scene.renderBackground();

    // Render particles with viewport-as-window into the world (zoomed)
    const zoom = CONFIG.viewport.zoom;
    const vpWorldW = window.innerWidth / zoom;
    const vpWorldH = window.innerHeight / zoom;
    this.renderer.render(vpWorldW, vpWorldH, this.viewportOffsetX, this.viewportOffsetY);
    const t3 = performance.now();

    // Performance profiling (lightweight rolling average, logged every 120 frames)
    this.perfLog.particles += t1 - t0;
    this.perfLog.freeze += t2 - t1;
    this.perfLog.render += t3 - t2;
    this.perfFrameCount++;
    if (this.perfFrameCount >= 120) {
      const n = this.perfFrameCount;
      console.log(
        `[Perf] particles=${(this.perfLog.particles / n).toFixed(2)}ms ` +
        `freeze=${(this.perfLog.freeze / n).toFixed(2)}ms ` +
        `render=${(this.perfLog.render / n).toFixed(2)}ms ` +
        `total=${((this.perfLog.particles + this.perfLog.freeze + this.perfLog.render) / n).toFixed(2)}ms`
      );
      this.perfLog.particles = 0;
      this.perfLog.freeze = 0;
      this.perfLog.render = 0;
      this.perfFrameCount = 0;
    }

    // Update FPS counter
    this.overlay.updateFPS();

    this.animationId = requestAnimationFrame(this.loop);
  };

  private showFallback(message: string): void {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                  background:#0a0e1a;color:rgba(255,255,255,0.7);font-family:system-ui;
                  text-align:center;padding:20px;">
        <div>
          <p style="font-size:18px;margin-bottom:8px;">${message}</p>
          <p style="font-size:13px;color:rgba(255,255,255,0.4);">
            Try using a modern browser with WebGL2 support.
          </p>
        </div>
      </div>
    `;
  }
}

// Boot
const app = new CrystalFreezeApp();
app.start();
