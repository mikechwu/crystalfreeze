# CrystalFreeze

Interactive ice crystallization simulation running entirely in the browser. Watch water molecules freeze into hexagonal ice crystals in real time — click anywhere to seed nucleation.

Built with WebGL2 point sprites, Langevin molecular dynamics, and quaternion-based 3D molecule orientation.

## Demo

Click/tap the canvas to place a nucleation seed. Ice grows outward from the seed as a hexagonal crystal lattice. Adjust temperature to melt ice back to liquid.

## Features

- **Real-time molecular dynamics** — 5,000 water molecules with O-O repulsion, H-O hydrogen bonding, and thermal noise
- **Crystallization physics** — freezing front propagation, hexagonal lattice formation, temperature-dependent melting
- **3D depth perception** — perspective scaling, depth-sorted rendering, volumetric opacity gradients
- **Per-molecule 3D orientation** — quaternion rotation with depth-correct H-atom occlusion via fragment shader
- **Two render modes** — Glossy (Blinn-Phong shading, Fresnel rim, ice specularity) and Minimal (flat-color 3D molecules)
- **Dark / Light themes** — full glassmorphic UI with theme-aware molecule color palettes
- **Chemical / Stylized colors** — red-white (CPK) or blue-white aesthetic
- **Temperature control** — slide from cold (freezing) to warm (melting) with realistic boundary-first melt
- **Touch support** — works on desktop and mobile
- **No server required** — fully client-side, static deployment

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in a WebGL2-capable browser. Click the canvas to seed crystallization.

## Build

```bash
npm run build      # TypeScript check + Vite production bundle
npm run preview    # Preview the built output locally
```

Output goes to `dist/` — deploy to any static host (Vercel, Netlify, GitHub Pages, etc.).

## Controls

| Control | Action |
|---------|--------|
| Click / Tap | Place nucleation seed (up to 5) |
| Temperature slider | Cold (freezing) to Warm (melting) |
| Visual Style | Glossy or Minimal rendering |
| Theme | Dark or Light background |
| Molecule Colors | Chemical (red/white) or Stylized (blue/white) |
| Advanced > Freeze Speed | x1 / x5 / x20 crystallization rate |
| Advanced > Propagation Rate | Fine-tune freeze front speed |

## Requirements

- Modern browser with WebGL2 (Chrome, Firefox, Safari 15+, Edge)
- Node.js 18+ for development

## Tech Stack

- **TypeScript** — strict mode, ES2020 target
- **Vite** — dev server + production bundler
- **WebGL2** — point sprites with per-pixel fragment shading
- **GLSL 300 es** — inline shaders with quaternion rotation (Rodrigues' formula)
- **Langevin dynamics** — overdamped Brownian motion with thermal noise
- **Spatial hashing** — O(1) neighbor lookup for force computation

## License

MIT
