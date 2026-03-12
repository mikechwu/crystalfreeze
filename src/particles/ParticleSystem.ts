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

  // Interaction scratch arrays (avoid per-frame allocation)
  private fx: Float32Array;
  private fy: Float32Array;
  private torque: Float32Array;
  private spatialHash: SpatialHash;

  // Z-axis angular velocity (stored separately — not needed by GPU)
  private omegaZ: Float32Array;

  // Debug stats
  debugStats = { avgOmega: 0, maxOmega: 0, avgTorque: 0, avgNeighbors: 0 };
  private frameCount = 0;

  constructor(count: number) {
    this.count = count;
    this.data = new Float32Array(count * FLOATS_PER_PARTICLE);
    this.worldWidth = CONFIG.world.width;
    this.worldHeight = CONFIG.world.height;

    this.fx = new Float32Array(count);
    this.fy = new Float32Array(count);
    this.torque = new Float32Array(count);
    this.omegaZ = new Float32Array(count);
    this.spatialHash = new SpatialHash(CONFIG.interaction.cutoff);

    this.initializeParticles();
  }

  private initializeParticles(): void {
    const { slabHalf } = CONFIG.depth;
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
    const { cutoff, sigmaOO, epsilonOO, epsilonHO, bondLen, bondAngleHalf, maxForce, maxTorque } = CONFIG.interaction;
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

        // --- Solid-solid attraction for compact crystal packing ---
        // When both molecules are partially frozen, add a gentle attraction
        // that pulls them toward their mutual equilibrium distance.
        // This improves visible coherence and local packing in the ice.
        const alphaI = d[bi + OFF_ALPHA];
        const alphaJ = d[bj + OFF_ALPHA];
        const solidPair = Math.min(alphaI, alphaJ);
        if (solidPair > 0.1 && r > sigmaOO * 0.9 && r < cutoff) {
          const solidAttract = CONFIG.freeze.solidAttractionStrength;
          // Gentle pull toward lattice-spacing distance
          const targetR = CONFIG.freeze.latticeSpacing;
          const displacement = targetR - r;
          const attractMag = solidAttract * solidPair * solidPair * displacement / targetR;
          const nx = dx / r;
          const ny = dy / r;
          this.fx[i] += attractMag * nx;
          this.fy[i] += attractMag * ny;
          this.fx[j] -= attractMag * nx;
          this.fy[j] -= attractMag * ny;
        }

        // --- H-O attraction: H atoms of i attracted to O of j ---
        const h1dxj = pxj - h1xi;
        const h1dyj = pyj - h1yi;
        // Apply minimum image to H-O distance too
        let h1dx = h1dxj; let h1dy = h1dyj;
        if (h1dx > halfW) h1dx -= W; else if (h1dx < -halfW) h1dx += W;
        if (h1dy > halfH) h1dy -= H; else if (h1dy < -halfH) h1dy += H;
        const h1r2 = h1dx * h1dx + h1dy * h1dy;
        if (h1r2 < cutoff2 && h1r2 > 1.0) {
          const h1r = Math.sqrt(h1r2);
          const attract = epsilonHO * (1.0 - h1r / cutoff);
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
          const attract = epsilonHO * (1.0 - h2r / cutoff);
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

        let jh1dx = pxi - h1xj; let jh1dy = pyi - h1yj;
        if (jh1dx > halfW) jh1dx -= W; else if (jh1dx < -halfW) jh1dx += W;
        if (jh1dy > halfH) jh1dy -= H; else if (jh1dy < -halfH) jh1dy += H;
        const jh1r2 = jh1dx * jh1dx + jh1dy * jh1dy;
        if (jh1r2 < cutoff2 && jh1r2 > 1.0) {
          const jh1r = Math.sqrt(jh1r2);
          const attract = epsilonHO * (1.0 - jh1r / cutoff);
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
          const attract = epsilonHO * (1.0 - jh2r / cutoff);
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
    const { slabHalf, zSpring, zNoiseAmp } = CONFIG.depth;
    const { springConstant, dampingBoost, solidNoiseFraction, orientAlignStrength,
            maxSpringForce, maxVelocity } = CONFIG.freeze;
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

      // Spring-to-lattice force (only when lattice site assigned)
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
        springFx = springConstant * alpha3 * sdx;
        springFy = springConstant * alpha3 * sdy;
        const springMag = Math.sqrt(springFx * springFx + springFy * springFy);
        if (springMag > maxSpringForce) {
          springFx *= maxSpringForce / springMag;
          springFy *= maxSpringForce / springMag;
        }
      }

      // Translational Langevin
      vx = vx * (1.0 - gamma * dt) + (this.fx[i] + springFx) * dt + gaussianRandom() * noiseScale;
      vy = vy * (1.0 - gamma * dt) + (this.fy[i] + springFy) * dt + gaussianRandom() * noiseScale;

      const keScale = 1.0 - alpha2 * 0.3;
      vx *= keScale;
      vy *= keScale;

      const vMag = Math.sqrt(vx * vx + vy * vy);
      if (vMag > maxVelocity) {
        vx *= maxVelocity / vMag;
        vy *= maxVelocity / vMag;
      }

      px += vx * dtStep;
      py += vy * dtStep;
      px = ((px % W) + W) % W;
      py = ((py % H) + H) % H;

      // Z-depth dynamics
      const zNoise = gaussianRandom() * zNoiseAmp * dt * noiseFraction;
      let zTarget = 0;
      let zLayerStrength = 0;
      if (alpha > 0.4) {
        const layerSpacing = slabHalf * 0.33;
        zTarget = Math.round(z / layerSpacing) * layerSpacing;
        const solidFrac = (alpha - 0.4) / 0.6;
        zLayerStrength = solidFrac * solidFrac * 0.12;
      }
      const zRestore = -zSpring * z + zLayerStrength * (zTarget - z);
      z += (zRestore + zNoise) * dtStep;
      z = Math.max(-slabHalf, Math.min(slabHalf, z));

      // --- Quaternion 3D orientation ---
      let qx = this.data[base + OFF_QX];
      let qy = this.data[base + OFF_QY];
      let qz = this.data[base + OFF_QZ];
      let qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));

      // Extract yaw for alignment torque
      const orient = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));

      // Orientation alignment torque (Z-axis, quadratic alpha onset)
      let alignTorque = 0;
      if (alpha > 0.01) {
        const targetOrient = Math.round(orient / (Math.PI / 3)) * (Math.PI / 3);
        let dOrient = targetOrient - orient;
        while (dOrient > Math.PI) dOrient -= 2 * Math.PI;
        while (dOrient < -Math.PI) dOrient += 2 * Math.PI;
        alignTorque = orientAlignStrength * alpha2 * dOrient;
      }

      // Z-axis Langevin dynamics (inertial spin)
      const gammaRotEff = gammaRot * (1.0 + alpha2 * dampingBoost * 0.5);
      let omega = this.omegaZ[i];
      omega = omega * (1.0 - gammaRotEff * dt) + (this.torque[i] + alignTorque) * dt + gaussianRandom() * noiseRotScale;
      omega *= keScale;
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

      // Solid alignment: NLERP toward 3D crystal target (yaw + frozen tilt)
      // The target includes per-molecule pitch/roll derived from lattice position
      // so frozen molecules retain 3D depth variation instead of collapsing to planar.
      if (alpha > 0.3) {
        const targetYaw = Math.round(orient / (Math.PI / 3)) * (Math.PI / 3);

        // Compute deterministic frozen tilt from equilibrium position.
        // High amplitudes with guaranteed minimum floor ensure visible 3D:
        // bond foreshortening + atom depth-sorting are perceptible to users.
        const eqX = this.data[base + OFF_EQ_X];
        const eqY = this.data[base + OFF_EQ_Y];
        const hasSite = this.data[base + OFF_SEED_ID] >= 0;
        const tiltSeed = hasSite
          ? (eqX * 7.31 + eqY * 13.97)
          : (px * 7.31 + py * 13.97);
        // Pitch: guaranteed ±[0.6, 1.2] rad (34°–69°) — strong bond foreshortening
        const rawPitch = Math.sin(tiltSeed);
        const frozenPitch = Math.sign(rawPitch || 1) * (0.6 + Math.abs(rawPitch) * 0.6);
        // Roll: ±[0.3, 0.7] rad (17°–40°) — visible y-axis compression
        const rawRoll = Math.cos(tiltSeed * 1.7);
        const frozenRoll = Math.sign(rawRoll || 1) * (0.3 + Math.abs(rawRoll) * 0.4);

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
        const lerpFactor = solidFrac * solidFrac * 0.06 * dtStep;
        nqw = nqw + (stw - nqw) * lerpFactor;
        nqx = nqx + (stx - nqx) * lerpFactor;
        nqy = nqy + (sty - nqy) * lerpFactor;
        nqz = nqz + (stz - nqz) * lerpFactor;
      }

      // Renormalize and ensure canonical hemisphere (qw >= 0)
      const norm = 1.0 / Math.sqrt(nqw * nqw + nqx * nqx + nqy * nqy + nqz * nqz);
      const sign = nqw >= 0 ? norm : -norm;
      qx = nqx * sign;
      qy = nqy * sign;
      qz = nqz * sign;

      // Debug stats
      const absOmega = Math.abs(omega);
      sumOmega += absOmega;
      if (absOmega > maxOmega) maxOmega = absOmega;
      sumTorque += Math.abs(this.torque[i]);

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
  }

  private logDebugStats(): void {
    const s = this.debugStats;
    console.log(
      `[Rotation] avgω=${s.avgOmega.toFixed(3)} maxω=${s.maxOmega.toFixed(3)} ` +
      `avgτ=${s.avgTorque.toFixed(3)} avgNeighbors=${s.avgNeighbors.toFixed(1)}`
    );
  }
}

function gaussianRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2.0 * Math.PI * u2);
}
