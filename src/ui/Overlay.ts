import type { RenderMode } from '../rendering/ParticleRenderer';
import type { Theme, MoleculeStyle } from '../config';

export interface OverlayCallbacks {
  onModeChange: (mode: RenderMode) => void;
  onThemeChange: (theme: Theme) => void;
  onStyleChange?: (style: MoleculeStyle) => void;
  onTemperatureChange?: (temperature: number) => void;
  onSpeedChange?: (speed: number) => void;
  onPropagationRateChange?: (rate: number) => void;
  onHbondToggle?: (enabled: boolean) => void;
  onORadiusChange?: (r: number) => void;
  onHRadiusChange?: (r: number) => void;
  onBondWidthChange?: (w: number) => void;
  onHbondWidthChange?: (w: number) => void;
  onZLayerCountChange?: (count: number) => void;
  onZLayerSpacingChange?: (spacing: number) => void;
}

export class Overlay {
  private container: HTMLElement;
  private panel: HTMLElement | null = null;
  private fpsDisplay: HTMLElement | null = null;
  private isOpen = false;
  private callbacks: OverlayCallbacks;
  private frameCount = 0;
  private lastFpsTime = 0;

  constructor(container: HTMLElement, callbacks: OverlayCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.createUI();
  }

  private createUI(): void {
    // Settings button
    const btn = document.createElement('button');
    btn.className = 'settings-button';
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>`;
    btn.addEventListener('click', () => this.togglePanel());
    this.container.appendChild(btn);

    // Settings panel
    this.panel = document.createElement('div');
    this.panel.className = 'settings-panel';
    this.panel.innerHTML = `
      <h3>Settings</h3>
      <div class="section-header">Appearance</div>
      <div class="setting-row">
        <label>Visual Style</label>
        <div class="mode-toggle">
          <button class="active" data-mode="glossy">Glossy</button>
          <button data-mode="minimal">Minimal</button>
        </div>
      </div>
      <div class="setting-row">
        <label>Theme</label>
        <div class="theme-toggle">
          <button class="active" data-theme="dark">Dark</button>
          <button data-theme="light">Light</button>
        </div>
      </div>
      <div class="setting-row">
        <label>Molecule Colors</label>
        <div class="style-toggle">
          <button class="active" data-style="chemical">Chemical</button>
          <button data-style="stylized">Stylized</button>
        </div>
      </div>
      <div class="section-header">Simulation</div>
      <div class="setting-row">
        <label>Temperature</label>
        <div class="temp-slider-wrap">
          <span class="temp-label-cold">Cold</span>
          <input type="range" class="temp-slider" min="0" max="100" value="0" />
          <span class="temp-label-warm">Warm</span>
        </div>
      </div>
      <div class="section-header advanced-toggle-header">Advanced <span class="advanced-arrow">&#9654;</span></div>
      <div class="advanced-section">
        <div class="setting-row">
          <label>Freeze Speed</label>
          <div class="speed-toggle">
            <button class="active" data-speed="1">x1</button>
            <button data-speed="5">x5</button>
            <button data-speed="20">x20</button>
          </div>
        </div>
        <div class="setting-row">
          <label>Propagation Rate <span class="prop-rate-value">0.20%</span></label>
          <input type="range" class="prop-rate-slider" min="2" max="200" value="20" />
        </div>
        <div class="setting-row">
          <label>Show H-bonds</label>
          <label class="toggle-switch">
            <input type="checkbox" class="hbond-toggle" />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="setting-row">
          <label>O Radius <span class="o-radius-value">0.22</span></label>
          <input type="range" class="o-radius-slider" min="8" max="40" value="22" />
        </div>
        <div class="setting-row">
          <label>H Radius <span class="h-radius-value">0.09</span></label>
          <input type="range" class="h-radius-slider" min="4" max="30" value="9" />
        </div>
        <div class="setting-row">
          <label>Bond Width <span class="bond-width-value">0.07</span></label>
          <input type="range" class="bond-width-slider" min="2" max="15" value="7" />
        </div>
        <div class="setting-row">
          <label>H-Bond Width <span class="hbond-width-value">1.0</span></label>
          <input type="range" class="hbond-width-slider" min="5" max="30" value="10" />
        </div>
        <div class="section-header sub-section">3D Lattice</div>
        <div class="setting-row">
          <label>Z Layers <span class="z-layer-count-value">3</span></label>
          <input type="range" class="z-layer-count-slider" min="2" max="4" value="3" step="1" />
        </div>
        <div class="setting-row">
          <label>Z Layer Spacing <span class="z-layer-spacing-value">16</span></label>
          <input type="range" class="z-layer-spacing-slider" min="8" max="28" value="16" />
        </div>
      </div>
    `;
    this.container.appendChild(this.panel);

    // Mode toggle handlers
    const modeButtons = this.panel.querySelectorAll('.mode-toggle button');
    modeButtons.forEach(b => {
      b.addEventListener('click', () => {
        modeButtons.forEach(mb => mb.classList.remove('active'));
        b.classList.add('active');
        const mode = b.getAttribute('data-mode') as RenderMode;
        this.callbacks.onModeChange(mode);
      });
    });

    // Theme toggle handlers
    const themeButtons = this.panel.querySelectorAll('.theme-toggle button');
    themeButtons.forEach(b => {
      b.addEventListener('click', () => {
        themeButtons.forEach(tb => tb.classList.remove('active'));
        b.classList.add('active');
        const theme = b.getAttribute('data-theme') as Theme;
        this.callbacks.onThemeChange(theme);
      });
    });

    // Molecule style toggle handlers
    const styleButtons = this.panel.querySelectorAll('.style-toggle button');
    styleButtons.forEach(b => {
      b.addEventListener('click', () => {
        styleButtons.forEach(sb => sb.classList.remove('active'));
        b.classList.add('active');
        const style = b.getAttribute('data-style') as MoleculeStyle;
        this.callbacks.onStyleChange?.(style);
      });
    });

    // Speed toggle handlers
    const speedButtons = this.panel.querySelectorAll('.speed-toggle button');
    speedButtons.forEach(b => {
      b.addEventListener('click', () => {
        speedButtons.forEach(sb => sb.classList.remove('active'));
        b.classList.add('active');
        const speed = parseInt(b.getAttribute('data-speed') || '1', 10);
        this.callbacks.onSpeedChange?.(speed);
      });
    });

    // Temperature slider handler
    const tempSlider = this.panel.querySelector('.temp-slider') as HTMLInputElement;
    if (tempSlider) {
      tempSlider.addEventListener('input', () => {
        const temp = parseInt(tempSlider.value, 10) / 100;
        this.callbacks.onTemperatureChange?.(temp);
      });
    }

    // Advanced section toggle
    const advToggle = this.panel.querySelector('.advanced-toggle-header');
    const advSection = this.panel.querySelector('.advanced-section') as HTMLElement;
    const advArrow = this.panel.querySelector('.advanced-arrow');
    if (advToggle && advSection) {
      advSection.style.display = 'none';
      advToggle.addEventListener('click', () => {
        const isOpen = advSection.style.display !== 'none';
        advSection.style.display = isOpen ? 'none' : 'block';
        if (advArrow) advArrow.textContent = isOpen ? '\u25B6' : '\u25BC';
      });
    }

    // Propagation rate slider handler
    const propSlider = this.panel.querySelector('.prop-rate-slider') as HTMLInputElement;
    const propValue = this.panel.querySelector('.prop-rate-value');
    if (propSlider) {
      propSlider.addEventListener('input', () => {
        const rate = parseInt(propSlider.value, 10) / 10000;
        if (propValue) propValue.textContent = `${(rate * 100).toFixed(2)}%`;
        this.callbacks.onPropagationRateChange?.(rate);
      });
    }

    // H-bond toggle handler
    const hbondToggle = this.panel.querySelector('.hbond-toggle') as HTMLInputElement;
    if (hbondToggle) {
      hbondToggle.addEventListener('change', () => {
        this.callbacks.onHbondToggle?.(hbondToggle.checked);
      });
    }

    // O radius slider
    const oRadiusSlider = this.panel.querySelector('.o-radius-slider') as HTMLInputElement;
    const oRadiusValue = this.panel.querySelector('.o-radius-value');
    if (oRadiusSlider) {
      oRadiusSlider.addEventListener('input', () => {
        const r = parseInt(oRadiusSlider.value, 10) / 100;
        if (oRadiusValue) oRadiusValue.textContent = r.toFixed(2);
        this.callbacks.onORadiusChange?.(r);
      });
    }

    // H radius slider
    const hRadiusSlider = this.panel.querySelector('.h-radius-slider') as HTMLInputElement;
    const hRadiusValue = this.panel.querySelector('.h-radius-value');
    if (hRadiusSlider) {
      hRadiusSlider.addEventListener('input', () => {
        const r = parseInt(hRadiusSlider.value, 10) / 100;
        if (hRadiusValue) hRadiusValue.textContent = r.toFixed(2);
        this.callbacks.onHRadiusChange?.(r);
      });
    }

    // Bond width slider
    const bondWidthSlider = this.panel.querySelector('.bond-width-slider') as HTMLInputElement;
    const bondWidthValue = this.panel.querySelector('.bond-width-value');
    if (bondWidthSlider) {
      bondWidthSlider.addEventListener('input', () => {
        const w = parseInt(bondWidthSlider.value, 10) / 100;
        if (bondWidthValue) bondWidthValue.textContent = w.toFixed(2);
        this.callbacks.onBondWidthChange?.(w);
      });
    }

    // H-bond width slider
    const hbondWidthSlider = this.panel.querySelector('.hbond-width-slider') as HTMLInputElement;
    const hbondWidthValue = this.panel.querySelector('.hbond-width-value');
    if (hbondWidthSlider) {
      hbondWidthSlider.addEventListener('input', () => {
        const w = parseInt(hbondWidthSlider.value, 10) / 10;
        if (hbondWidthValue) hbondWidthValue.textContent = w.toFixed(1);
        this.callbacks.onHbondWidthChange?.(w);
      });
    }

    // Z Layer count slider
    const zLayerCountSlider = this.panel.querySelector('.z-layer-count-slider') as HTMLInputElement;
    const zLayerCountValue = this.panel.querySelector('.z-layer-count-value');
    if (zLayerCountSlider) {
      zLayerCountSlider.addEventListener('input', () => {
        const count = parseInt(zLayerCountSlider.value, 10);
        if (zLayerCountValue) zLayerCountValue.textContent = String(count);
        this.callbacks.onZLayerCountChange?.(count);
      });
    }

    // Z Layer spacing slider
    const zLayerSpacingSlider = this.panel.querySelector('.z-layer-spacing-slider') as HTMLInputElement;
    const zLayerSpacingValue = this.panel.querySelector('.z-layer-spacing-value');
    if (zLayerSpacingSlider) {
      zLayerSpacingSlider.addEventListener('input', () => {
        const spacing = parseInt(zLayerSpacingSlider.value, 10);
        if (zLayerSpacingValue) zLayerSpacingValue.textContent = String(spacing);
        this.callbacks.onZLayerSpacingChange?.(spacing);
      });
    }

    // FPS counter
    this.fpsDisplay = document.createElement('div');
    this.fpsDisplay.className = 'fps-counter';
    this.fpsDisplay.textContent = '-- fps';
    document.body.appendChild(this.fpsDisplay);

    this.lastFpsTime = performance.now();
  }

  private togglePanel(): void {
    this.isOpen = !this.isOpen;
    if (this.panel) {
      if (this.isOpen) {
        this.panel.style.display = 'block';
        requestAnimationFrame(() => {
          this.panel!.classList.add('open');
        });
      } else {
        this.panel.classList.remove('open');
        setTimeout(() => {
          if (!this.isOpen) this.panel!.style.display = 'none';
        }, 250);
      }
    }
  }

  updateFPS(): void {
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastFpsTime;

    if (elapsed >= 1000) {
      const fps = Math.round((this.frameCount * 1000) / elapsed);
      if (this.fpsDisplay) {
        this.fpsDisplay.textContent = `${fps} fps`;
      }
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }

  dispose(): void {
    this.container.innerHTML = '';
    if (this.fpsDisplay) {
      this.fpsDisplay.remove();
    }
  }
}
