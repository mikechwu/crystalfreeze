import { CONFIG, type Theme, type MoleculeStyle } from '../config';
import {
  FLOATS_PER_PARTICLE,
  OFF_PX, OFF_PY, OFF_ALPHA, OFF_SEED_ID,
  OFF_QX, OFF_QY, OFF_QZ,
} from '../particles/ParticleSystem';
import { createProgram, getUniformLocation } from '../utils/GLHelpers';
import { VERT_SHADER, GLOSSY_FRAG, MINIMAL_FRAG, HBOND_VERT, HBOND_FRAG } from './shaders';
import { SpatialHash } from '../utils/SpatialHash';

export type RenderMode = 'glossy' | 'minimal';

export class ParticleRenderer {
  private gl: WebGL2RenderingContext;
  private glossyProgram: WebGLProgram;
  private minimalProgram: WebGLProgram;
  private activeProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private mode: RenderMode;
  private particleCount: number;
  private theme: Theme;
  private moleculeStyle: MoleculeStyle;
  private debugTracked: number;
  private focalLength: number;

  // H-bond line rendering
  private hbondProgram: WebGLProgram;
  private hbondVao: WebGLVertexArrayObject;
  private hbondVbo: WebGLBuffer;
  private hbondLineCount: number = 0;
  private hbondEnabled: boolean = false;
  private hbondHash: SpatialHash;
  private hbondData: Float32Array;
  private uHbond: Record<string, WebGLUniformLocation>;

  private uGlossy: Record<string, WebGLUniformLocation>;
  private uMinimal: Record<string, WebGLUniformLocation>;

  constructor(gl: WebGL2RenderingContext, particleCount: number) {
    this.gl = gl;
    this.particleCount = particleCount;
    this.mode = CONFIG.render.defaultMode;
    this.theme = CONFIG.defaultTheme;
    this.moleculeStyle = CONFIG.render.defaultStyle;
    this.debugTracked = CONFIG.debug.trackedCount;
    this.focalLength = CONFIG.depth.focalLength;

    this.glossyProgram = createProgram(gl, VERT_SHADER, GLOSSY_FRAG);
    this.minimalProgram = createProgram(gl, VERT_SHADER, MINIMAL_FRAG);
    this.hbondProgram = createProgram(gl, HBOND_VERT, HBOND_FRAG);

    this.uGlossy = this.cacheUniforms(this.glossyProgram);
    this.uMinimal = this.cacheUniforms(this.minimalProgram);
    this.uHbond = this.cacheHbondUniforms(this.hbondProgram);

    this.activeProgram = this.mode === 'glossy' ? this.glossyProgram : this.minimalProgram;

    const vbo = gl.createBuffer();
    if (!vbo) throw new Error('Failed to create VBO');
    this.vbo = vbo;

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;

    // H-bond line buffers
    const hbondVbo = gl.createBuffer();
    if (!hbondVbo) throw new Error('Failed to create H-bond VBO');
    this.hbondVbo = hbondVbo;

    const hbondVao = gl.createVertexArray();
    if (!hbondVao) throw new Error('Failed to create H-bond VAO');
    this.hbondVao = hbondVao;

    // Max H-bonds: each frozen molecule can have ~4, so max lines ≈ 2*N
    // Each line = 2 vertices, each vertex = 3 floats (x, y, strength)
    this.hbondData = new Float32Array(particleCount * 2 * 2 * 3);
    this.hbondHash = new SpatialHash(35, {
      periodicX: true, periodicY: true,
      worldWidth: CONFIG.world.width, worldHeight: CONFIG.world.height,
    }); // O-O < 3.5 Å → ~31px at σ=24

    this.setupVAO();
    this.setupHbondVAO();
  }

  // Default visual sizes (sprite-space [-1,1])
  // Ratio H/O ≈ 0.41 matches realistic van der Waals radius ratio
  private oRadius = 0.22;
  private hRadius = 0.09;
  private bondWidth = 0.07;
  private hbondWidth = 1.0; // H-bond line width in device pixels

  private cacheUniforms(program: WebGLProgram): Record<string, WebGLUniformLocation> {
    const gl = this.gl;
    return {
      world_size: getUniformLocation(gl, program, 'u_world_size'),
      viewport_offset: getUniformLocation(gl, program, 'u_viewport_offset'),
      viewport_size: getUniformLocation(gl, program, 'u_viewport_size'),
      focal_length: getUniformLocation(gl, program, 'u_focal_length'),
      base_size: getUniformLocation(gl, program, 'u_base_size'),
      base_size_solid: getUniformLocation(gl, program, 'u_base_size_solid'),
      dpr: getUniformLocation(gl, program, 'u_dpr'),
      edge_fade_width: getUniformLocation(gl, program, 'u_edge_fade_width'),
      oxygen_color: getUniformLocation(gl, program, 'u_oxygen_color'),
      hydrogen_color: getUniformLocation(gl, program, 'u_hydrogen_color'),
      bond_color: getUniformLocation(gl, program, 'u_bond_color'),
      debug_tracked: getUniformLocation(gl, program, 'u_debug_tracked'),
      fog_color: getUniformLocation(gl, program, 'u_fog_color'),
      o_radius: getUniformLocation(gl, program, 'u_o_radius'),
      h_radius: getUniformLocation(gl, program, 'u_h_radius'),
      bond_width: getUniformLocation(gl, program, 'u_bond_width'),
    };
  }

  private cacheHbondUniforms(program: WebGLProgram): Record<string, WebGLUniformLocation> {
    const gl = this.gl;
    return {
      viewport_size: getUniformLocation(gl, program, 'u_viewport_size'),
      hbond_color: getUniformLocation(gl, program, 'u_hbond_color'),
    };
  }

  private setupHbondVAO(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.hbondVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hbondVbo);
    // a_position (vec2) at offset 0
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    // a_strength (float) at offset 8
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.bindVertexArray(null);
  }

  private setupVAO(): void {
    const gl = this.gl;
    const stride = FLOATS_PER_PARTICLE * 4; // 12 floats * 4 bytes = 48 bytes

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    // a_position (vec2) at offset 0
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    // a_velocity (vec2) at offset 8
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    // a_alpha_seed (vec2) at offset 16
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16);
    // a_equilibrium (vec2) at offset 24
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 24);
    // a_depth_orient (vec2) at offset 32 — z + orientation angle
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, stride, 32);
    // a_omega_flags (vec2) at offset 40 — angular velocity + flags
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 2, gl.FLOAT, false, stride, 40);

    gl.bindVertexArray(null);
  }

  uploadParticleData(data: Float32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  setMode(mode: RenderMode): void {
    this.mode = mode;
    this.activeProgram = mode === 'glossy' ? this.glossyProgram : this.minimalProgram;
  }

  getMode(): RenderMode {
    return this.mode;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  setMoleculeStyle(style: MoleculeStyle): void {
    this.moleculeStyle = style;
  }

  setDebugTracked(count: number): void {
    this.debugTracked = count;
  }

  setFocalLength(f: number): void {
    this.focalLength = Math.max(100, Math.min(600, f));
  }

  setORadius(r: number): void { this.oRadius = Math.max(0.08, Math.min(0.40, r)); }
  setHRadius(r: number): void { this.hRadius = Math.max(0.04, Math.min(0.30, r)); }
  setBondWidth(w: number): void { this.bondWidth = Math.max(0.02, Math.min(0.15, w)); }
  setHbondWidth(w: number): void { this.hbondWidth = Math.max(0.5, Math.min(3.0, w)); }
  getORadius(): number { return this.oRadius; }
  getHRadius(): number { return this.hRadius; }
  getBondWidth(): number { return this.bondWidth; }
  getHbondWidth(): number { return this.hbondWidth; }

  setHbondEnabled(enabled: boolean): void {
    this.hbondEnabled = enabled;
  }

  getHbondEnabled(): boolean {
    return this.hbondEnabled;
  }

  /**
   * Detect H-bonds using proper donor-acceptor geometry and fill hbondData buffer.
   *
   * Geometric criterion (standard IUPAC-style):
   *   - O_donor···O_acceptor distance < 3.5 Å (31px at σ=24)
   *   - D-H···A angle > 150° (equivalently, H-O···O angle at donor < 30°)
   *
   * Lines are drawn from donor H to acceptor O (not O to O),
   * making the directional nature of H-bonds visually clear.
   *
   * Viewport-relative coordinates are pre-computed here to avoid
   * per-vertex periodic wrapping artifacts in the shader.
   */
  updateHbonds(data: Float32Array, count: number,
               viewportOffsetX?: number, viewportOffsetY?: number): void {
    if (!this.hbondEnabled) return;

    const W = CONFIG.world.width;
    const H = CONFIG.world.height;
    const halfW = W * 0.5;
    const halfH = H * 0.5;
    const maxOO = 31.0; // O-O distance criterion (~1.29σ ≈ 3.5 Å)
    const cosAngleThreshold = Math.cos(30 * Math.PI / 180); // cos(30°) = 0.866
    const bondLen = CONFIG.interaction.bondLen;
    const bondAngleHalf = CONFIG.interaction.bondAngleHalf;

    // World-space atom radii for surface-to-surface rendering
    // Sprite diameter in world-px = baseSizeSolid / zoom, radius = half
    const spriteRadiusWorld = CONFIG.render.baseSizeSolid / (2.0 * CONFIG.viewport.zoom);
    const oRadiusWorld = this.oRadius * spriteRadiusWorld;
    const hRadiusWorld = this.hRadius * spriteRadiusWorld;

    // Viewport offset for pre-wrapping coordinates
    const vpOx = viewportOffsetX ?? 0;
    const vpOy = viewportOffsetY ?? 0;

    // Rebuild spatial hash with frozen/semi-frozen particles
    this.hbondHash.clear();
    for (let i = 0; i < count; i++) {
      const base = i * FLOATS_PER_PARTICLE;
      if (data[base + OFF_ALPHA] > 0.1) {
        this.hbondHash.insert(data[base + OFF_PX], data[base + OFF_PY], i);
      }
    }

    let lineIdx = 0;
    const maxLines = this.hbondData.length / 6;

    for (let i = 0; i < count; i++) {
      const base = i * FLOATS_PER_PARTICLE;
      if (data[base + OFF_ALPHA] <= 0.1) continue;

      const ox = data[base + OFF_PX];
      const oy = data[base + OFF_PY];

      // Get H positions for molecule i using quaternion rotation
      const qx = data[base + OFF_QX];
      const qy = data[base + OFF_QY];
      const qz = data[base + OFF_QZ];
      const qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));

      const h1lx = Math.cos(bondAngleHalf) * bondLen;
      const h1ly = Math.sin(bondAngleHalf) * bondLen;
      const h2lx = Math.cos(-bondAngleHalf) * bondLen;
      const h2ly = Math.sin(-bondAngleHalf) * bondLen;

      const h1x = ox + this.quatRotXY(h1lx, h1ly, 0, qw, qx, qy, qz, 0);
      const h1y = oy + this.quatRotXY(h1lx, h1ly, 0, qw, qx, qy, qz, 1);
      const h2x = ox + this.quatRotXY(h2lx, h2ly, 0, qw, qx, qy, qz, 0);
      const h2y = oy + this.quatRotXY(h2lx, h2ly, 0, qw, qx, qy, qz, 1);

      const neighbors = this.hbondHash.query(ox, oy, maxOO);

      for (let ni = 0; ni < neighbors.length; ni++) {
        const j = neighbors[ni];
        if (j === i) continue;
        const bj = j * FLOATS_PER_PARTICLE;
        if (data[bj + OFF_ALPHA] <= 0.1) continue;

        const ojx = data[bj + OFF_PX];
        const ojy = data[bj + OFF_PY];

        // Minimum-image O-O displacement
        let dx = ojx - ox;
        let dy = ojy - oy;
        if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
        if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxOO || dist < 1) continue;

        // Avoid duplicate: only check i as donor (i donates H to j)
        // Both directions (i→j and j→i) are checked by iterating all i
        if (j < i) continue;

        // Check each H of molecule i as potential donor
        const dirX = dx / dist;
        const dirY = dy / dist;

        // H1 donor check: angle between O-H1 vector and O-O direction
        let hox = h1x - ox, hoy = h1y - oy;
        const hoLen = Math.sqrt(hox * hox + hoy * hoy);
        let foundH1 = false;
        if (hoLen > 0) {
          const cosA = (hox * dirX + hoy * dirY) / hoLen;
          if (cosA > cosAngleThreshold) {
            foundH1 = true;
            if (lineIdx < maxLines) {
              const off = lineIdx * 6;
              const strength = 1.0 - dist / maxOO;
              // Line from donor H surface to acceptor O surface (not center-to-center)
              const hToAccX = (ox + dx) - h1x;
              const hToAccY = (oy + dy) - h1y;
              const lineLen = Math.sqrt(hToAccX * hToAccX + hToAccY * hToAccY);
              // Direction from H to acceptor O
              const ldx = lineLen > 0.1 ? hToAccX / lineLen : 0;
              const ldy = lineLen > 0.1 ? hToAccY / lineLen : 0;
              // Offset start by hRadius (near H surface), end by oRadius (near O surface)
              const startOffX = ldx * hRadiusWorld;
              const startOffY = ldy * hRadiusWorld;
              const endOffX = ldx * oRadiusWorld;
              const endOffY = ldy * oRadiusWorld;
              let relHx = h1x + startOffX - vpOx;
              let relHy = h1y + startOffY - vpOy;
              relHx = ((relHx % W) + W) % W; if (relHx > halfW) relHx -= W;
              relHy = ((relHy % H) + H) % H; if (relHy > halfH) relHy -= H;
              this.hbondData[off] = relHx;
              this.hbondData[off + 1] = relHy;
              this.hbondData[off + 2] = strength;
              this.hbondData[off + 3] = relHx + hToAccX - startOffX - endOffX;
              this.hbondData[off + 4] = relHy + hToAccY - startOffY - endOffY;
              this.hbondData[off + 5] = strength;
              lineIdx++;
            }
          }
        }

        // H2 donor check (only if H1 didn't match, one H-bond per donor molecule per pair)
        if (!foundH1) {
          hox = h2x - ox; hoy = h2y - oy;
          const hoLen2 = Math.sqrt(hox * hox + hoy * hoy);
          if (hoLen2 > 0) {
            const cosA = (hox * dirX + hoy * dirY) / hoLen2;
            if (cosA > cosAngleThreshold) {
              if (lineIdx < maxLines) {
                const off = lineIdx * 6;
                const strength = 1.0 - dist / maxOO;
                const hToAccX = (ox + dx) - h2x;
                const hToAccY = (oy + dy) - h2y;
                const lineLen = Math.sqrt(hToAccX * hToAccX + hToAccY * hToAccY);
                const ldx = lineLen > 0.1 ? hToAccX / lineLen : 0;
                const ldy = lineLen > 0.1 ? hToAccY / lineLen : 0;
                const startOffX = ldx * hRadiusWorld;
                const startOffY = ldy * hRadiusWorld;
                const endOffX = ldx * oRadiusWorld;
                const endOffY = ldy * oRadiusWorld;
                let relHx = h2x + startOffX - vpOx;
                let relHy = h2y + startOffY - vpOy;
                relHx = ((relHx % W) + W) % W; if (relHx > halfW) relHx -= W;
                relHy = ((relHy % H) + H) % H; if (relHy > halfH) relHy -= H;
                this.hbondData[off] = relHx;
                this.hbondData[off + 1] = relHy;
                this.hbondData[off + 2] = strength;
                this.hbondData[off + 3] = relHx + hToAccX - startOffX - endOffX;
                this.hbondData[off + 4] = relHy + hToAccY - startOffY - endOffY;
                this.hbondData[off + 5] = strength;
                lineIdx++;
              }
            }
          }
        }
      }
    }
    this.hbondLineCount = lineIdx;

    // Upload
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hbondVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.hbondData.subarray(0, lineIdx * 6), gl.DYNAMIC_DRAW);
  }

  private quatRotXY(vx: number, vy: number, vz: number, qw: number, qx: number, qy: number, qz: number, axis: number): number {
    // v' = v + 2*qw*(q×v) + 2*(q×(q×v))
    const cx = qy * vz - qz * vy;
    const cy = qz * vx - qx * vz;
    const cz = qx * vy - qy * vx;
    const cx2 = qy * cz - qz * cy;
    const cy2 = qz * cx - qx * cz;
    if (axis === 0) return vx + 2 * (qw * cx + cx2);
    return vy + 2 * (qw * cy + cy2);
  }

  render(viewportWidth: number, viewportHeight: number, viewportOffsetX: number, viewportOffsetY: number): void {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, Math.ceil(viewportWidth * CONFIG.viewport.zoom * dpr), Math.ceil(viewportHeight * CONFIG.viewport.zoom * dpr));

    gl.useProgram(this.activeProgram);

    const u = this.mode === 'glossy' ? this.uGlossy : this.uMinimal;
    gl.uniform2f(u.world_size, CONFIG.world.width, CONFIG.world.height);
    gl.uniform2f(u.viewport_offset, viewportOffsetX, viewportOffsetY);
    gl.uniform2f(u.viewport_size, viewportWidth, viewportHeight);
    gl.uniform1f(u.focal_length, this.focalLength);
    // Scale point sprite size by zoom so molecules grow when zoomed in
    gl.uniform1f(u.base_size, CONFIG.render.baseSizeLiquid * CONFIG.viewport.zoom);
    gl.uniform1f(u.base_size_solid, CONFIG.render.baseSizeSolid * CONFIG.viewport.zoom);
    gl.uniform1f(u.dpr, dpr);
    gl.uniform1f(u.edge_fade_width, CONFIG.render.edgeFadeWidth / CONFIG.viewport.zoom);
    gl.uniform1f(u.debug_tracked, this.debugTracked);

    // Fog color: use theme background midpoint for depth desaturation
    const fogColors = CONFIG.themes[this.theme];
    const fogR = (fogColors.colorTop[0] + fogColors.colorBottom[0]) * 0.5;
    const fogG = (fogColors.colorTop[1] + fogColors.colorBottom[1]) * 0.5;
    const fogB = (fogColors.colorTop[2] + fogColors.colorBottom[2]) * 0.5;
    gl.uniform3f(u.fog_color, fogR, fogG, fogB);

    const styleColors = CONFIG.moleculeStyles[this.moleculeStyle][this.theme];
    const [or2, og, ob] = styleColors.oxygenColor;
    const [hr, hg, hb] = styleColors.hydrogenColor;
    const [br, bg2, bb] = styleColors.bondColor;
    gl.uniform3f(u.oxygen_color, or2, og, ob);
    gl.uniform3f(u.hydrogen_color, hr, hg, hb);
    gl.uniform3f(u.bond_color, br, bg2, bb);
    gl.uniform1f(u.o_radius, this.oRadius);
    gl.uniform1f(u.h_radius, this.hRadius);
    gl.uniform1f(u.bond_width, this.bondWidth);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.particleCount);
    gl.bindVertexArray(null);

    // H-bond lines (drawn on top of particles) — dashed, theme-aware color
    if (this.hbondEnabled && this.hbondLineCount > 0) {
      gl.useProgram(this.hbondProgram);
      gl.uniform2f(this.uHbond.viewport_size, viewportWidth, viewportHeight);
      // Theme-aware H-bond color from style palette
      const hbondStyle = CONFIG.moleculeStyles[this.moleculeStyle][this.theme] as Record<string, readonly number[]>;
      const hbc = hbondStyle.hbondColor || [0.15, 0.35, 0.70];
      gl.uniform3f(this.uHbond.hbond_color, hbc[0], hbc[1], hbc[2]);
      gl.lineWidth(this.hbondWidth);

      gl.bindVertexArray(this.hbondVao);
      gl.drawArrays(gl.LINES, 0, this.hbondLineCount * 2);
      gl.bindVertexArray(null);
      gl.lineWidth(1.0); // restore default
    }

    gl.depthMask(true);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.glossyProgram);
    gl.deleteProgram(this.minimalProgram);
    gl.deleteBuffer(this.hbondVbo);
    gl.deleteVertexArray(this.hbondVao);
    gl.deleteProgram(this.hbondProgram);
  }
}
