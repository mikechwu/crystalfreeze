# CrystalFreeze

Interactive ice crystallization simulation running entirely in the browser. Watch water molecules freeze into hexagonal ice crystals in real time — click anywhere to seed nucleation.

Built with WebGL2 point sprites, Langevin molecular dynamics, quaternion-based 3D molecule orientation, and an ice-like honeycomb lattice with ABAB stacking.

## Demo

Click/tap the canvas to place a nucleation seed. Ice grows outward from the seed as a 3D honeycomb crystal lattice with open hex rings and genuine depth layering. Adjust temperature to melt ice back to liquid.

## Features

- **Real-time molecular dynamics** — 5,000 water molecules with semi-implicit Euler integration, Morse-like springs, O-O repulsion, H-O hydrogen bonding, H-H repulsion, and thermal noise
- **Ice Ih honeycomb lattice** — proper two-sublattice honeycomb (A+B sites on Bravais lattice), coordination 3 in-plane + max 1 inter-layer = 4 total, ABAB stacking with 2–4 Z layers variable across XY regions
- **Crystallization physics** — freezing front propagation with hex directional bias, 3D lattice-guided growth, temperature-dependent melting
- **3D depth perception** — perspective scaling, depth-sorted rendering, gentle depth opacity (45% min brightness), subtle fog (35% max)
- **Per-molecule 3D orientation** — quaternion rotation with depth-correct H-atom occlusion via fragment shader
- **H-bond visualization** — toggleable hydrogen bond lines using IUPAC donor-acceptor geometry (O···O distance + H-O···O angle criteria)
- **Two render modes** — Glossy (Blinn-Phong shading, Fresnel rim, ice specularity) and Minimal (simple lighting, 3D molecules)
- **Dark / Light themes** — full glassmorphic UI with theme-aware molecule color palettes
- **Chemical / Stylized colors** — red-white (CPK) or blue-white aesthetic
- **Temperature control** — slide from cold (freezing) to warm (melting) with realistic boundary-first melt
- **Tunable molecule rendering** — adjustable O/H atom radii and bond widths
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

### Advanced Controls

| Control | Action |
|---------|--------|
| Freeze Speed | x1 / x5 / x20 crystallization rate |
| Propagation Rate | Fine-tune freeze front speed (0.02%–2.0%) |
| Show H-bonds | Toggle hydrogen bond line visualization |
| O Radius | Oxygen atom display size (0.08–0.40) |
| H Radius | Hydrogen atom display size (0.04–0.30) |
| Bond Width | Covalent O-H bond line width (0.02–0.15) |
| H-Bond Width | Hydrogen bond line width (0.5–3.0) |
| Z Layers | Base number of 3D lattice layers (2–4) |
| Z Layer Spacing | Vertical distance between layers (8–28 px) |

## Requirements

- Modern browser with WebGL2 (Chrome, Firefox, Safari 15+, Edge)
- Node.js 18+ for development

## Tech Stack

- **TypeScript** — strict mode, ES2020 target
- **Vite 6** — dev server + production bundler
- **WebGL2** — point sprites with per-pixel fragment shading
- **GLSL 300 es** — inline shaders with quaternion rotation (Rodrigues' formula)
- **Langevin dynamics** — semi-implicit Euler integration with Morse-like (tanh-saturated) springs
- **Spatial hashing** — O(1) neighbor lookup for force computation and H-bond detection
- **Honeycomb lattice** — two-sublattice ice Ih honeycomb with ABAB stacking (L/3 offset), coordination cap 4 (3 in-plane + 1 inter-layer)

## License

MIT
