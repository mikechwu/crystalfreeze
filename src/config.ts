// All tunable constants for CrystalFreeze simulation

export type Theme = 'dark' | 'light';
export type MoleculeStyle = 'stylized' | 'chemical';

export const CONFIG = {
  // Particle counts by performance tier
  particles: {
    desktop: 6000,
    mid: 4000,
    low: 2000,
    default: 5000,
  },

  // Thermodynamic state proxy — determines simulation domain size
  // Not exact MD, but physically motivated default liquid state.
  // Domain area = N * moleculeDiskArea / targetPackingFraction
  //   moleculeDiskArea = π * (σ_OO/2)² = π * 12² = 452.4 px²
  //   targetPackingFraction = 0.70 (2D dense liquid at ~1 atm-inspired)
  //   area/molecule = 452.4 / 0.70 = 646 px²
  //   For N=5000: domain area = 3,230,000 → 16:9 = 2397×1348 → rounded to 2400×1350
  state: {
    pressure: 'ambient' as 'ambient',  // 1 atm-inspired default
    sigmaOO: 24.0,                     // O-O diameter defining molecule size (px)
    targetPackingFraction: 0.70,       // 2D area fraction for dense liquid
    // Derived: targetAreaPerMolecule ≈ 646 px², spacing ≈ 25.4 px ≈ 1.06σ
  },

  // Fixed world domain — DERIVED from state model (N, σ, packing)
  // Separate concept from viewport: this is the simulation box, not the view.
  world: {
    width: 2400,   // world-space pixels (derived: sqrt(N * areaPM * 16/9))
    height: 1350,  // world-space pixels (derived: width * 9/16)
  },

  // Viewport zoom — SEPARATE from simulation domain
  // Controls the viewing window into the periodic simulation box.
  // Resizing browser or changing zoom never affects simulation state.
  viewport: {
    zoom: 2.5,     // 2.5x zoom: visible = 768×432 on 1080p (local patch)
  },

  // 3D slab — deep for strong volumetric perspective
  depth: {
    slabHalf: 50.0,       // z range: [-50, +50] — deep slab for clear front/back
    focalLength: 250.0,   // very short focal → strong perspective (40% size variation)
    zSpring: 0.03,        // overdamped O-U restoring spring (soft for wide slab)
    zNoiseAmp: 9.0,       // z noise amplitude — broad continuous depth spread
  },

  // Langevin dynamics
  dynamics: {
    dt: 1.0 / 60.0,
    kT: 2.0,                // thermal energy (liquid)
    gammaLiquid: 1.0,       // translational damping
    baseSpeed: 1.0,
    gammaRot: 1.5,          // rotational damping
    noiseRot: 1.2,          // rotational noise amplitude (rad/s/sqrt(s))
  },

  // Interaction model
  // H-O attraction is torque-dominant: weak translational pull, strong rotational coupling.
  // O-O repulsion maintains uniform spacing. Thermal noise prevents clustering.
  interaction: {
    cutoff: 36.0,           // 1.5σ — only nearest neighbors interact
    sigmaOO: 24.0,          // O-O effective diameter (px)
    epsilonOO: 18.0,        // O-O repulsion — strong enough to maintain uniform spacing
    epsilonHO: 0.5,         // H-O attraction — very weak translational; torque still effective
    bondLen: 12.0,          // O-H bond length in world pixels
    bondAngleHalf: 0.912,   // half of 104.5 degree bond angle (rad)
    maxForce: 40.0,         // force magnitude cap for stability
    maxTorque: 12.0,        // torque magnitude cap
  },

  // Rendering
  render: {
    baseSizeLiquid: 26.0,   // point sprite base size (liquid)
    baseSizeSolid: 34.0,    // point sprite base size (solid) — larger for visible 3D detail
    edgeFadeWidth: 30.0,    // pixels from viewport edge to start fade
    defaultMode: 'glossy' as 'glossy' | 'minimal',
    defaultStyle: 'chemical' as MoleculeStyle,
  },

  // Theme definitions — background and UI
  themes: {
    dark: {
      colorTop: [0.04, 0.05, 0.12] as readonly number[],
      colorBottom: [0.08, 0.10, 0.18] as readonly number[],
      bodyBg: '#0a0e1a',
    },
    light: {
      colorTop: [0.96, 0.97, 0.98] as readonly number[],
      colorBottom: [0.92, 0.94, 0.97] as readonly number[],
      bodyBg: '#f4f5f8',
    },
  },

  // Molecule style palettes — separate from theme (bg)
  // Each style has dark/light variants for readability on both backgrounds
  moleculeStyles: {
    stylized: {
      dark: {
        oxygenColor: [0.20, 0.45, 0.90] as readonly number[],
        hydrogenColor: [0.85, 0.90, 0.98] as readonly number[],
        bondColor: [0.40, 0.55, 0.80] as readonly number[],
      },
      light: {
        oxygenColor: [0.12, 0.35, 0.78] as readonly number[],
        hydrogenColor: [0.50, 0.58, 0.72] as readonly number[],
        bondColor: [0.25, 0.38, 0.60] as readonly number[],
      },
    },
    chemical: {
      dark: {
        oxygenColor: [0.85, 0.12, 0.12] as readonly number[],
        hydrogenColor: [0.92, 0.92, 0.92] as readonly number[],
        bondColor: [0.55, 0.55, 0.55] as readonly number[],
      },
      light: {
        oxygenColor: [0.78, 0.08, 0.08] as readonly number[],
        hydrogenColor: [0.70, 0.70, 0.70] as readonly number[],
        bondColor: [0.40, 0.40, 0.40] as readonly number[],
      },
    },
  },

  // Default theme
  defaultTheme: 'dark' as Theme,

  // Debug / validation
  debug: {
    logInterval: 120,       // frames between debug log outputs
    trackedCount: 0,        // tracked molecules: 0 = off (no orange circles)
    showSeedRadius: false,  // DEBUG: draw seed interaction radius
  },

  // Freezing / crystallization — tighter, more compact structure
  freeze: {
    latticeSpacing: 20.5,          // hex lattice site spacing (σ * 0.854) — tighter crystal
    propagationRadius: 36.0,       // how far freezing influence reaches (1.5σ)
    propagationRate: 0.012,        // alpha increase per frame — visible at x1, scales with speed multiplier
    springConstant: 55.0,          // very strong spring to lattice site — tighter crystal
    dampingBoost: 20.0,            // heavy damping in solid: γ=21 at α=1 (was 14)
    solidNoiseFraction: 0.02,      // 2% thermal noise at α=1 — very tight (was 4%)
    orientAlignStrength: 14.0,     // strong orientation alignment (was 8)
    seedRadius: 60.0,              // initial seed radius (px) — ~2.5σ
    seedAlphaMin: 0.3,             // minimum alpha at seed edge
    maxSpringForce: 100.0,         // cap spring force magnitude — increased for tighter spacing
    maxVelocity: 8.0,              // cap particle velocity for stability
    solidAttractionStrength: 9.0,  // solid-solid neighbor attraction — tighter compactness
    latticeAssignThreshold: 0.15,  // assign lattice site earlier — more time for spring compaction
  },

  // Temperature control — drives freezing/melting balance
  temperature: {
    initial: 0.0,                  // 0.0 = cold (freezing favored), 1.0 = warm (melting)
    freezeThreshold: 0.4,          // below this, freezing proceeds normally
    meltThreshold: 0.6,            // above this, melting begins
    meltRate: 0.002,               // alpha decrease per frame when melting
    freezeBias: 1.0,               // multiplier on propagation rate (scales with coldness)
  },

  // Simulation speed — substeps per rendered frame
  simulation: {
    defaultSpeed: 1,       // x1 = realtime
    speeds: [1, 5, 20],    // available speed multipliers
  },

  // UI
  ui: {
    autoSeedDelay: 6000,
    maxSeeds: 5,
    seedCooldown: 500,
    tapMaxDuration: 300,
    tapMaxDistance: 10,
  },
} as const;
