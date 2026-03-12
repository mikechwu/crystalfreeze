export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }

  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSource: string,
  fragSource: string
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSource);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSource);

  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }

  // Clean up shaders (they're linked now)
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  return program;
}

export function getUniformLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name);
  if (loc === null) {
    console.warn(`Uniform '${name}' not found (may be optimized out)`);
  }
  return loc!;
}

export function checkWebGL2Support(): WebGL2RenderingContext | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');

  if (!gl) {
    console.error('WebGL2 is not supported on this device.');
    return null;
  }

  const maxTFComponents = gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS);
  if (maxTFComponents < 10) {
    console.warn('Transform feedback limit too low:', maxTFComponents);
  }

  const maxVaryings = gl.getParameter(gl.MAX_VARYING_VECTORS);
  const maxVertTexUnits = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);

  console.log(`WebGL2 OK: TF=${maxTFComponents}, vary=${maxVaryings}, vtex=${maxVertTexUnits}`);
  return gl;
}
