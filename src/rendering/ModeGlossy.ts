// Glossy sphere rendering mode
// Shader logic is in shaders.ts (GLOSSY_FRAG)
// This module exists for Phase 6+ when mode-specific settings are needed

export const GLOSSY_MODE_CONFIG = {
  baseSize: 4.0,
  shininess: { liquid: 8.0, solid: 64.0 },
  ambient: 0.25,
  diffuse: 0.6,
  specular: 0.4,
};
