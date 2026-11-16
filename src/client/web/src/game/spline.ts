// Procedural route + terrain math for the WebGL client.
// Design: the road spline (closed Catmull-Rom loop) DEFINES the elevation
// profile — smooth by construction, realistic grades. Terrain then blends
// toward the dense road polyline via a spatial grid, so the road always sits
// on solid ground while hills and mountains keep their shape further away.

import type { MountainDef, WorldDef } from './worlds';

export interface ControlPoint {
  x: number;
  y: number;
  z: number;
}

export interface RouteSample {
  x: number;
  y: number;
  z: number;
  /** Unit tangent (forward) */
  tx: number;
  tz: number;
  gradient: number;
}

interface Mountain extends MountainDef {
  cx: number;
  cz: number;
}

const TAU = Math.PI * 2;
const SAMPLE_STEP = 4.0;
const ROAD_LIFT = 0.28;
const BLEND_RADIUS = 170.0;

// ------------------------------------------------------------ value noise ---

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 144665)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const u = fade(fx);
  const v = fade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; // 0..1
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let freq = 1 / 420; // base noise wavelength in meters
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x * freq, y * freq, seed + o * 131) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm; // roughly -1..1
}

// ---------------------------------------------------------- control points ---

function buildControlPoints(world: WorldDef): ControlPoint[] {
  const [rx, ry] = world.radius;
  const n = 14;
  const ctrl: ControlPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (TAU * i) / n;
    const y =
      world.climbHeight * Math.exp(-Math.pow(angleDiff(a, TAU * world.climbCenter) / (TAU * world.climbWidth), 2)) +
      Math.sin(a * 3) * 6;
    ctrl.push({ x: Math.cos(a) * rx, y, z: Math.sin(a) * ry });
  }
  return ctrl;
}

function catmull(p0: ControlPoint, p1: ControlPoint, p2: ControlPoint, p3: ControlPoint, t: number): ControlPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) };
}

function dist(a: ControlPoint, b: ControlPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function dist3(a: ControlPoint, b: ControlPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// ------------------------------------------------------------------ route ---

export class Route {
  readonly fine: ControlPoint[] = [];
  readonly gradients: number[] = [];
  /** Normalized 0..1 minimap polyline */
  readonly minimap: [number, number][] = [];
  length = 0;

  constructor(world: WorldDef) {
    const ctrl = buildControlPoints(world);
    const n = ctrl.length;

    // fine points at ~4 m spacing (elevation straight from the spline — smooth)
    for (let i = 0; i < n; i++) {
      const p0 = ctrl[(i - 1 + n) % n];
      const p1 = ctrl[i];
      const p2 = ctrl[(i + 1) % n];
      const p3 = ctrl[(i + 2) % n];
      const steps = Math.max(2, Math.floor(dist(p1, p2) / SAMPLE_STEP));
      for (let s = 0; s < steps; s++) {
        const p = catmull(p0, p1, p2, p3, s / steps);
        let y = p.y + ROAD_LIFT;
        if (world.water) y = Math.max(y, world.waterLevel + 0.8); // causeways over water
        this.fine.push({ x: p.x, y, z: p.z });
      }
    }

    // arc length + gradients
    for (let i = 0; i < this.fine.length; i++) {
      this.length += dist3(this.fine[i], this.fine[(i + 1) % this.fine.length]);
    }
    for (let i = 0; i < this.fine.length; i++) {
      const nxt = this.fine[(i + 1) % this.fine.length];
      const d = dist3(this.fine[i], nxt);
      this.gradients.push(Math.min(0.28, Math.max(-0.24, (nxt.y - this.fine[i].y) / Math.max(d, 0.001))));
    }

    // minimap polyline (normalized by largest horizontal span)
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of this.fine) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    for (let i = 0; i < this.fine.length; i += 4) {
      this.minimap.push([(this.fine[i].x - minX) / span, (this.fine[i].z - minZ) / span]);
    }
  }

  /** Interpolated position/tangent/gradient at a route distance */
  sample(distM: number): RouteSample {
    const d = ((distM % this.length) + this.length) % this.length;
    const idx = Math.floor(d / SAMPLE_STEP) % this.fine.length;
    const nxt = (idx + 1) % this.fine.length;
    const frac = (d % SAMPLE_STEP) / SAMPLE_STEP;
    const p = this.fine[idx];
    const q = this.fine[nxt];
    let tx = q.x - p.x;
    let tz = q.z - p.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    return {
      x: p.x + (q.x - p.x) * frac,
      y: p.y + (q.y - p.y) * frac,
      z: p.z + (q.z - p.z) * frac,
      tx, tz,
      gradient: this.gradients[idx],
    };
  }

  pointAt(distM: number): ControlPoint {
    const d = ((distM % this.length) + this.length) % this.length;
    return this.fine[Math.floor(d / SAMPLE_STEP) % this.fine.length];
  }

  gradientAt(distM: number): number {
    const d = ((distM % this.length) + this.length) % this.length;
    return this.gradients[Math.floor(d / SAMPLE_STEP) % this.fine.length];
  }

  minimapAt(distM: number): [number, number] {
    if (this.minimap.length === 0) return [0.5, 0.5];
    const d = ((distM % this.length) + this.length) % this.length;
    const idx = Math.floor(d / SAMPLE_STEP / 4) % this.minimap.length;
    return this.minimap[idx];
  }
}

// ---------------------------------------------------------------- terrain ---

export class Terrain {
  private mountains: Mountain[] = [];
  /** spatial hash of road points for fast neighborhood queries */
  private grid = new Map<string, ControlPoint[]>();
  private cell = BLEND_RADIUS;

  constructor(
    private world: WorldDef,
    roadPoints: ControlPoint[]
  ) {
    if (world.mountains) {
      const [rx, ry] = world.radius;
      this.mountains = [
        { center: [rx * 0.9, -ry * 0.8], radius: 420, height: 220, cx: rx * 0.9, cz: -ry * 0.8 },
        { center: [-rx * 1.1, ry * 0.9], radius: 380, height: 160, cx: -rx * 1.1, cz: ry * 0.9 },
        { center: [rx * 1.3, ry * 1.1], radius: 460, height: 260, cx: rx * 1.3, cz: ry * 1.1 },
      ];
    }
    for (const p of roadPoints) {
      const key = `${Math.floor(p.x / this.cell)}|${Math.floor(p.z / this.cell)}`;
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(p);
      else this.grid.set(key, [p]);
    }
  }

  private nearby(x: number, z: number): ControlPoint[] {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const out: ControlPoint[] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const b = this.grid.get(`${cx + i}|${cz + j}`);
        if (b) out.push(...b);
      }
    }
    return out;
  }

  /** Approximate distance from (x,z) to the road centerline. */
  distToRoad(x: number, z: number): number {
    const pts = this.nearby(x, z);
    if (pts.length === 0) return BLEND_RADIUS * 2;
    let best = Infinity;
    for (const p of pts) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < best) best = d;
    }
    return best;
  }

  height(x: number, z: number): number {
    const w = this.world;
    let h = fbm(x, z, w.seed, 4) * w.hillAmp;
    for (const m of this.mountains) {
      const d = Math.hypot(x - m.cx, z - m.cz);
      if (d < m.radius * 2.2) {
        h += m.height * Math.exp(-((d / m.radius) ** 2) * 2.2);
      }
    }
    // Continuous blend toward the road elevation (inverse-distance weights over
    // every nearby road point — no seams, no yo-yo).
    let wsum = 0;
    let target = 0;
    for (const p of this.nearby(x, z)) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < BLEND_RADIUS) {
        let bw = 1 - d / BLEND_RADIUS;
        bw *= bw * (3 - 2 * bw); // smoothstep
        wsum += bw;
        target += bw * p.y;
      }
    }
    if (wsum > 0.0001) {
      const roadY = target / wsum;
      h = h + (roadY - h) * Math.min(1, wsum);
    }
    if (w.water) h = Math.max(h, w.waterLevel - 2.5); // keep seabed just under the surface
    return h;
  }
}

// ------------------------------------------------------------------ build ---

export function buildWorld(world: WorldDef): { route: Route; terrain: Terrain } {
  const route = new Route(world);
  const terrain = new Terrain(world, route.fine);
  return { route, terrain };
}
