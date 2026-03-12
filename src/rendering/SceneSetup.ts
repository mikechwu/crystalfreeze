import { CONFIG, type Theme } from '../config';
import { createProgram, getUniformLocation } from '../utils/GLHelpers';
import { BG_VERT, BG_FRAG } from './shaders';

export class SceneSetup {
  private gl: WebGL2RenderingContext;
  private bgProgram: WebGLProgram;
  private bgVAO: WebGLVertexArrayObject;
  private bgVBO: WebGLBuffer;
  private uColorTop: WebGLUniformLocation;
  private uColorBottom: WebGLUniformLocation;
  private theme: Theme;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.theme = CONFIG.defaultTheme;

    // Background gradient program
    this.bgProgram = createProgram(gl, BG_VERT, BG_FRAG);
    this.uColorTop = getUniformLocation(gl, this.bgProgram, 'u_color_top');
    this.uColorBottom = getUniformLocation(gl, this.bgProgram, 'u_color_bottom');

    // Full-screen quad
    const vbo = gl.createBuffer()!;
    this.bgVBO = vbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
    ]), gl.STATIC_DRAW);

    const vao = gl.createVertexArray()!;
    this.bgVAO = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  renderBackground(): void {
    const gl = this.gl;
    const themeColors = CONFIG.themes[this.theme];
    const [rt, gt, bt] = themeColors.colorTop;
    const [rb, gb, bb] = themeColors.colorBottom;

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.useProgram(this.bgProgram);
    gl.uniform3f(this.uColorTop, rt, gt, bt);
    gl.uniform3f(this.uColorBottom, rb, gb, bb);

    gl.bindVertexArray(this.bgVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.bgVBO);
    gl.deleteVertexArray(this.bgVAO);
    gl.deleteProgram(this.bgProgram);
  }
}
