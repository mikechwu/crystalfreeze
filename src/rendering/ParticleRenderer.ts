import { CONFIG, type Theme, type MoleculeStyle } from '../config';
import { FLOATS_PER_PARTICLE } from '../particles/ParticleSystem';
import { createProgram, getUniformLocation } from '../utils/GLHelpers';
import { VERT_SHADER, GLOSSY_FRAG, MINIMAL_FRAG } from './shaders';

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

  private uGlossy: Record<string, WebGLUniformLocation>;
  private uMinimal: Record<string, WebGLUniformLocation>;

  constructor(gl: WebGL2RenderingContext, particleCount: number) {
    this.gl = gl;
    this.particleCount = particleCount;
    this.mode = CONFIG.render.defaultMode;
    this.theme = CONFIG.defaultTheme;
    this.moleculeStyle = CONFIG.render.defaultStyle;
    this.debugTracked = CONFIG.debug.trackedCount;

    this.glossyProgram = createProgram(gl, VERT_SHADER, GLOSSY_FRAG);
    this.minimalProgram = createProgram(gl, VERT_SHADER, MINIMAL_FRAG);

    this.uGlossy = this.cacheUniforms(this.glossyProgram);
    this.uMinimal = this.cacheUniforms(this.minimalProgram);

    this.activeProgram = this.mode === 'glossy' ? this.glossyProgram : this.minimalProgram;

    const vbo = gl.createBuffer();
    if (!vbo) throw new Error('Failed to create VBO');
    this.vbo = vbo;

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;

    this.setupVAO();
  }

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
    };
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
    gl.uniform1f(u.focal_length, CONFIG.depth.focalLength);
    // Scale point sprite size by zoom so molecules grow when zoomed in
    gl.uniform1f(u.base_size, CONFIG.render.baseSizeLiquid * CONFIG.viewport.zoom);
    gl.uniform1f(u.base_size_solid, CONFIG.render.baseSizeSolid * CONFIG.viewport.zoom);
    gl.uniform1f(u.dpr, dpr);
    gl.uniform1f(u.edge_fade_width, CONFIG.render.edgeFadeWidth / CONFIG.viewport.zoom);
    gl.uniform1f(u.debug_tracked, this.debugTracked);

    const styleColors = CONFIG.moleculeStyles[this.moleculeStyle][this.theme];
    const [or2, og, ob] = styleColors.oxygenColor;
    const [hr, hg, hb] = styleColors.hydrogenColor;
    const [br, bg2, bb] = styleColors.bondColor;
    gl.uniform3f(u.oxygen_color, or2, og, ob);
    gl.uniform3f(u.hydrogen_color, hr, hg, hb);
    gl.uniform3f(u.bond_color, br, bg2, bb);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.particleCount);
    gl.bindVertexArray(null);

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
  }
}
