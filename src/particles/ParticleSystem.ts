import { CONFIG } from '../config';
import { SpatialHash } from '../utils/SpatialHash';

// 12 floats per particle: position(2), velocity(2), alpha_seed(2), equilibrium(2), depth_orient(2), omega_flags(2)
export const FLOATS_PER_PARTICLE = 12;

// Offsets into the float array
export const OFF_PX = 0;
export const OFF_PY = 1;
export const OFF_VX = 2;
export const OFF_VY = 3;
export const OFF_ALPHA = 4;
export const OFF_SEED_ID = 5;
export const OFF_EQ_X = 6;
export const OFF_EQ_Y = 7;
export const OFF_Z = 8;
export const OFF_QX = 9;       // quaternion x component (qw derived as sqrt(1-qx²-qy²-qz²))
export const OFF_QY = 10;      // quaternion y component
export const OFF_QZ = 11;      // quaternion z component

export class ParticleSystem {
  count: number;
  data: Float32Array;

  readonly worldWidth: number;
  readonly worldHeight: number;

  // Equilibrium Z position for frozen molecules (separate from GPU buffer).
  // Set by FreezeSystem/SeedRegistry when a 3D lattice site is assigned.
  eqZ: Float32Array;

  // Interaction scratch arrays (avoid per-frame allocation)
  private fx: Float32Array;
  private fy: Float32Array;
  private torque: Float32Array;
  private spatialHash: SpatialHash;

  // Z-axis angular velocity (stored separately — not needed by GPU)
  private omegaZ: Float32Array;

  // Frozen reference orientation for libration model.
  // Recorded once from local H-bond network geometry when molecule first freezes.
  // Used as the equilibrium orientation for small-angle librational oscillation.
  private frozenRefYaw: Float32Array;
  private frozenRefSet: Uint8Array;

  // Debug stats
  debugStats = {
    avgOmega: 0, maxOmega: 0, avgTorque: 0, avgNeighbors: 0,
    frozenAvgErot: 0, liquidAvgErot: 0, frozenCount: 0,
  };
  private frameCount = 0;

  constructor(count: number) {
    this.count = count;
    this.data = new Float32Array(count * FLOATS_PER_PARTICLE);
    this.worldWidth = CONFIG.world.width;
    this.worldHeight = CONFIG.world.height;

    this.eqZ = new Float32Array(count);
    this.fx = new Float32Array(count);
    this.fy = new Float32Array(count);
    this.torque = new Float32Array(count);
    this.omegaZ = new Float32Array(count);
    this.spatialHash = new SpatialHash(CONFIG.interaction.cutoff);
    this.frozenRefYaw = new Float32Array(count);
    this.frozenRefSet = new Uint8Array(count);

    this.initializeParticles();
  }

  /** Compute the Z slab half-extent from lattice parameters. */
  getSlabHalf(): number {
    const maxLayers = Math.min(4, CONFIG.freeze.zLayerCount + CONFIG.freeze.zLayerVariation);
    const halfDepth = (maxLayers - 1) * CONFIG.freeze.zLayerSpacing * 0.5;
    return halfDepth + CONFIG.freeze.zSlabMargin;
  }

  private initializeParticles(): void {
    const slabHalf = this.getSlabHalf();
    const sigma = CONFIG.interaction.sigmaOO;

    // Hexagonal grid initialization — eliminates density fluctuations
    // that cause droplet-like clustering with random placement.
    const spacing = sigma * 1.05;  // slightly > σ for liquid-like spacing
    const rowSpacing = spacing * 0.866; // sqrt(3)/2
    const cols = Math.floor(this.worldWidth / spacing);

    for (let i = 0; i < this.count; i++) {
      const base = i * FLOATS_PER_PARTICLE;

      const row = Math.floor(i / cols);
      const col = i % cols;
      const xOffset = (row % 2) * spacing * 0.5; // hex stagger
      const gx = col * spacing + xOffset + spacing * 0.5;
      const gy = row * rowSpacing + rowSpacing * 0.5;

      // Small random perturbation (±15% of spacing) for liquid disorder
      this.data[base + OFF_PX] = ((gx + (Math.random() - 0.5) * spacing * 0.3) % this.worldWidth + this.worldWidth) % this.worldWidth;
      this.data[base + OFF_PY] = ((gy + (Math.random() - 0.5) * spacing * 0.3) % this.worldHeight + this.worldHeight) % this.worldHeight;

      const speed = CONFIG.dynamics.kT;
      this.data[base + OFF_VX] = (Math.random() - 0.5) * speed;
      this.data[base + OFF_VY] = (Math.random() - 0.5) * speed;

      this.data[base + OFF_ALPHA] = 0.0;
      this.data[base + OFF_SEED_ID] = -1.0;
      this.data[base + OFF_EQ_X] = 0.0;
      this.data[base + OFF_EQ_Y] = 0.0;

      this.data[base + OFF_Z] = (Math.random() - 0.5) * 2.0 * slabHalf;

      // Uniform random quaternion on SO(3) — true 3D orientation
      const u1 = Math.random();
      const u2 = Math.random();
      const u3 = Math.random();
      const s1 = Math.sqrt(1 - u1);
      const s2 = Math.sqrt(u1);
      let qw = s1 * Math.sin(2 * Math.PI * u2);
      let qx = s1 * Math.cos(2 * Math.PI * u2);
      let qy = s2 * Math.sin(2 * Math.PI * u3);
      let qz = s2 * Math.cos(2 * Math.PI * u3);
      // Canonical hemisphere: ensure qw >= 0 so we can derive it from qx,qy,qz
      if (qw < 0) { qw = -qw; qx = -qx; qy = -qy; qz = -qz; }
      this.data[base + OFF_QX] = qx;
      this.data[base + OFF_QY] = qy;
      this.data[base + OFF_QZ] = qz;
      this.omegaZ[i] = (Math.random() - 0.5) * 0.5;
    }
  }

  /**
   * Compute preferred frozen yaw from local H-bond network geometry.
   * The molecule's bisector (direction both H atoms open toward) should face
   * the average direction of its nearest frozen neighbors, quantized to 60°
   * multiples for hex ice symmetry. This ties libration to local ice structure
   * rather than an arbitrary visual target.
   */
  private computeReferenceYaw(i: number): number {
    const bi = i * FLOATS_PER_PARTICLE;
    const px = this.data[bi + OFF_PX];
    const py = this.data[bi + OFF_PY];
    const W = this.worldWidth;
    const H = this.worldHeight;
    const halfW = W * 0.5;
    const halfH = H * 0.5;

    const neighbors = this.spatialHash.query(px, py, CONFIG.interaction.cutoff);

    // Collect unit direction vectors to frozen/freezing neighbors
    const dirs: { dx: number; dy: number; dist: number }[] = [];
    for (let ni = 0; ni < neighbors.length; ni++) {
      const j = neighbors[ni];
      if (j === i) continue;
      const bj = j * FLOATS_PER_PARTICLE;
      if (this.data[bj + OFF_ALPHA] < 0.25) continue; // skip liquid

      let dx = this.data[bj + OFF_PX] - px;
      let dy = this.data[bj + OFF_PY] - py;
      if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
      if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;

      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.1 && dist < CONFIG.interaction.cutoff) {
        dirs.push({ dx: dx / dist, dy: dy / dist, dist });
      }
    }

    if (dirs.length >= 2) {
      // Average direction to nearest 2-3 frozen neighbors
      dirs.sort((a, b) => a.dist - b.dist);
      const take = Math.min(dirs.length, 3);
      let sumDx = 0, sumDy = 0;
      for (let k = 0; k < take; k++) {
        sumDx += dirs[k].dx;
        sumDy += dirs[k].dy;
      }
      const avgAngle = Math.atan2(sumDy, sumDx);
      // Quantize to nearest 60° for hex symmetry
      return Math.round(avgAngle / (Math.PI / 3)) * (Math.PI / 3);
    }

    // Fallback: quantize current orientation to nearest 60°
    const qx = this.data[bi + OFF_QX];
    const qy = this.data[bi + OFF_QY];
    const qz = this.data[bi + OFF_QZ];
    const qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));
    const orient = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
    return Math.round(orient / (Math.PI / 3)) * (Math.PI / 3);
  }

  update(dt: number): void {
    // Phase 1: compute neighbor interactions (forces + torques)
    this.computeInteractions();

    // Phase 2: integrate dynamics
    this.integrate(dt);

    // Debug logging
    this.frameCount++;
    if (this.frameCount % CONFIG.debug.logInterval === 0) {
      this.logDebugStats();
    }
  }

  private computeInteractions(): void {
    const { cutoff, sigmaOO, epsilonOO, epsilonHO, bondLen, bondAngleHalf, maxForce, maxTorque,
            hBondAngularBias, hBondAlphaMin, sigmaHH, epsilonHH } = CONFIG.interaction;
    const W = this.worldWidth;
    const H = this.worldHeight;
    const halfW = W * 0.5;
    const halfH = H * 0.5;
    const cutoff2 = cutoff * cutoff;
    const sigma2 = sigmaOO * sigmaOO;
    const N = this.count;
    const d = this.data;

    // Clear forces and torques
    this.fx.fill(0);
    this.fy.fill(0);
    this.torque.fill(0);

    // Rebuild spatial hash
    this.spatialHash.clear();
    for (let i = 0; i < N; i++) {
      const base = i * FLOATS_PER_PARTICLE;
      this.spatialHash.insert(d[base + OFF_PX], d[base + OFF_PY], i);
    }

    let totalNeighbors = 0;

    for (let i = 0; i < N; i++) {
      const bi = i * FLOATS_PER_PARTICLE;
      const pxi = d[bi + OFF_PX];
      const pyi = d[bi + OFF_PY];

      // Extract yaw from quaternion for 2D interaction H atom positions
      const qxi = d[bi + OFF_QX];
      const qyi = d[bi + OFF_QY];
      const qzi = d[bi + OFF_QZ];
      const qwi = Math.sqrt(Math.max(0, 1 - qxi * qxi - qyi * qyi - qzi * qzi));
      const oi = Math.atan2(2 * (qwi * qzi + qxi * qyi), 1 - 2 * (qyi * qyi + qzi * qzi));

      // H atom positions for molecule i
      const h1xi = pxi + Math.cos(oi + bondAngleHalf) * bondLen;
      const h1yi = pyi + Math.sin(oi + bondAngleHalf) * bondLen;
      const h2xi = pxi + Math.cos(oi - bondAngleHalf) * bondLen;
      const h2yi = pyi + Math.sin(oi - bondAngleHalf) * bondLen;

      const neighbors = this.spatialHash.query(pxi, pyi, cutoff);
      totalNeighbors += neighbors.length;

      for (let ni = 0; ni < neighbors.length; ni++) {
        const j = neighbors[ni];
        if (j <= i) continue; // avoid double-counting

        const bj = j * FLOATS_PER_PARTICLE;
        const pxj = d[bj + OFF_PX];
        const pyj = d[bj + OFF_PY];

        // Extract yaw from quaternion for molecule j
        const qxj = d[bj + OFF_QX];
        const qyj = d[bj + OFF_QY];
        const qzj = d[bj + OFF_QZ];
        const qwj = Math.sqrt(Math.max(0, 1 - qxj * qxj - qyj * qyj - qzj * qzj));
        const oj = Math.atan2(2 * (qwj * qzj + qxj * qyj), 1 - 2 * (qyj * qyj + qzj * qzj));

        // Minimum image distance (periodic)
        let dx = pxj - pxi;
        let dy = pyj - pyi;
        if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
        if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;

        const r2 = dx * dx + dy * dy;
        if (r2 > cutoff2 || r2 < 1.0) continue;

        const r = Math.sqrt(r2);

        // --- O-O soft repulsion ---
        if (r2 < sigma2) {
          const overlap = 1.0 - r / sigmaOO;
          const forceMag = epsilonOO * overlap * overlap;
          const nx = dx / r;
          const ny = dy / r;
          this.fx[i] -= forceMag * nx;
          this.fy[i] -= forceMag * ny;
          this.fx[j] += forceMag * nx;
          this.fy[j] += forceMag * ny;
        }

        // --- Lattice-aware neighbor spring for frozen pairs (3D) ---
        // Only connect molecules whose equilibrium lattice sites are
        // approximately latticeSpacing apart (true lattice neighbors).
        // Uses 3D eq-site distance to handle inter-layer neighbors.
        const alphaI = d[bi + OFF_ALPHA];
        const alphaJ = d[bj + OFF_ALPHA];
        const solidPair = Math.min(alphaI, alphaJ);
        if (solidPair > 0.4 && r > sigmaOO * 0.5 && r < cutoff) {
          const targetR = CONFIG.freeze.latticeSpacing;
          const hasSiteI = d[bi + OFF_SEED_ID] >= 0;
          const hasSiteJ = d[bj + OFF_SEED_ID] >= 0;
          let isLatticeNeighbor = false;
          if (hasSiteI && hasSiteJ) {
            let edx = d[bj + OFF_EQ_X] - d[bi + OFF_EQ_X];
            let edy = d[bj + OFF_EQ_Y] - d[bi + OFF_EQ_Y];
            if (edx > halfW) edx -= W; else if (edx < -halfW) edx += W;
            if (edy > halfH) edy -= H; else if (edy < -halfH) edy += H;
            const edz = this.eqZ[j] - this.eqZ[i];
            const eqDist = Math.sqrt(edx * edx + edy * edy + edz * edz);
            // 3D lattice neighbors: in-plane (~latticeSpacing) or inter-layer
            const zSpacing = CONFIG.freeze.zLayerSpacing;
            const maxDist = Math.sqrt(targetR * targetR + zSpacing * zSpacing) * 1.2;
            isLatticeNeighbor = eqDist < maxDist && eqDist > targetR * 0.3;
          }
          if (isLatticeNeighbor) {
            // Morse-like neighbor spring: saturates at large displacement
            // Prevents violent correction forces from creating jitter
            const displacement = r - targetR;
            const morseW = 6.0; // saturation width
            const morseD = Math.tanh(displacement / morseW) * morseW;
            const springForce = CONFIG.freeze.neighborSpringK * solidPair * solidPair * morseD;
            const nx = dx / r;
            const ny = dy / r;
            this.fx[i] += springForce * nx;
            this.fy[i] += springForce * ny;
            this.fx[j] -= springForce * nx;
            this.fy[j] -= springForce * ny;
          }
        }

        // --- H-O attraction: H atoms of i attracted to O of j ---
        // Directional bias: for frozen pairs, modulate by alignment of bond→target
        const useAngularBias = solidPair > hBondAlphaMin;

        const h1dxj = pxj - h1xi;
        const h1dyj = pyj - h1yi;
        // Apply minimum image to H-O distance too
        let h1dx = h1dxj; let h1dy = h1dyj;
        if (h1dx > halfW) h1dx -= W; else if (h1dx < -halfW) h1dx += W;
        if (h1dy > halfH) h1dy -= H; else if (h1dy < -halfH) h1dy += H;
        const h1r2 = h1dx * h1dx + h1dy * h1dy;
        if (h1r2 < cutoff2 && h1r2 > 1.0) {
          const h1r = Math.sqrt(h1r2);
          let attract = epsilonHO * (1.0 - h1r / cutoff);
          // Angular bias: favor H atoms pointing toward target O
          if (useAngularBias) {
            const bx1 = h1xi - pxi, by1 = h1yi - pyi;
            const bl1 = Math.sqrt(bx1 * bx1 + by1 * by1);
            if (bl1 > 0.01) {
              const cosA = (bx1 * h1dx + by1 * h1dy) / (bl1 * h1r);
              attract *= 1.0 - hBondAngularBias + hBondAngularBias * Math.max(0, cosA);
            }
          }
          const fnx = attract * h1dx / h1r;
          const fny = attract * h1dy / h1r;
          this.fx[i] += fnx;
          this.fy[i] += fny;
          this.fx[j] -= fnx;
          this.fy[j] -= fny;
          // Torque on i: r_arm × F (2D cross product)
          const rx1 = h1xi - pxi;
          const ry1 = h1yi - pyi;
          this.torque[i] += rx1 * fny - ry1 * fnx;
        }

        const h2dxj = pxj - h2xi;
        const h2dyj = pyj - h2yi;
        let h2dx = h2dxj; let h2dy = h2dyj;
        if (h2dx > halfW) h2dx -= W; else if (h2dx < -halfW) h2dx += W;
        if (h2dy > halfH) h2dy -= H; else if (h2dy < -halfH) h2dy += H;
        const h2r2 = h2dx * h2dx + h2dy * h2dy;
        if (h2r2 < cutoff2 && h2r2 > 1.0) {
          const h2r = Math.sqrt(h2r2);
          let attract = epsilonHO * (1.0 - h2r / cutoff);
          if (useAngularBias) {
            const bx2 = h2xi - pxi, by2 = h2yi - pyi;
            const bl2 = Math.sqrt(bx2 * bx2 + by2 * by2);
            if (bl2 > 0.01) {
              const cosA = (bx2 * h2dx + by2 * h2dy) / (bl2 * h2r);
              attract *= 1.0 - hBondAngularBias + hBondAngularBias * Math.max(0, cosA);
            }
          }
          const fnx = attract * h2dx / h2r;
          const fny = attract * h2dy / h2r;
          this.fx[i] += fnx;
          this.fy[i] += fny;
          this.fx[j] -= fnx;
          this.fy[j] -= fny;
          const rx2 = h2xi - pxi;
          const ry2 = h2yi - pyi;
          this.torque[i] += rx2 * fny - ry2 * fnx;
        }

        // --- H atoms of j attracted to O of i ---
        const h1xj = pxj + Math.cos(oj + bondAngleHalf) * bondLen;
        const h1yj = pyj + Math.sin(oj + bondAngleHalf) * bondLen;
        const h2xj = pxj + Math.cos(oj - bondAngleHalf) * bondLen;
        const h2yj = pyj + Math.sin(oj - bondAngleHalf) * bondLen;

        // --- H-H soft repulsion (4 pairs: H1i-H1j, H1i-H2j, H2i-H1j, H2i-H2j) ---
        // Prevents hydrogen collapse in clusters. Same model as O-O repulsion.
        const hhPairs: [number, number, number, number][] = [
          [h1xi, h1yi, h1xj, h1yj],
          [h1xi, h1yi, h2xj, h2yj],
          [h2xi, h2yi, h1xj, h1yj],
          [h2xi, h2yi, h2xj, h2yj],
        ];
        for (let hp = 0; hp < 4; hp++) {
          const [hxi, hyi, hxj, hyj] = hhPairs[hp];
          let hhdx = hxj - hxi;
          let hhdy = hyj - hyi;
          if (hhdx > halfW) hhdx -= W; else if (hhdx < -halfW) hhdx += W;
          if (hhdy > halfH) hhdy -= H; else if (hhdy < -halfH) hhdy += H;
          const hhr2 = hhdx * hhdx + hhdy * hhdy;
          if (hhr2 < sigmaHH * sigmaHH && hhr2 > 0.5) {
            const hhr = Math.sqrt(hhr2);
            const hhOverlap = 1.0 - hhr / sigmaHH;
            const hhForceMag = epsilonHH * hhOverlap * hhOverlap;
            const hhnx = hhdx / hhr;
            const hhny = hhdy / hhr;
            // Translational force (Newton's 3rd law)
            this.fx[i] -= hhForceMag * hhnx;
            this.fy[i] -= hhForceMag * hhny;
            this.fx[j] += hhForceMag * hhnx;
            this.fy[j] += hhForceMag * hhny;
            // Torque on molecule i from H atom arm
            const armIx = hxi - pxi, armIy = hyi - pyi;
            this.torque[i] += armIx * (-hhForceMag * hhny) - armIy * (-hhForceMag * hhnx);
            // Torque on molecule j from H atom arm
            const armJx = hxj - pxj, armJy = hyj - pyj;
            this.torque[j] += armJx * (hhForceMag * hhny) - armJy * (hhForceMag * hhnx);
          }
        }

        let jh1dx = pxi - h1xj; let jh1dy = pyi - h1yj;
        if (jh1dx > halfW) jh1dx -= W; else if (jh1dx < -halfW) jh1dx += W;
        if (jh1dy > halfH) jh1dy -= H; else if (jh1dy < -halfH) jh1dy += H;
        const jh1r2 = jh1dx * jh1dx + jh1dy * jh1dy;
        if (jh1r2 < cutoff2 && jh1r2 > 1.0) {
          const jh1r = Math.sqrt(jh1r2);
          let attract = epsilonHO * (1.0 - jh1r / cutoff);
          if (useAngularBias) {
            const bxj1 = h1xj - pxj, byj1 = h1yj - pyj;
            const blj1 = Math.sqrt(bxj1 * bxj1 + byj1 * byj1);
            if (blj1 > 0.01) {
              const cosA = (bxj1 * jh1dx + byj1 * jh1dy) / (blj1 * jh1r);
              attract *= 1.0 - hBondAngularBias + hBondAngularBias * Math.max(0, cosA);
            }
          }
          const fnx = attract * jh1dx / jh1r;
          const fny = attract * jh1dy / jh1r;
          this.fx[j] += fnx;
          this.fy[j] += fny;
          this.fx[i] -= fnx;
          this.fy[i] -= fny;
          const rx = h1xj - pxj;
          const ry = h1yj - pyj;
          this.torque[j] += rx * fny - ry * fnx;
        }

        let jh2dx = pxi - h2xj; let jh2dy = pyi - h2yj;
        if (jh2dx > halfW) jh2dx -= W; else if (jh2dx < -halfW) jh2dx += W;
        if (jh2dy > halfH) jh2dy -= H; else if (jh2dy < -halfH) jh2dy += H;
        const jh2r2 = jh2dx * jh2dx + jh2dy * jh2dy;
        if (jh2r2 < cutoff2 && jh2r2 > 1.0) {
          const jh2r = Math.sqrt(jh2r2);
          let attract = epsilonHO * (1.0 - jh2r / cutoff);
          if (useAngularBias) {
            const bxj2 = h2xj - pxj, byj2 = h2yj - pyj;
            const blj2 = Math.sqrt(bxj2 * bxj2 + byj2 * byj2);
            if (blj2 > 0.01) {
              const cosA = (bxj2 * jh2dx + byj2 * jh2dy) / (blj2 * jh2r);
              attract *= 1.0 - hBondAngularBias + hBondAngularBias * Math.max(0, cosA);
            }
          }
          const fnx = attract * jh2dx / jh2r;
          const fny = attract * jh2dy / jh2r;
          this.fx[j] += fnx;
          this.fy[j] += fny;
          this.fx[i] -= fnx;
          this.fy[i] -= fny;
          const rx = h2xj - pxj;
          const ry = h2yj - pyj;
          this.torque[j] += rx * fny - ry * fnx;
        }
      }
    }

    // Clamp forces and torques for stability
    for (let i = 0; i < N; i++) {
      const fm = Math.sqrt(this.fx[i] * this.fx[i] + this.fy[i] * this.fy[i]);
      if (fm > maxForce) {
        this.fx[i] *= maxForce / fm;
        this.fy[i] *= maxForce / fm;
      }
      if (this.torque[i] > maxTorque) this.torque[i] = maxTorque;
      if (this.torque[i] < -maxTorque) this.torque[i] = -maxTorque;
    }

    // Store avg neighbors for debug
    this.debugStats.avgNeighbors = totalNeighbors / Math.max(N, 1);
  }

  private integrate(dt: number): void {
    const { kT, gammaLiquid, gammaRot, noiseRot } = CONFIG.dynamics;
    const { zSpring, zNoiseAmp } = CONFIG.depth;
    const slabHalf = this.getSlabHalf();
    const { springConstant, dampingBoost, solidNoiseFraction, orientAlignStrength,
            maxSpringForce, maxVelocity, freezeDamping, zSpringK } = CONFIG.freeze;
    const W = this.worldWidth;
    const H = this.worldHeight;
    const halfW = W * 0.5;
    const halfH = H * 0.5;

    const noiseScaleBase = Math.sqrt(2.0 * kT * gammaLiquid * dt);
    const noiseRotBase = noiseRot * Math.sqrt(dt);
    const dtStep = dt * 60.0;

    let sumOmega = 0;
    let maxOmega = 0;
    let sumTorque = 0;
    let frozenErotSum = 0;
    let liquidErotSum = 0;
    let frozenCount = 0;
    let liquidCount = 0;

    for (let i = 0; i < this.count; i++) {
      const base = i * FLOATS_PER_PARTICLE;

      let px = this.data[base + OFF_PX];
      let py = this.data[base + OFF_PY];
      let vx = this.data[base + OFF_VX];
      let vy = this.data[base + OFF_VY];
      const alpha = this.data[base + OFF_ALPHA];
      let z = this.data[base + OFF_Z];

      const alpha2 = alpha * alpha;
      const alpha3 = alpha2 * alpha;

      const gamma = gammaLiquid * (1.0 + alpha2 * dampingBoost);
      const noiseFraction = 1.0 - alpha2 * (1.0 - solidNoiseFraction);
      const noiseScale = noiseScaleBase * noiseFraction;
      const noiseRotScale = noiseRotBase * noiseFraction;

      // Spring-to-lattice force — Morse-like potential for softer behavior.
      // Hookean springs have constant stiffness → violent correction at large displacement.
      // Morse-like: F = k * tanh(d/σ) * σ — linear near equilibrium, saturates at large d.
      // This reduces high-frequency jitter while preserving structural order.
      let springFx = 0;
      let springFy = 0;
      const hasSite = this.data[base + OFF_SEED_ID] >= 0;
      if (alpha > 0.01 && hasSite) {
        const eqX = this.data[base + OFF_EQ_X];
        const eqY = this.data[base + OFF_EQ_Y];
        let sdx = eqX - px;
        let sdy = eqY - py;
        if (sdx > halfW) sdx -= W; else if (sdx < -halfW) sdx += W;
        if (sdy > halfH) sdy -= H; else if (sdy < -halfH) sdy += H;
        const sDist = Math.sqrt(sdx * sdx + sdy * sdy);
        if (sDist > 0.01) {
          // Morse-like spring: tanh saturation at morseWidth pixels displacement
          // Near equilibrium (d << morseWidth): F ≈ k * α³ * d (linear, like Hookean)
          // At large displacement (d >> morseWidth): F ≈ k * α³ * morseWidth (saturated)
          const morseWidth = 8.0; // saturation width in px
          const latticeFade = 1.0 - alpha * 0.65;
          const morseScale = Math.tanh(sDist / morseWidth) * morseWidth / sDist;
          const fMag = springConstant * alpha3 * latticeFade * morseScale * sDist;
          springFx = fMag * (sdx / sDist);
          springFy = fMag * (sdy / sDist);
          const springMag = Math.abs(fMag);
          if (springMag > maxSpringForce) {
            springFx *= maxSpringForce / springMag;
            springFy *= maxSpringForce / springMag;
          }
        }
      }

      // Semi-implicit Euler (velocity Verlet variant) — unconditionally stable.
      //
      // Standard explicit Euler: v += F*dt, x += v*dt (OLD — unstable for stiff springs)
      // Semi-implicit: v += F*dt (with damping), x += v_new*dt (uses UPDATED velocity)
      //
      // The key stability improvement: position update uses the NEW velocity that
      // already includes damping. This is equivalent to an implicit solve for the
      // damping term, making it unconditionally stable for any damping coefficient.
      //
      // Combined with the Morse-like spring (force saturation), this eliminates
      // the need for the old position-correction hack.

      // Total force on particle
      const totalFx = this.fx[i] + springFx;
      const totalFy = this.fy[i] + springFy;

      // Semi-implicit velocity update: v_new = (v + F*dt + noise) / (1 + γ*dt)
      // This form is unconditionally stable — the (1+γ*dt) denominator
      // is the implicit treatment of the damping term.
      const dampDenom = 1.0 / (1.0 + gamma * dt);
      vx = (vx + totalFx * dt + gaussianRandom() * noiseScale) * dampDenom;
      vy = (vy + totalFy * dt + gaussianRandom() * noiseScale) * dampDenom;

      // KE reduction for frozen molecules
      const keScale = 1.0 - alpha2 * 0.45;
      vx *= keScale;
      vy *= keScale;

      // Freeze damping: overdamp frozen-phase velocities for critical damping
      if (alpha > 0.1) {
        const dampFrac = (alpha - 0.1) / 0.9;
        const freezeDamp = 1.0 - freezeDamping * dampFrac;
        vx *= freezeDamp;
        vy *= freezeDamp;
      }

      const vMag = Math.sqrt(vx * vx + vy * vy);
      if (vMag > maxVelocity) {
        vx *= maxVelocity / vMag;
        vy *= maxVelocity / vMag;
      }

      // Position update uses NEW velocity (semi-implicit)
      px += vx * dtStep;
      py += vy * dtStep;
      px = ((px % W) + W) % W;
      py = ((py % H) + H) % H;

      // Z-depth dynamics — 3D lattice-aware
      // Liquid: gentle spring toward z=0 + thermal noise
      // Frozen: strong spring toward assigned lattice Z layer (from eqZ),
      //         liquid restoring spring fades out so lattice spring dominates
      // Z boundary: elastic rebound (no energy loss), not periodic
      const zNoise = gaussianRandom() * zNoiseAmp * dt * noiseFraction;

      // Liquid restoring force fades as molecule freezes
      const liquidZFade = hasSite ? Math.max(0, 1.0 - alpha * 2.5) : 1.0;
      let zForce = -zSpring * z * liquidZFade;

      // Frozen molecules: spring toward their 3D lattice Z target
      if (alpha > 0.2 && hasSite) {
        const targetZ = this.eqZ[i];
        const zDisp = targetZ - z;
        const solidFrac = (alpha - 0.2) / 0.8;
        // 3D lattice Z spring: ramps from 0 at alpha=0.2 to full at alpha=1
        zForce += zSpringK * solidFrac * solidFrac * zDisp;
      }

      // Semi-implicit Z update: include damping in denominator
      const zDamp = hasSite ? 1.0 + alpha * 0.5 : 1.0;
      z += (zForce + zNoise) * dtStep / zDamp;

      // Elastic rebound at Z boundaries (confined slab, not periodic)
      if (z > slabHalf) { z = 2 * slabHalf - z; }
      else if (z < -slabHalf) { z = -2 * slabHalf - z; }
      z = Math.max(-slabHalf, Math.min(slabHalf, z));

      // --- Quaternion 3D orientation ---
      let qx = this.data[base + OFF_QX];
      let qy = this.data[base + OFF_QY];
      let qz = this.data[base + OFF_QZ];
      let qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));

      // Extract yaw for alignment torque
      const orient = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));

      // Record frozen reference yaw once from local H-bond network geometry.
      // The reference is fixed for the molecule's lifetime in the frozen state,
      // preventing the target-jumping that causes free-rotor behavior when
      // re-computed from current orientation each frame.
      if (alpha > 0.25 && hasSite && !this.frozenRefSet[i]) {
        this.frozenRefYaw[i] = this.computeReferenceYaw(i);
        this.frozenRefSet[i] = 1;
      }

      // Orientation alignment torque (Z-axis, quadratic alpha onset).
      // Uses stored reference yaw (not per-frame quantized) to prevent
      // target-jumping at 60° boundaries that caused free-rotor behavior.
      let alignTorque = 0;
      if (alpha > 0.01) {
        const targetOrient = this.frozenRefSet[i]
          ? this.frozenRefYaw[i]
          : Math.round(orient / (Math.PI / 3)) * (Math.PI / 3);
        let dOrient = targetOrient - orient;
        while (dOrient > Math.PI) dOrient -= 2 * Math.PI;
        while (dOrient < -Math.PI) dOrient += 2 * Math.PI;
        const bulkFade = alpha > 0.8 ? 0.5 : 1.0;
        alignTorque = orientAlignStrength * alpha2 * dOrient * bulkFade;
      }

      // Z-axis Langevin dynamics — damped torsional oscillator model:
      //   I dω/dt = -kθ(θ - θ₀) - c_eff·ω + τ_ext + noise
      // where kθ = orientAlignStrength·α²·bulkFade (restoring torque from alignTorque above),
      //       c_eff = gammaRotEff (Langevin) + keScale + freezeDamping (stacked damping),
      //       τ_ext = suppressed interaction torques (5% at α=1),
      //       θ₀ = frozenRefYaw (fixed reference from H-bond geometry).
      // Semi-implicit Euler: ω_new = ω·(1-c·dt) + τ·dt, unconditionally stable
      // when combined with NLERP orientation correction + angular deviation hard clamp.
      const gammaRotEff = gammaRot * (1.0 + alpha2 * dampingBoost * 0.5);
      let omega = this.omegaZ[i];
      // Suppress interaction torques as molecules freeze:
      // In ice, lattice constraints dominate over molecular H-O/H-H forces.
      // Without suppression, interaction torques from nearby frozen neighbors
      // continuously inject rotational energy because actual positions deviate
      // slightly from equilibrium lattice sites. In large clusters (100+ molecules),
      // even small residual torques from 6 neighbors can accumulate and destabilize.
      // Smooth ramp from 1.0 at alpha=0.3 to 0.05 at alpha=1.0
      let interactionTorque = this.torque[i];
      if (alpha > 0.3) {
        const torqueScale = Math.max(0.05, 1.0 - (alpha - 0.3) * 1.36);
        interactionTorque *= torqueScale;
      }
      // Semi-implicit rotational Euler: ω_new = (ω + τ*dt + noise) / (1 + γ_rot*dt)
      const rotDampDenom = 1.0 / (1.0 + gammaRotEff * dt);
      omega = (omega + (interactionTorque + alignTorque) * dt + gaussianRandom() * noiseRotScale) * rotDampDenom;
      omega *= keScale;

      // Rotational freeze damping: directly damp omega for frozen molecules
      // Matches the translational freezeDamping pattern to prevent runaway spin
      if (alpha > 0.1) {
        const rotDampFrac = (alpha - 0.1) / 0.9;
        omega *= 1.0 - freezeDamping * rotDampFrac;
      }

      // Hard-clamp omega for frozen molecules — librational velocity limit.
      // Dev38: 1.5*(1-0.93α) → 0.105 at α=1 (6°/frame — still too much free rotation)
      // Dev39: 1.0*(1-0.95α) → 0.05 at α=1 (2.9°/frame — physical libration range)
      const maxOmegaFrozen = 1.0 * (1.0 - alpha * 0.95);
      if (Math.abs(omega) > maxOmegaFrozen) {
        omega = Math.sign(omega) * maxOmegaFrozen;
      }

      this.omegaZ[i] = omega;

      // Build small rotation from Z-axis spin + XY Brownian tumbling
      const dAngleZ = omega * dtStep;
      // Tumbling: random rotations around X and Y for true 3D feel
      // Amplitude 0.15 rad/√step gives smooth tumbling; suppressed in solid via noiseFraction
      const tumbleScale = 0.15 * Math.sqrt(dtStep) * noiseFraction;
      const dAngleX = gaussianRandom() * tumbleScale;
      const dAngleY = gaussianRandom() * tumbleScale;

      // Small rotation quaternion (first-order for small angles)
      const halfX = dAngleX * 0.5;
      const halfY = dAngleY * 0.5;
      const halfZ = dAngleZ * 0.5;
      const mag2 = halfX * halfX + halfY * halfY + halfZ * halfZ;
      let dqw: number, dqx: number, dqy: number, dqz: number;
      if (mag2 < 0.01) {
        dqw = 1.0 - mag2 * 0.5;
        dqx = halfX;
        dqy = halfY;
        dqz = halfZ;
      } else {
        const mag = Math.sqrt(mag2);
        const sinc = Math.sin(mag) / mag;
        dqw = Math.cos(mag);
        dqx = halfX * sinc;
        dqy = halfY * sinc;
        dqz = halfZ * sinc;
      }

      // Compose: q_new = q_delta * q_current
      let nqw = dqw * qw - dqx * qx - dqy * qy - dqz * qz;
      let nqx = dqw * qx + dqx * qw + dqy * qz - dqz * qy;
      let nqy = dqw * qy - dqx * qz + dqy * qw + dqz * qx;
      let nqz = dqw * qz + dqx * qy - dqy * qx + dqz * qw;

      // Solid alignment: NLERP toward 3D crystal target (yaw + frozen tilt).
      // Uses the stored frozen reference yaw (same target as alignment torque)
      // to ensure consistent driving toward a fixed equilibrium orientation.
      if (alpha > 0.3) {
        const targetYaw = this.frozenRefSet[i]
          ? this.frozenRefYaw[i]
          : Math.round(orient / (Math.PI / 3)) * (Math.PI / 3);

        // Compute deterministic frozen tilt from equilibrium position.
        // High amplitudes with guaranteed minimum floor ensure visible 3D:
        // bond foreshortening + atom depth-sorting are perceptible to users.
        const eqX = this.data[base + OFF_EQ_X];
        const eqY = this.data[base + OFF_EQ_Y];
        const hasSiteForTilt = this.data[base + OFF_SEED_ID] >= 0;
        const tiltSeed = hasSiteForTilt
          ? (eqX * 7.31 + eqY * 13.97)
          : (px * 7.31 + py * 13.97);
        // Pitch: ±[0.15, 0.45] rad (9°–26°) — subtle bond foreshortening, no Z-stacking appearance
        const rawPitch = Math.sin(tiltSeed);
        const frozenPitch = Math.sign(rawPitch || 1) * (0.15 + Math.abs(rawPitch) * 0.30);
        // Roll: ±[0.1, 0.3] rad (6°–17°) — gentle y-axis depth variation
        const rawRoll = Math.cos(tiltSeed * 1.7);
        const frozenRoll = Math.sign(rawRoll || 1) * (0.1 + Math.abs(rawRoll) * 0.2);

        // Build target quaternion from Euler ZYX: q = q_z(yaw) * q_y(pitch) * q_x(roll)
        const hy = targetYaw * 0.5;
        const hp = frozenPitch * 0.5;
        const hr = frozenRoll * 0.5;
        const cy = Math.cos(hy), sy = Math.sin(hy);
        const cp = Math.cos(hp), sp = Math.sin(hp);
        const cr = Math.cos(hr), sr = Math.sin(hr);
        let tqw = cr * cp * cy + sr * sp * sy;
        let tqx = sr * cp * cy - cr * sp * sy;
        let tqy = cr * sp * cy + sr * cp * sy;
        let tqz = cr * cp * sy - sr * sp * cy;
        if (tqw < 0) { tqw = -tqw; tqx = -tqx; tqy = -tqy; tqz = -tqz; }

        let dot = nqw * tqw + nqx * tqx + nqy * tqy + nqz * tqz;
        let stw = tqw, stx = tqx, sty = tqy, stz = tqz;
        if (dot < 0) { stw = -tqw; stx = -tqx; sty = -tqy; stz = -tqz; dot = -dot; }
        const solidFrac = (alpha - 0.3) / 0.7;
        // Stronger NLERP for tighter libration: 0.50 at α=1 (was 0.15).
        // At 0.15, the NLERP cannot overcome 6°/frame omega-driven rotation.
        // At 0.50, equilibrium deviation = Δ/0.5 ≈ 1-2° — proper libration.
        const lerpFactor = solidFrac * solidFrac * 0.50 * dtStep;
        nqw = nqw + (stw - nqw) * lerpFactor;
        nqx = nqx + (stx - nqx) * lerpFactor;
        nqy = nqy + (sty - nqy) * lerpFactor;
        nqz = nqz + (stz - nqz) * lerpFactor;
      }

      // Angular deviation clamp: enforce maximum librational amplitude.
      // This is the hard limit that prevents large-angle rotation even if
      // dynamics push beyond it. Physically, frozen molecules in ice Ih
      // librate within a few degrees of their equilibrium orientation.
      if (alpha > 0.5 && this.frozenRefSet[i]) {
        // Temporarily normalize to extract current yaw
        const chkNorm = 1.0 / Math.sqrt(nqw * nqw + nqx * nqx + nqy * nqy + nqz * nqz);
        const chkW = nqw * chkNorm;
        const chkX = nqx * chkNorm;
        const chkY = nqy * chkNorm;
        const chkZ = nqz * chkNorm;
        const finalYaw = Math.atan2(2 * (chkW * chkZ + chkX * chkY), 1 - 2 * (chkY * chkY + chkZ * chkZ));

        let yawDev = finalYaw - this.frozenRefYaw[i];
        if (yawDev > Math.PI) yawDev -= 2 * Math.PI;
        if (yawDev < -Math.PI) yawDev += 2 * Math.PI;

        // Max libration angle: 13° at α=0.5, 3° at α=1.0
        const maxLibAngle = (1.0 - alpha) * 0.35 + 0.05;

        if (Math.abs(yawDev) > maxLibAngle) {
          // Apply corrective Z-rotation to bring yaw within bounds
          const correction = Math.sign(yawDev) * maxLibAngle - yawDev;
          const hc = correction * 0.5;
          const cc = Math.cos(hc), sc = Math.sin(hc);
          // Left-multiply by Rz(correction)
          const rw = cc * nqw - sc * nqz;
          const rx = cc * nqx - sc * nqy;
          const ry = cc * nqy + sc * nqx;
          const rz = cc * nqz + sc * nqw;
          nqw = rw; nqx = rx; nqy = ry; nqz = rz;

          // Suppress angular velocity to prevent rebound
          this.omegaZ[i] *= 0.1;
        }
      }

      // Renormalize and ensure canonical hemisphere (qw >= 0)
      const norm = 1.0 / Math.sqrt(nqw * nqw + nqx * nqx + nqy * nqy + nqz * nqz);
      const sign = nqw >= 0 ? norm : -norm;
      qx = nqx * sign;
      qy = nqy * sign;
      qz = nqz * sign;

      // Debug stats — including rotational kinetic energy E_rot = 0.5 * ω²
      const absOmega = Math.abs(omega);
      sumOmega += absOmega;
      if (absOmega > maxOmega) maxOmega = absOmega;
      sumTorque += Math.abs(this.torque[i]);
      const eRot = 0.5 * omega * omega;
      if (alpha > 0.5) {
        frozenErotSum += eRot;
        frozenCount++;
      } else if (alpha < 0.1) {
        liquidErotSum += eRot;
        liquidCount++;
      }

      this.data[base + OFF_PX] = px;
      this.data[base + OFF_PY] = py;
      this.data[base + OFF_VX] = vx;
      this.data[base + OFF_VY] = vy;
      this.data[base + OFF_Z] = z;
      this.data[base + OFF_QX] = qx;
      this.data[base + OFF_QY] = qy;
      this.data[base + OFF_QZ] = qz;
    }

    this.debugStats.avgOmega = sumOmega / this.count;
    this.debugStats.maxOmega = maxOmega;
    this.debugStats.avgTorque = sumTorque / this.count;
    this.debugStats.frozenAvgErot = frozenCount > 0 ? frozenErotSum / frozenCount : 0;
    this.debugStats.liquidAvgErot = liquidCount > 0 ? liquidErotSum / liquidCount : 0;
    this.debugStats.frozenCount = frozenCount;
  }

  private logDebugStats(): void {
    const s = this.debugStats;
    console.log(
      `[Rotation] avgω=${s.avgOmega.toFixed(3)} maxω=${s.maxOmega.toFixed(3)} ` +
      `avgτ=${s.avgTorque.toFixed(3)} avgNeighbors=${s.avgNeighbors.toFixed(1)} ` +
      `frozenErot=${s.frozenAvgErot.toFixed(4)} liquidErot=${s.liquidAvgErot.toFixed(4)} ` +
      `frozen=${s.frozenCount}`
    );
  }
}

function gaussianRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2.0 * Math.PI * u2);
}
