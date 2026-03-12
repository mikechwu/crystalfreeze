import type { RenderMode } from '../rendering/ParticleRenderer';
import type { Theme, MoleculeStyle } from '../config';

export interface OverlayCallbacks {
  onModeChange: (mode: RenderMode) => void;
  onThemeChange: (theme: Theme) => void;
  onStyleChange?: (style: MoleculeStyle) => void;
  onTemperatureChange?: (temperature: number) => void;
  onSpeedChange?: (speed: number) => void;
  onPropagationRateChange?: (rate: number) => void;
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
          <label>Propagation Rate <span class="prop-rate-value">1.2%</span></label>
          <input type="range" class="prop-rate-slider" min="2" max="40" value="12" />
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
        const rate = parseInt(propSlider.value, 10) / 1000;
        if (propValue) propValue.textContent = `${(rate * 100).toFixed(1)}%`;
        this.callbacks.onPropagationRateChange?.(rate);
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
