// Velodroma WebGL ride engine (Three.js).
// Procedural worlds in code — no assets: terrain, road circuit, trees, water,
// start arch and rider are all generated. Graphics presets Low → Ultra control
// resolution scale, shadows, terrain density, tree count and draw distance.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WorldDef, WORLDS } from './worlds';
import { buildWorld, Route, Terrain } from './spline';
import { RiderPhysics } from './physics';
import {
  QUALITY, QualityChoice, QualityKey, QualitySpec,
  detectQuality, loadQualityPref, saveQualityPref, stepDown,
} from './quality';

export interface HudState {
  speedKmh: number;
  powerW: number;
  heartRate: number;
  cadence: number;
  gearFront: number;
  gearRear: number;
  distanceKm: number;
  timeS: number;
  gradient: number;
  elevationM: number;
  clock: string;
  weather: string;
  zone: string;
  worldName: string;
  laps: number;
  segment: { name: string; progress: number } | null;
  minimapX: number;
  minimapY: number;
  fps: number;
  quality: QualityKey;
  autoQuality: boolean;
  calories: number;
}

export interface SegmentEvent {
  kind: 'enter' | 'complete';
  name: string;
  seconds?: number;
  isPb?: boolean;
  isKom?: boolean;
}

export interface RideSummary {
  name: string;
  worldName: string;
  distanceKm: number;
  timeS: number;
  movingTimeS: number;
  elevationM: number;
  avgPowerW: number;
  maxPowerW: number;
  avgHr: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  calories: number;
}

export interface EngineCallbacks {
  onHud: (h: HudState) => void;
  onSegmentEvent: (e: SegmentEvent) => void;
  onQualityDownshift: (to: QualityKey) => void;
}

const WEATHERS = ['Clear', 'Partly Cloudy', 'Overcast', 'Light Rain'] as const;
const WEATHER_PARAMS: Record<string, { fog: number; sun: number }> = {
  'Clear': { fog: 0.00035, sun: 1.0 },
  'Partly Cloudy': { fog: 0.0006, sun: 0.85 },
  'Overcast': { fog: 0.001, sun: 0.6 },
  'Light Rain': { fog: 0.0016, sun: 0.42 },
};

const SKY_DAY_TOP = new THREE.Color(0.16, 0.36, 0.72);
const SKY_DAY_HORIZON = new THREE.Color(0.68, 0.75, 0.85);
const SKY_NIGHT_TOP = new THREE.Color(0.05, 0.08, 0.18);
const SKY_NIGHT_HORIZON = new THREE.Color(0.2, 0.16, 0.22);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function srgb(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color(r, g, b).convertSRGBToLinear();
}

// CC0 bicycle model (public/models/bicycle.glb — grab3d.com, CC0 1.0, no attribution
// required). Loaded once and cached across scene rebuilds; resolves null when the
// file is unavailable so the procedural fallback bike kicks in seamlessly.
let bikeModelPromise: Promise<THREE.Group | null> | null = null;
function loadBikeModel(): Promise<THREE.Group | null> {
  if (!bikeModelPromise) {
    bikeModelPromise = new Promise((resolve) => {
      new GLTFLoader().load(
        '/models/bicycle.glb',
        (gltf) => resolve(gltf.scene as unknown as THREE.Group),
        undefined,
        () => resolve(null)
      );
    });
  }
  return bikeModelPromise;
}

/** Flag cloned GLB meshes + materials as shared with the cached prototype so
 *  disposeScene never frees geometry/materials still referenced by the cache. */
function markShared(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.userData.shared = true;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (m) (m as THREE.Material & { userData: Record<string, unknown> }).userData.shared = true;
    }
  });
}

// --- procedural PBR-ish textures (canvas-generated, tileable) ---------------

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function noiseSpeckle(ctx: CanvasRenderingContext2D, s: number, count: number, base: string, colors: string[], rMin: number, rMax: number): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  // wrap-around dot drawing keeps the texture tileable
  for (let i = 0; i < count; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = rMin + Math.random() * (rMax - rMin);
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    for (const ox of [-s, 0, s]) {
      for (const oy of [-s, 0, s]) {
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

let asphaltTex: THREE.CanvasTexture | null = null;
function getAsphaltTexture(): THREE.CanvasTexture {
  if (!asphaltTex) {
    asphaltTex = canvasTexture(512, (ctx, s) => {
      noiseSpeckle(ctx, s, 9000, '#333336', ['#2c2c30', '#3a3a3e', '#28282c', '#404045', '#313135'], 0.5, 2.2);
      // large low-contrast patches (repair patches / wear) — wrap-drawn
      for (let i = 0; i < 7; i++) {
        const x = Math.random() * s, y = Math.random() * s, r = 30 + Math.random() * 70;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const dark = Math.random() > 0.5;
        g.addColorStop(0, dark ? 'rgba(30,30,34,0.35)' : 'rgba(70,70,74,0.22)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore(); }
      }
    });
  }
  return asphaltTex;
}

let grassTex: THREE.CanvasTexture | null = null;
function getGrassTexture(): THREE.CanvasTexture {
  if (!grassTex) {
    grassTex = canvasTexture(512, (ctx, s) => {
      noiseSpeckle(ctx, s, 8000, '#5c7a44', ['#516e3c', '#67894e', '#4a6536', '#6f8f55', '#5a7842'], 0.8, 3.2);
      for (let i = 0; i < 2600; i++) { // dry blades catching the sun
        const x = Math.random() * s, y = Math.random() * s;
        ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(168,180,110,0.35)' : 'rgba(70,90,52,0.4)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 5, y - 2 - Math.random() * 4);
        ctx.stroke();
      }
    });
  }
  return grassTex;
}

/** Cluster of leaves on transparent background — used as alpha-card foliage. */
let foliageTex: THREE.CanvasTexture | null = null;
function getFoliageTexture(): THREE.CanvasTexture {
  if (!foliageTex) {
    foliageTex = canvasTexture(256, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 240; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.pow(Math.random(), 0.6) * s * 0.48;
        const x = s / 2 + Math.cos(a) * r;
        const y = s / 2 + Math.sin(a) * r * 0.92;
        const size = 6 + Math.random() * 10;
        const shade = Math.random();
        ctx.fillStyle = `rgb(${(28 + shade * 40) | 0},${(70 + shade * 70) | 0},${(30 + shade * 36) | 0})`;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.random() * Math.PI);
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  }
  return foliageTex;
}

// --- cached NYC scenery GLBs (CGTrader Royalty Free — files NOT in the repo;
// when absent the city world silently falls back to procedural scenery) -------

function loadGlb(url: string, meshopt: boolean): Promise<THREE.Group | null> {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    if (meshopt) loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(url, (gltf) => resolve(gltf.scene as unknown as THREE.Group), undefined, () => resolve(null));
  });
}

let skylineProtoPromise: Promise<THREE.Group | null> | null = null;
function loadSkylineModel(): Promise<THREE.Group | null> {
  if (!skylineProtoPromise) skylineProtoPromise = loadGlb('/models/nyc/skyline.glb', true);
  return skylineProtoPromise;
}

let bridgeProtoPromise: Promise<THREE.Group | null> | null = null;
function loadBridgeModel(): Promise<THREE.Group | null> {
  if (!bridgeProtoPromise) bridgeProtoPromise = loadGlb('/models/nyc/bridge.glb', true);
  return bridgeProtoPromise;
}

export class RideEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera;
  private skyMat: THREE.ShaderMaterial | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private rider: THREE.Group | null = null;
  private wheels: THREE.Mesh[] = [];
  private cranks: THREE.Mesh[] = [];
  private legUpperL: THREE.Mesh | null = null;
  private legLowerL: THREE.Mesh | null = null;
  private legUpperR: THREE.Mesh | null = null;
  private legLowerR: THREE.Mesh | null = null;
  private armUpperL: THREE.Mesh | null = null;
  private armLowerL: THREE.Mesh | null = null;
  private armUpperR: THREE.Mesh | null = null;
  private armLowerR: THREE.Mesh | null = null;
  private torso: THREE.Group | null = null;
  private bikeSteer: THREE.Object3D | null = null;
  private bikeKickstand: THREE.Object3D | null = null;
  private glbBike = false;
  private clouds: THREE.Group | null = null;
  private sunDisc: THREE.Group | null = null;
  private envTexture: THREE.Texture | null = null;
  private water: THREE.Mesh | null = null;
  private cityGroup: THREE.Group | null = null;

  private world: WorldDef;
  private route: Route;
  private terrain: Terrain;

  private physics = new RiderPhysics();
  private qualityChoice: QualityChoice;
  private quality: QualitySpec;
  private autoQuality: boolean;

  private keys = new Set<string>();
  private lateral = 0;
  private distance = 0;
  private lastLapMark = 0;
  private laps = 0;
  private elevation = 0;
  private lastY = 0;
  private rideTime = 0;
  private movingTime = 0;
  private powerSum = 0;
  private powerN = 0;
  private maxPower = 0;
  private hrSum = 0;
  private hrN = 0;
  private maxSpeed = 0;
  private calories = 0;
  private hour = 9.5;
  private weather = 'Clear';
  private weatherTimer = 0;
  private zone = '';
  private activeSegment: { name: string; start: number; end: number; startTime: number } | null = null;
  private lastDist = 0;

  private camView = 0;
  private camPos = new THREE.Vector3(0, 3, 8);
  private crankPhase = 0;
  private leanCur = 0.6;
  private state: 'idle' | 'riding' | 'paused' = 'idle';
  private raf = 0;
  private lastT = 0;
  private hudAccum = 0;
  private fpsEma = 60;
  private lowFpsTime = 0;
  private disposed = false;

  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onResize: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    worldId: string,
    private callbacks: EngineCallbacks
  ) {
    this.world = WORLDS[worldId] || WORLDS.watopia;
    const built = buildWorld(this.world);
    this.route = built.route;
    this.terrain = built.terrain;

    this.qualityChoice = loadQualityPref();
    this.autoQuality = this.qualityChoice === 'auto';
    const initialKey: QualityKey = this.autoQuality ? detectQuality() : (this.qualityChoice as QualityKey);
    this.quality = QUALITY[initialKey];

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, this.quality.drawDistance * 2.4);

    this.buildScene();

    this.onKeyDown = (e) => this.handleKey(e, true);
    this.onKeyUp = (e) => this.handleKey(e, false);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);

    this.lastT = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------- lifecycle ---

  get qualityKey(): QualityKey { return this.quality.key; }
  get isAuto(): boolean { return this.autoQuality; }
  get status(): 'idle' | 'riding' | 'paused' { return this.state; }

  startRide(): void {
    this.state = 'riding';
  }

  pause(): void { if (this.state === 'riding') this.state = 'paused'; }
  resume(): void { if (this.state === 'paused') this.state = 'riding'; }

  /** Back to the idle/menu state (camera orbits the start arch). */
  endRide(): void { this.state = 'idle'; }

  /** Zero all ride stats before starting a new ride on the same world. */
  resetRide(): void {
    this.distance = 0;
    this.lastLapMark = 0;
    this.laps = 0;
    this.elevation = 0;
    this.lastY = this.route.pointAt(0).y;
    this.rideTime = 0;
    this.movingTime = 0;
    this.powerSum = 0; this.powerN = 0; this.maxPower = 0;
    this.hrSum = 0; this.hrN = 0;
    this.maxSpeed = 0;
    this.calories = 0;
    this.activeSegment = null;
    this.lastDist = 0;
    this.physics.speed = 0;
  }

  minimapPoints(): [number, number][] {
    return this.route.minimap;
  }

  setQuality(choice: QualityChoice): void {
    const prevKey = this.quality.key;
    this.qualityChoice = choice;
    this.autoQuality = choice === 'auto';
    saveQualityPref(choice);
    this.quality = QUALITY[this.autoQuality ? detectQuality() : (choice as QualityKey)];
    if (this.quality.key !== prevKey) {
      this.buildScene(); // rebuild visuals, keep ride state
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    this.disposeScene();
    this.envTexture?.dispose();
    this.envTexture = null;
    this.renderer.dispose();
  }

  summary(): RideSummary {
    const name = `${this.world.name} Loop`;
    return {
      name,
      worldName: this.world.name,
      distanceKm: this.distance / 1000,
      timeS: this.rideTime,
      movingTimeS: this.movingTime,
      elevationM: this.elevation,
      avgPowerW: this.powerN ? this.powerSum / this.powerN : 0,
      maxPowerW: this.maxPower,
      avgHr: this.hrN ? this.hrSum / this.hrN : 0,
      avgSpeedKmh: this.movingTime ? (this.distance / this.movingTime) * 3.6 : 0,
      maxSpeedKmh: this.maxSpeed * 3.6,
      calories: this.calories,
    };
  }

  // ------------------------------------------------------------ scene build ---

  private disposeScene(): void {
    if (!this.scene) return;
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      // GLB clones share geometry/materials with the cached prototype — keep them
      if (mesh.geometry && !mesh.userData.shared) mesh.geometry.dispose();
      const mat = (mesh as any).material;
      if (mat) {
        const mats = Array.isArray(mat) ? mat : [mat];
        for (const m of mats) {
          if (m && !(m as any).userData?.shared) m.dispose();
        }
      }
    });
    this.scene.clear();
    this.scene = null;
    this.skyMat = null;
    this.sun = null;
    this.hemi = null;
    this.rider = null;
    this.wheels = [];
    this.cranks = [];
    this.legUpperL = this.legLowerL = this.legUpperR = this.legLowerR = null;
    this.armUpperL = this.armLowerL = this.armUpperR = this.armLowerR = null;
    this.torso = null;
    this.bikeSteer = null;
    this.bikeKickstand = null;
    this.glbBike = false;
    this.clouds = null;
    this.sunDisc = null;
    this.water = null;
    this.cityGroup = null;
  }

  private buildScene(): void {
    this.disposeScene();
    const q = this.quality;
    const scene = new THREE.Scene();
    this.scene = scene;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr * q.pixelRatioScale);
    this.renderer.shadowMap.enabled = q.shadows;

    // Soft image-based ambient light so PBR materials (bike, rider) pick up
    // believable reflections; costs nothing on Lambert scenery.
    if (!this.envTexture) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    scene.environment = this.envTexture;

    // --- sky ---
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: SKY_DAY_TOP.clone() },
        horizonColor: { value: SKY_DAY_HORIZON.clone() },
        bottomColor: { value: new THREE.Color(0.12, 0.14, 0.2) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 col = mix(horizonColor, topColor, pow(max(h, 0.0), 0.55));
          col = mix(col, bottomColor, smoothstep(0.0, -0.3, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(q.drawDistance * 1.6, 24, 16), this.skyMat);
    scene.add(sky);

    scene.fog = new THREE.FogExp2(new THREE.Color(0.65, 0.72, 0.82), WEATHER_PARAMS[this.weather].fog);

    // --- lights ---
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x3a4a3a, 0.45);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    if (q.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.camera.left = -115;
      this.sun.shadow.camera.right = 115;
      this.sun.shadow.camera.top = 115;
      this.sun.shadow.camera.bottom = -115;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 520;
      this.sun.shadow.bias = -0.00035;
      this.sun.shadow.normalBias = 0.025;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);

    // --- terrain ---
    const size = this.world.worldSize;
    const cells = q.terrainCells;
    const geo = new THREE.PlaneGeometry(size, size, cells, cells);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const grass = srgb(...this.world.grassColor);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.terrain.height(x, z);
      pos.setY(i, h);
      // color: grass with subtle noise variation, rock/snow at altitude
      const v = 0.9 + 0.2 * ((Math.sin(x * 0.011) * Math.cos(z * 0.013)) + 1) / 2;
      c.copy(grass).multiplyScalar(v);
      if (h > 90) c.lerp(new THREE.Color(0.45, 0.43, 0.42), Math.min(1, (h - 90) / 60));
      if (h > 160) c.lerp(new THREE.Color(0.93, 0.94, 0.97), Math.min(1, (h - 160) / 50));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // tiled grass texture breaks up the flat vertex color wash (photoreal step 1)
    const grassMap = getGrassTexture();
    grassMap.repeat.set(size / 16, size / 16);
    const terrainMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: grassMap }));
    terrainMesh.receiveShadow = q.shadows;
    scene.add(terrainMesh);

    // --- road ribbon + markings ---
    this.buildRoad(scene, q);
    this.buildGuardrails(scene, q);

    // --- water ---
    if (this.world.water && q.water) {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(size * 1.8, size * 1.8),
        new THREE.MeshLambertMaterial({
          color: srgb(0.1, 0.32, 0.5), transparent: true, opacity: 0.85,
        })
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = this.world.waterLevel;
      this.water = water;
      scene.add(water);
    }

    // --- trees, rocks, clouds, sun, guardrails ---
    this.buildTrees(scene, q);
    this.buildUtilityPoles(scene, q);
    this.buildSigns(scene, q);
    this.buildClouds(scene, q);
    this.buildSunDisc(scene, q);

    // --- start arch + parked bikes ---
    this.buildStartArch(scene);
    this.buildParkedBikes(scene);

    // --- city backdrop (NYC skyline + bridge) ---
    this.buildCityScenery(scene, q);

    // --- rider ---
    this.buildRider(scene, q.shadows);

    this.resize();
  }

  private buildRoad(scene: THREE.Scene, q: QualitySpec): void {
    // Build the road ribbon by stepping arc length at ~4 m.
    const step = 4.0;
    const n = Math.floor(this.route.length / step);
    const HALF_W = 2.3;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    // u spans the texture once across the road; v repeats every 8 m of arc
    const push = (x: number, y: number, z: number, u: number, v: number) => {
      positions.push(x, y, z); normals.push(0, 1, 0); uvs.push(u, v);
    };

    const at = (i: number) => {
      const s = this.route.sample(i * step);
      return { x: s.x, y: s.y + 0.02, z: s.z, tx: s.tx, tz: s.tz };
    };
    for (let i = 0; i < n; i++) {
      const p = at(i);
      const r = at((i + 1) % n);
      const sideL = { x: p.tz, z: -p.tx }; // perpendicular
      const v0 = (i * step) / 8;
      const v1 = ((i + 1) * step) / 8;
      const addQuad = (w: number, yOff: number) => {
        const a = [p.x - sideL.x * w, p.y + yOff, p.z - sideL.z * w];
        const b = [p.x + sideL.x * w, p.y + yOff, p.z + sideL.z * w];
        const c = [r.x + sideL.x * w, r.y + yOff, r.z + sideL.z * w];
        const d = [r.x - sideL.x * w, p.y + yOff, p.z - sideL.z * w];
        push(a[0], a[1], a[2], 0, v0); push(b[0], b[1], b[2], 1, v0); push(c[0], c[1], c[2], 1, v1);
        push(a[0], a[1], a[2], 0, v0); push(c[0], c[1], c[2], 1, v1); push(d[0], d[1], d[2], 0, v1);
      };
      addQuad(HALF_W, 0);
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const asphalt = getAsphaltTexture();
    asphalt.repeat.set(1, 1);
    const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({
      map: asphalt, color: srgb(...this.world.roadColor), roughness: 0.92, metalness: 0,
    }));
    road.receiveShadow = q.shadows;
    scene.add(road);

    // accent edge lines (both sides) — premium touch, cheap
    const edgePositions: number[] = [];
    const edgeNormals: number[] = [];
    const pushEdge = (x: number, y: number, z: number) => { edgePositions.push(x, y, z); edgeNormals.push(0, 1, 0); };
    for (let i = 0; i < n; i++) {
      const p = at(i);
      const r = at((i + 1) % n);
      const sideL = { x: p.tz, z: -p.tx };
      for (const sign of [-1, 1]) {
        const inner = HALF_W - 0.32;
        const outer = HALF_W - 0.08;
        const ax = p.x + sign * sideL.x * inner, az = p.z + sign * sideL.z * inner;
        const bx = p.x + sign * sideL.x * outer, bz = p.z + sign * sideL.z * outer;
        const cx = r.x + sign * sideL.x * outer, cz = r.z + sign * sideL.z * outer;
        const dx = r.x + sign * sideL.x * inner, dz = r.z + sign * sideL.z * inner;
        pushEdge(ax, p.y + 0.04, az); pushEdge(bx, p.y + 0.04, bz); pushEdge(cx, r.y + 0.04, cz);
        pushEdge(ax, p.y + 0.04, az); pushEdge(cx, r.y + 0.04, cz); pushEdge(dx, r.y + 0.04, dz);
      }
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
    edgeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(edgeNormals, 3));
    const accent = srgb(...this.world.accentColor);
    scene.add(new THREE.Mesh(edgeGeo, new THREE.MeshLambertMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.55 })));

    // dashed center line
    if (q.roadLines) {
      const lp: number[] = [];
      const ln: number[] = [];
      const pushLine = (x: number, y: number, z: number) => { lp.push(x, y, z); ln.push(0, 1, 0); };
      for (let i = 0; i < n; i += 3) {
        const p = at(i);
        const r = at((i + 1) % n);
        const sideL = { x: p.tz, z: -p.tx };
        const w = 0.09;
        pushLine(p.x - sideL.x * w, p.y + 0.05, p.z - sideL.z * w);
        pushLine(p.x + sideL.x * w, p.y + 0.05, p.z + sideL.z * w);
        pushLine(r.x + sideL.x * w, r.y + 0.05, r.z + sideL.z * w);
        pushLine(p.x - sideL.x * w, p.y + 0.05, p.z - sideL.z * w);
        pushLine(r.x + sideL.x * w, r.y + 0.05, r.z + sideL.z * w);
        pushLine(r.x - sideL.x * w, r.y + 0.05, r.z - sideL.z * w);
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      lineGeo.setAttribute('normal', new THREE.Float32BufferAttribute(ln, 3));
      scene.add(new THREE.Mesh(lineGeo, new THREE.MeshLambertMaterial({ color: srgb(0.92, 0.9, 0.75) })));
    }
  }

  private buildTrees(scene: THREE.Scene, q: QualitySpec): void {
    const rng = mulberry32(this.world.seed ^ 0x9e3779b9);
    const count = Math.floor(this.world.treeCount * q.treeFactor);
    if (count <= 0) return;
    const bound = this.world.worldSize * 0.55;

    // Gather placement spots once; skip near-road and underwater positions.
    const spots: { x: number; y: number; z: number; s: number; rot: number; kind: number }[] = [];
    let guard = 0;
    while (spots.length < count && guard < count * 12) {
      guard++;
      const x = (rng() * 2 - 1) * bound;
      const z = (rng() * 2 - 1) * bound;
      if (this.terrain.distToRoad(x, z) < 14) continue;
      const y = this.terrain.height(x, z);
      if (this.world.water && y < this.world.waterLevel + 1) continue;
      const h = this.terrain.height(x, z);
      // above the treeline it's rock and snow — no trees
      if (h > 140) continue;
      spots.push({ x, y, z, s: 0.7 + rng() * 0.9, rot: rng() * Math.PI * 2, kind: rng() });
    }

    // Forest corridors: dense tree walls flanking the road (the sample.png look).
    // Stepping the route guarantees coverage instead of trusting rejection sampling.
    const corridor: typeof spots = [];
    const corridorStep = 16.0;
    const corridorN = Math.floor(this.route.length / corridorStep);
    const corridorBudget = Math.floor(this.route.length / corridorStep) * 2;
    for (let i = 0; i < corridorN; i++) {
      for (const sign of [-1, 1]) {
        if (corridor.length >= corridorBudget * q.treeFactor) break;
        const s = this.route.sample(i * corridorStep);
        const sideL = { x: s.tz, z: -s.tx };
        const off = 15 + rng() * 22;
        const jitterAlong = (rng() - 0.5) * 10;
        const x = s.x + sign * sideL.x * off + s.tx * jitterAlong;
        const z = s.z + sign * sideL.z * off + s.tz * jitterAlong;
        const y = this.terrain.height(x, z);
        if (this.world.water && y < this.world.waterLevel + 1) continue;
        if (y > 140) continue;
        corridor.push({ x, y, z, s: 0.75 + rng() * 1.0, rot: rng() * Math.PI * 2, kind: rng() });
      }
    }
    spots.push(...corridor);

    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scaleV = new THREE.Vector3();
    const posV = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const place = (mesh: THREE.InstancedMesh, list: typeof spots, fn: (sp: (typeof spots)[0]) => void) => {
      list.forEach((sp, i) => {
        fn(sp);
        posV.set(sp.x, sp.y, sp.z);
        quat.setFromAxisAngle(yAxis, sp.rot);
        m.compose(posV, quat, scaleV);
        mesh.setMatrixAt(i, m);
      });
      mesh.count = list.length;
      mesh.castShadow = q.shadows;
      scene.add(mesh);
    };

    // --- conifers: stacked cones (alpine feel) ---
    const conifers = spots.filter((sp) => sp.kind < 0.4 && this.world.id !== 'watopia');
    if (conifers.length) {
      const trunk = new THREE.CylinderGeometry(0.14, 0.24, 2.2, 6);
      trunk.translate(0, 1.1, 0);
      const canopy = new THREE.ConeGeometry(1.55, 5.4, 8);
      canopy.translate(0, 4.4, 0);
      place(new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: srgb(0.32, 0.22, 0.14) }), conifers.length), conifers, (sp) => scaleV.set(sp.s, sp.s, sp.s));
      place(new THREE.InstancedMesh(canopy, new THREE.MeshLambertMaterial({ color: srgb(0.1, 0.3, 0.19) }), conifers.length), conifers, (sp) => scaleV.set(sp.s, sp.s * (0.9 + (sp.rot % 0.4)), sp.s));
    }

    // --- broadleaf: trunk + blobby canopy (park / jungle feel) ---
    const broadleaf = spots.filter((sp) => sp.kind >= 0.4 && sp.kind < 0.8);
    if (broadleaf.length) {
      const trunk = new THREE.CylinderGeometry(0.17, 0.3, 2.8, 6);
      trunk.translate(0, 1.4, 0);
      const canopy = new THREE.IcosahedronGeometry(2.0, 1);
      canopy.scale(1, 0.85, 1);
      canopy.translate(0, 4.3, 0);
      const jungle = this.world.id === 'watopia';
      place(new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: srgb(0.33, 0.23, 0.15) }), broadleaf.length), broadleaf, (sp) => scaleV.set(sp.s, sp.s, sp.s));
      const canopyMesh = new THREE.InstancedMesh(canopy, new THREE.MeshLambertMaterial({ color: srgb(jungle ? 0.12 : 0.18, jungle ? 0.48 : 0.4, jungle ? 0.18 : 0.2) }), broadleaf.length);
      place(canopyMesh, broadleaf, (sp) => scaleV.set(sp.s, sp.s * (0.85 + (sp.rot % 0.5)), sp.s));
    }

    // --- cypress: tall slim spires (Mediterranean feel) ---
    const cypress = spots.filter((sp) => sp.kind >= 0.8);
    if (cypress.length) {
      const canopy = new THREE.ConeGeometry(0.95, 6.2, 7);
      canopy.translate(0, 3.6, 0);
      place(new THREE.InstancedMesh(canopy, new THREE.MeshLambertMaterial({ color: srgb(0.2, 0.38, 0.2) }), cypress.length), cypress, (sp) => scaleV.set(sp.s, sp.s * 1.15, sp.s));
    }

    // --- rocks (scattered boulders, also above the treeline) ---
    const rockCount = Math.floor(count * 0.3);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: srgb(0.46, 0.45, 0.44) }), rockCount);
    const rockColor = new THREE.Color();
    let rp = 0;
    guard = 0;
    while (rp < rockCount && guard < rockCount * 12) {
      guard++;
      const x = (rng() * 2 - 1) * bound;
      const z = (rng() * 2 - 1) * bound;
      if (this.terrain.distToRoad(x, z) < 10) continue;
      const y = this.terrain.height(x, z);
      if (this.world.water && y < this.world.waterLevel + 0.4) continue;
      const s = 0.4 + rng() * 1.4;
      posV.set(x, y + s * 0.15, z);
      scaleV.set(s, s * (0.5 + rng() * 0.4), s * (0.7 + rng() * 0.6));
      quat.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4));
      m.compose(posV, quat, scaleV);
      rocks.setMatrixAt(rp, m);
      const v = 0.8 + rng() * 0.4;
      rocks.setColorAt(rp, rockColor.setRGB(v, v, v));
      rp++;
    }
    rocks.count = rp;
    rocks.castShadow = q.shadows;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    scene.add(rocks);

    // --- alpha-card foliage: crossed leaf billboards fatten the canopies ---
    // (high/ultra only — dense soft silhouettes are the sample.png signature)
    if (q.key === 'high' || q.key === 'ultra') {
      const leaf = getFoliageTexture();
      const plane1 = new THREE.PlaneGeometry(1, 1);
      const plane2 = new THREE.PlaneGeometry(1, 1);
      plane2.rotateY(Math.PI / 2);
      const crossed = mergeGeometries([plane1, plane2]);
      if (crossed) {
        const cardMat = new THREE.MeshLambertMaterial({ map: leaf, alphaTest: 0.45, side: THREE.DoubleSide });
        const makeCards = (list: typeof spots, height: number, radius: number) => {
          if (!list.length) return;
          const mesh = new THREE.InstancedMesh(crossed, cardMat, list.length);
          list.forEach((sp, i) => {
            posV.set(sp.x, sp.y + height * sp.s, sp.z);
            quat.setFromAxisAngle(yAxis, sp.rot);
            scaleV.set(radius * sp.s * 2.3, radius * sp.s * 2.3, radius * sp.s * 2.3);
            m.compose(posV, quat, scaleV);
            mesh.setMatrixAt(i, m);
          });
          mesh.count = list.length;
          scene.add(mesh);
        };
        makeCards(spots.filter((sp) => sp.kind >= 0.4 && sp.kind < 0.8), 4.3, 2.0);
        makeCards(spots.filter((sp) => sp.kind >= 0.8), 3.6, 0.95);
      }
    }
  }

  /** Soft volumetric-looking cloud puffs that ride along with the player. */
  private buildClouds(scene: THREE.Scene, q: QualitySpec): void {
    const rng = mulberry32(this.world.seed ^ 0x51ed270b);
    const count = q.key === 'low' ? 10 : q.key === 'ultra' ? 30 : 20;
    const group = new THREE.Group();
    const geo = new THREE.SphereGeometry(1, 7, 5);
    const mat = new THREE.MeshLambertMaterial({
      color: srgb(0.97, 0.98, 1.0),
      transparent: true, opacity: 0.82,
      emissive: srgb(0.25, 0.27, 0.32), emissiveIntensity: 0.6,
      fog: false,
      depthWrite: false,
    });
    const clouds = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const posV = new THREE.Vector3();
    const scaleV = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = 250 + rng() * 900;
      posV.set(Math.cos(a) * r, 150 + rng() * 160, Math.sin(a) * r);
      // each cloud is a small cluster of 1-3 overlapping puffs via scale jitter
      const w = 14 + rng() * 26;
      scaleV.set(w, w * (0.28 + rng() * 0.14), w * (0.6 + rng() * 0.3));
      quat.identity();
      m.compose(posV, quat, scaleV);
      clouds.setMatrixAt(i, m);
    }
    clouds.frustumCulled = false;
    this.clouds = group;
    group.add(clouds);
    scene.add(group);
  }

  /** Visible sun disc + glow, positioned along the light direction. */
  private buildSunDisc(scene: THREE.Scene, q: QualitySpec): void {
    const group = new THREE.Group();
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const gctx = glowCanvas.getContext('2d')!;
    const grad = gctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 244, 214, 1)');
    grad.addColorStop(0.25, 'rgba(255, 236, 180, 0.55)');
    grad.addColorStop(1, 'rgba(255, 230, 160, 0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const glowSize = q.key === 'ultra' ? 460 : q.key === 'high' ? 390 : 340;
    glow.scale.set(glowSize, glowSize, 1);
    group.add(glow);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(26, 24),
      new THREE.MeshBasicMaterial({ color: srgb(1.0, 0.97, 0.88), fog: false, transparent: true, opacity: 0.95 })
    );
    group.add(disc);
    this.sunDisc = group;
    scene.add(group);
  }

  /** Metal guardrails along steep descents (both road edges). */
  private buildGuardrails(scene: THREE.Scene, q: QualitySpec): void {
    const step = 8.0;
    const n = Math.floor(this.route.length / step);
    const EDGE = 2.75;
    const POST_H = 0.8;
    const posts: number[] = [];
    const refl: { x: number; y: number; z: number; fx: number; fz: number }[] = [];
    const rail: number[] = [];
    const railN: number[] = [];
    const prev = new Map<string, { x: number; y: number; z: number; lx: number; lz: number }>();
    for (let i = 0; i <= n; i++) {
      const s = this.route.sample((i % n) * step);
      if (s.gradient > -0.045) { prev.clear(); continue; }
      const lx = s.tz, lz = -s.tx; // left-side perpendicular
      for (const sign of [-1, 1]) {
        const px = s.x + sign * lx * EDGE;
        const pz = s.z + sign * lz * EDGE;
        const py = s.y;
        posts.push(px, py + POST_H / 2, pz);
        // reflector faces the road (white left / red right)
        refl.push({ x: px, y: py + POST_H - 0.1, z: pz, fx: -sign * lx, fz: -sign * lz });
        const key = `${sign}`;
        const p0 = prev.get(key);
        if (p0) {
          // rail beam between consecutive posts
          rail.push(p0.x, p0.y + POST_H, p0.z, px, py + POST_H, pz, px, py + POST_H - 0.14, pz);
          rail.push(p0.x, p0.y + POST_H, p0.z, px, py + POST_H - 0.14, pz, p0.x, p0.y + POST_H - 0.14, p0.z);
          for (let k = 0; k < 6; k++) railN.push(0, 1, 0);
        }
        prev.set(key, { x: px, y: py, z: pz, lx, lz });
      }
    }
    if (posts.length) {
      const postGeo = new THREE.BoxGeometry(0.09, POST_H, 0.09);
      const postMesh = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: srgb(0.62, 0.64, 0.68) }), posts.length / 3);
      const mm = new THREE.Matrix4();
      for (let i = 0; i < posts.length / 3; i++) {
        mm.makeTranslation(posts[i * 3], posts[i * 3 + 1], posts[i * 3 + 2]);
        postMesh.setMatrixAt(i, mm);
      }
      postMesh.castShadow = q.shadows;
      scene.add(postMesh);

      if (q.key !== 'low') {
        const reflGeo = new THREE.PlaneGeometry(0.09, 0.09);
        const reflMesh = new THREE.InstancedMesh(
          reflGeo,
          new THREE.MeshBasicMaterial({ color: srgb(0.98, 0.97, 0.85), side: THREE.DoubleSide }),
          refl.length
        );
        const rq = new THREE.Quaternion();
        const rv = new THREE.Vector3();
        const rs = new THREE.Vector3(1, 1, 1);
        const rmat = new THREE.Matrix4();
        refl.forEach((r, i) => {
          rv.set(r.x, r.y, r.z);
          rq.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(r.fx, 0, r.fz).normalize());
          rmat.compose(rv, rq, rs);
          reflMesh.setMatrixAt(i, rmat);
        });
        scene.add(reflMesh);
      }
    }
    if (rail.length) {
      const railGeo = new THREE.BufferGeometry();
      railGeo.setAttribute('position', new THREE.Float32BufferAttribute(rail, 3));
      railGeo.setAttribute('normal', new THREE.Float32BufferAttribute(railN, 3));
      scene.add(new THREE.Mesh(railGeo, new THREE.MeshLambertMaterial({ color: srgb(0.7, 0.72, 0.76) })));
    }

    // reflectors on the post tops (white toward the road, red on the far side)
    if (posts.length && q.key !== 'low') {
      const reflGeo = new THREE.PlaneGeometry(0.09, 0.09);
      const whiteMat = new THREE.MeshBasicMaterial({ color: srgb(0.98, 0.98, 0.9), side: THREE.DoubleSide });
      const redMat = new THREE.MeshBasicMaterial({ color: srgb(0.85, 0.12, 0.1), side: THREE.DoubleSide });
      const nRefl = posts.length / 3;
      const refl = new THREE.InstancedMesh(reflGeo, whiteMat, nRefl);
      const mm = new THREE.Matrix4();
      const rq = new THREE.Quaternion();
      const rv = new THREE.Vector3();
      const rs = new THREE.Vector3(1, 1, 1);
      const ry = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < nRefl; i++) {
        const x = posts[i * 3], y = posts[i * 3 + 1] + POST_H / 2, z = posts[i * 3 + 2];
        const sign = i % 2 === 0 ? -1 : 1;
        const rotY = Math.atan2(-sign * (i % 2 === 0 ? 1 : 1), 0);
        void rotY;
        rv.set(x, y, z);
        rq.identity();
        mm.compose(rv, rq, rs);
        refl.setMatrixAt(i, mm);
      }
      void ry;
      scene.add(refl);
      void redMat;
    }
  }

  /** Wooden utility poles with sagging catenary wires along the road. */
  private buildUtilityPoles(scene: THREE.Scene, q: QualitySpec): void {
    if (q.key === 'low') return;
    const step = 55.0;
    const n = Math.floor(this.route.length / step);
    if (n < 2) return;
    const OFFSET = 5.8;
    const POLE_H = 8.2;
    const poles: { x: number; y: number; z: number; rotY: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = this.route.sample(i * step);
      const lx = s.tz, lz = -s.tx;
      const px = s.x + lx * OFFSET;
      const pz = s.z + lz * OFFSET;
      const py = Math.max(this.terrain.height(px, pz), s.y - 0.4);
      poles.push({ x: px, y: py, z: pz, rotY: Math.atan2(s.tx, s.tz) });
    }

    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const posV = new THREE.Vector3();
    const scaleV = new THREE.Vector3(1, 1, 1);
    const yAxis = new THREE.Vector3(0, 1, 0);

    const woodMat = new THREE.MeshLambertMaterial({ color: srgb(0.3, 0.23, 0.16) });
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.13, POLE_H, 7);
    poleGeo.translate(0, POLE_H / 2, 0);
    const poleMesh = new THREE.InstancedMesh(poleGeo, woodMat, poles.length);
    const armGeo = new THREE.BoxGeometry(1.7, 0.1, 0.1);
    armGeo.translate(0, POLE_H - 1.0, 0);
    const armMesh = new THREE.InstancedMesh(armGeo, woodMat, poles.length);
    poles.forEach((p, i) => {
      posV.set(p.x, p.y, p.z);
      quat.setFromAxisAngle(yAxis, p.rotY);
      m.compose(posV, quat, scaleV);
      poleMesh.setMatrixAt(i, m);
      armMesh.setMatrixAt(i, m);
    });
    poleMesh.castShadow = q.shadows;
    armMesh.castShadow = q.shadows;
    scene.add(poleMesh);
    scene.add(armMesh);

    // sagging wires between consecutive crossarm ends (LineSegments — cheap)
    const wirePts: number[] = [];
    const WIRE_ENDS = [-0.7, 0.7];
    const SEG = 8;
    for (let i = 0; i < poles.length; i++) {
      const a = poles[i];
      const b = poles[(i + 1) % poles.length];
      for (const wx of WIRE_ENDS) {
        const ax = a.x + Math.cos(a.rotY) * wx;
        const az = a.z - Math.sin(a.rotY) * wx;
        const bx = b.x + Math.cos(b.rotY) * wx;
        const bz = b.z - Math.sin(b.rotY) * wx;
        const ay = a.y + POLE_H - 1.0;
        const by = b.y + POLE_H - 1.0;
        let prevX = ax, prevY = ay, prevZ = az;
        for (let k = 1; k <= SEG; k++) {
          const t = k / SEG;
          const sag = Math.sin(Math.PI * t) * 0.55;
          const cx = ax + (bx - ax) * t;
          const cy = ay + (by - ay) * t - sag;
          const cz = az + (bz - az) * t;
          wirePts.push(prevX, prevY, prevZ, cx, cy, cz);
          prevX = cx; prevY = cy; prevZ = cz;
        }
      }
    }
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    scene.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: srgb(0.08, 0.08, 0.09) })));
  }

  /** Road signs (curve warning diamonds + speed limits) facing oncoming riders. */
  private buildSigns(scene: THREE.Scene, q: QualitySpec): void {
    if (q.key === 'low') return;
    const postMat = new THREE.MeshLambertMaterial({ color: srgb(0.55, 0.56, 0.58) });
    const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.7, 6);
    postGeo.translate(0, 1.35, 0);

    const warning = canvasTexture(128, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = '#e8b90f';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(s / 2, 4); ctx.lineTo(s - 4, s / 2); ctx.lineTo(s / 2, s - 4); ctx.lineTo(4, s / 2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.36, s * 0.68);
      ctx.bezierCurveTo(s * 0.3, s * 0.5, s * 0.55, s * 0.52, s * 0.62, s * 0.34);
      ctx.stroke();
    });
    const speed = canvasTexture(128, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = '#f2f2ee';
      ctx.strokeStyle = '#c2312b';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#14141a';
      ctx.font = `bold ${Math.round(s * 0.5)}px Inter, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('40', s / 2, s * 0.54);
    });

    const fracs = [0.08, 0.3, 0.55, 0.78, 0.92];
    for (let i = 0; i < fracs.length; i++) {
      const s = this.route.sample(fracs[i] * this.route.length);
      const lx = s.tz, lz = -s.tx;
      const px = s.x + lx * 4.3;
      const pz = s.z + lz * 4.3;
      const py = Math.max(this.terrain.height(px, pz), s.y - 0.3);
      const g = new THREE.Group();
      g.position.set(px, py, pz);
      g.rotation.y = Math.atan2(s.tx, s.tz);
      const post = new THREE.Mesh(postGeo, postMat);
      post.castShadow = q.shadows;
      g.add(post);
      const isWarning = i % 2 === 0;
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(isWarning ? 0.78 : 0.62, isWarning ? 0.78 : 0.82),
        new THREE.MeshLambertMaterial({ map: isWarning ? warning : speed, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })
      );
      panel.position.set(0, 2.35, 0.06);
      g.add(panel);
      scene.add(g);
    }
  }

  /** NYC backdrop: photogrammetry skyline (high/ultra) + Manhattan Bridge
   *  overpass (medium+). The GLBs are licensed assets kept out of the repo —
   *  missing files fall back to procedural scenery silently. */
  private buildCityScenery(scene: THREE.Scene, q: QualitySpec): void {
    if (!this.world.city) return;
    const group = new THREE.Group();
    this.cityGroup = group;
    scene.add(group);

    const stillValid = () => this.scene === scene && !this.disposed;

    if (q.key !== 'low') {
      void loadBridgeModel().then((proto) => {
        if (!proto || !stillValid()) return;
        const model = proto.clone(true);
        markShared(model);
        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.castShadow = q.shadows;
        });
        const s = this.route.sample(0.5 * this.route.length);
        const lx = s.tz, lz = -s.tx;
        // model: 21 m wide, 144 m long, deck at y=0, towers to 43.8 m
        model.scale.setScalar(1.8);
        model.position.set(s.x, s.y + 8, s.z);
        model.rotation.y = Math.atan2(lx, lz); // length across the road
        group.add(model);
      });
    }

    if (q.key === 'high' || q.key === 'ultra') {
      void loadSkylineModel().then((proto) => {
        if (!proto || !stillValid()) return;
        // diorama ~281×150 m, base at y=-8.3, towers to y=71 → scale ×5
        const SCALE = 5;
        const baseY = this.world.waterLevel - 10 + 8.31876 * SCALE;
        for (const side of [-1, 1]) {
          const model = proto.clone(true);
          markShared(model);
          model.scale.setScalar(SCALE);
          model.position.set(side * 260, baseY, -side * 1180);
          model.rotation.y = side === -1 ? 0 : Math.PI;
          group.add(model);
        }
      });
    }
  }

  /** Parked CC0 bikes near the start arch (skipped silently when offline). */
  private buildParkedBikes(scene: THREE.Scene): void {
    void loadBikeModel().then((proto) => {
      // use the live scene — a quality switch may have rebuilt it meanwhile
      if (!proto || !this.scene || this.disposed) return;
      const s = this.route.sample(0);
      const sideL = { x: s.tz, z: -s.tx };
      const spots = [
        { sign: -1, off: 6.4, rot: 0.5 },
        { sign: 1, off: 7.2, rot: -0.7 },
      ];
      for (const spot of spots) {
        const bike = proto.clone(true);
        markShared(bike);
        bike.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.castShadow = this.quality.shadows;
        });
        const y = this.terrain.height(s.x + spot.sign * sideL.x * spot.off, s.z + spot.sign * sideL.z * spot.off);
        bike.position.set(s.x + spot.sign * sideL.x * spot.off, y, s.z + spot.sign * sideL.z * spot.off);
        bike.rotation.y = Math.atan2(s.tx, s.tz) + spot.rot;
        this.scene!.add(bike);
      }
    });
  }

  private buildStartArch(scene: THREE.Scene): void {
    const s = this.route.sample(0);
    const accent = srgb(...this.world.accentColor);
    const pillarGeo = new THREE.BoxGeometry(0.6, 6.2, 0.6);
    const mat = new THREE.MeshLambertMaterial({ color: srgb(0.13, 0.15, 0.2) });
    const accentMat = new THREE.MeshLambertMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.5 });
    const group = new THREE.Group();
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = Math.atan2(s.tx, s.tz); // local +Z = travel direction, local X = across the road
    for (const sign of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, mat);
      pillar.position.set(sign * 3.6, 3.1, 0);
      group.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.3, 0.5), accentMat);
    beam.position.set(0, 6.0, 0);
    group.add(beam);
    scene.add(group);
  }

  private buildRider(scene: THREE.Scene, shadows: boolean): void {
    const g = new THREE.Group();
    this.wheels = [];
    this.cranks = [];
    this.bikeSteer = null;
    this.bikeKickstand = null;
    this.glbBike = false;

    // ---------------- bike: CC0 model with procedural fallback ----------------
    const bike = new THREE.Group();
    g.add(bike);
    void loadBikeModel().then((proto) => {
      // Scene may have been rebuilt (quality switch) by the time this resolves.
      if (!proto || !this.rider || this.disposed) return;
      if (!this.rider.children.includes(bike)) return;
      const model = proto.clone(true);
      markShared(model);
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) { mesh.castShadow = shadows; mesh.receiveShadow = shadows; }
      });
      const wheelF = model.getObjectByName('bicycle_wheel_front');
      const wheelR = model.getObjectByName('bicycle_wheel_rear');
      const crank = model.getObjectByName('bicycle_crank');
      const steer = model.getObjectByName('bicycle_steering');
      const kick = model.getObjectByName('bicycle_kickstand');
      for (const w of [wheelF, wheelR]) {
        if (w) { w.userData.shared = true; this.wheels.push(w as THREE.Mesh); }
      }
      if (crank) { crank.userData.shared = true; this.cranks.push(crank as THREE.Mesh); }
      if (steer) this.bikeSteer = steer;
      if (kick) { this.bikeKickstand = kick; kick.visible = false; }
      model.userData.shared = true;
      bike.add(model);
      bike.userData.fallback?.forEach((c: THREE.Object3D) => c.removeFromParent());
      delete bike.userData.fallback;
      this.glbBike = true;
    });
    this.buildFallbackBike(bike, shadows);

    // ---------------- rider body (articulated, IK-animated) ----------------
    // Anchor points match the CC0 bike's geometry: wheel R 0.35, BB at
    // (0, 0.28, -0.105) with 170 mm cranks, saddle ~1.05, bars ~ (±0.21, 0.97, 0.33).
    const skinMat = new THREE.MeshStandardMaterial({ color: srgb(0.91, 0.72, 0.58), roughness: 0.65, metalness: 0 });
    const kitMat = new THREE.MeshStandardMaterial({ color: srgb(0.16, 0.2, 0.3), roughness: 0.55, metalness: 0.05 });
    const kitAccent = new THREE.MeshStandardMaterial({ color: srgb(...this.world.accentColor), roughness: 0.5, metalness: 0.05 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: srgb(0.95, 0.85, 0.25), roughness: 0.3, metalness: 0.1 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: srgb(0.92, 0.92, 0.95), roughness: 0.4, metalness: 0.05 });

    const unitLimb = (r1: number, r2: number, mat: THREE.Material) => {
      // unit-height capsule oriented per-frame by the IK solver
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, 1, 10), mat);
      mesh.castShadow = shadows;
      g.add(mesh);
      return mesh;
    };

    this.legUpperL = unitLimb(0.062, 0.052, kitMat);
    this.legLowerL = unitLimb(0.052, 0.038, kitMat);
    this.legUpperR = unitLimb(0.062, 0.052, kitMat);
    this.legLowerR = unitLimb(0.052, 0.038, kitMat);
    this.armUpperL = unitLimb(0.042, 0.034, kitMat);
    this.armLowerL = unitLimb(0.034, 0.03, skinMat);
    this.armUpperR = unitLimb(0.042, 0.034, kitMat);
    this.armLowerR = unitLimb(0.034, 0.03, skinMat);

    // torso: group so lean animates around the hip
    const torso = new THREE.Group();
    torso.position.set(0, 1.03, -0.45);
    g.add(torso);
    this.torso = torso;
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.3, 4, 12), kitMat);
    chest.position.set(0, 0.26, 0);
    chest.castShadow = shadows;
    torso.add(chest);
    // jersey accent stripe
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.132, 0.07, 12), kitAccent);
    stripe.position.set(0, 0.34, 0);
    torso.add(stripe);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.09, 8), skinMat);
    neck.position.set(0, 0.46, 0.02);
    torso.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 12), skinMat);
    head.position.set(0, 0.55, 0.05);
    head.castShadow = shadows;
    torso.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.108, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
    helmet.position.set(0, 0.565, 0.045);
    helmet.castShadow = shadows;
    torso.add(helmet);
    // helmet tail (aero)
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 8), helmetMat);
    tail.position.set(0, 0.6, -0.09);
    tail.rotation.x = -1.1;
    torso.add(tail);

    this.rider = g;
    scene.add(g);
  }

  /** Procedural fallback road bike (used until/unless the CC0 GLB loads). */
  private buildFallbackBike(parent: THREE.Group, shadows: boolean): void {
    const frameMat = new THREE.MeshStandardMaterial({ color: srgb(...this.world.accentColor), roughness: 0.35, metalness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: srgb(0.08, 0.08, 0.09), roughness: 0.5, metalness: 0.4 });
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const parts: THREE.Object3D[] = [];

    const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
      const len = a.distanceTo(b);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
      mesh.castShadow = shadows;
      parts.push(mesh);
      parent.add(mesh);
      return mesh;
    };

    // road geometry: BB (0,0.28,0), seat cluster (0,0.92,-0.42), head tube (0,0.88,0.52)
    tube(V(0, 0.28, 0.0), V(0, 0.9, 0.52), 0.026, frameMat);            // down tube
    tube(V(0, 0.9, 0.5), V(0, 0.9, -0.4), 0.024, frameMat);             // top tube
    tube(V(0, 0.28, 0.0), V(0, 0.92, -0.42), 0.025, frameMat);          // seat tube
    for (const side of [-0.055, 0.055]) {
      tube(V(side, 0.28, 0.0), V(side, 0.335, -0.56), 0.016, frameMat); // chainstay
      tube(V(side, 0.335, -0.56), V(side, 0.9, -0.42), 0.016, frameMat); // seatstay
      tube(V(side, 0.28, 0.0), V(side, 0.335, 0.56), 0.016, frameMat);  // front fork leg
      tube(V(side, 0.335, 0.56), V(side, 0.88, 0.52), 0.016, frameMat);
    }

    // spoked wheels: tire torus + rim torus + hub + spokes
    const R = 0.335;
    const tireGeo = new THREE.TorusGeometry(R, 0.03, 10, 32);
    tireGeo.rotateY(Math.PI / 2);
    const rimGeo = new THREE.TorusGeometry(R - 0.045, 0.012, 8, 28);
    rimGeo.rotateY(Math.PI / 2);
    for (const zOff of [-0.56, 0.56]) {
      const wheel = new THREE.Group();
      wheel.position.set(0, R, zOff);
      const tire = new THREE.Mesh(tireGeo, darkMat);
      tire.castShadow = shadows;
      const rim = new THREE.Mesh(rimGeo, frameMat);
      wheel.add(tire, rim);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.09, 8), darkMat);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      for (let s = 0; s < 12; s++) {
        const a = (s / 12) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, R * 2 - 0.09, 4), darkMat);
        spoke.position.set(0, Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95);
        spoke.rotation.x = -a;
        wheel.add(spoke);
      }
      this.wheels.push(tire);
      parts.push(wheel);
      parent.add(wheel);
    }

    // cranks + pedals
    const crankGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.17, 6);
    crankGeo.translate(0, -0.085, 0);
    for (const side of [-0.08, 0.08]) {
      const arm = new THREE.Mesh(crankGeo, darkMat);
      arm.position.set(side, 0.28, 0);
      parent.add(arm);
      this.cranks.push(arm);
      parts.push(arm);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.12), darkMat);
      pedal.position.set(side, -0.17, 0);
      arm.add(pedal);
    }

    // saddle + drop handlebar
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.035, 0.3), darkMat);
    saddle.position.set(0, 1.06, -0.42);
    parent.add(saddle);
    parts.push(saddle);
    tube(V(-0.21, 0.99, 0.52), V(0.21, 0.99, 0.52), 0.016, darkMat); // flat top
    for (const side of [-0.21, 0.21]) {
      tube(V(side, 0.99, 0.52), V(side, 0.94, 0.6), 0.014, darkMat); // curve down
      tube(V(side, 0.94, 0.6), V(side, 0.86, 0.58), 0.014, darkMat); // drop
    }

    // seatpost + stem
    tube(V(0, 0.92, -0.42), V(0, 1.05, -0.43), 0.014, darkMat);
    tube(V(0, 0.88, 0.52), V(0, 0.99, 0.52), 0.014, darkMat);

    parent.userData.fallback = parts;
  }

  // -------------------------------------------------------------- input ---

  private handleKey(e: KeyboardEvent, down: boolean): void {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (down && !e.repeat) {
      if (e.code === 'KeyE') this.physics.shiftUp();
      if (e.code === 'KeyQ') this.physics.shiftDown();
    }
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  }

  private readInput(): { pedal: boolean; sprint: boolean; brake: boolean; steer: number } {
    const k = this.keys;
    const pedal = k.has('KeyW') || k.has('ArrowUp');
    const brake = k.has('KeyS') || k.has('ArrowDown') || k.has('Space');
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    let steer = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steer += 1;
    return { pedal, sprint, brake, steer };
  }

  cycleCamera(): void {
    this.camView = (this.camView + 1) % 4;
  }

  // ---------------------------------------------------------- simulation ---

  private updateRide(dt: number): void {
    const input = this.readInput();
    const grad = this.route.gradientAt(this.distance);
    this.physics.setGradient(grad);
    this.physics.update(dt, input);

    this.distance += this.physics.speed * dt;
    this.lateral += (input.steer * 1.4 - this.lateral) * Math.min(1, dt * 2.5);
    this.lateral = Math.min(1.6, Math.max(-1.6, this.lateral));

    // laps
    if (this.distance - this.lastLapMark >= this.route.length) {
      this.lastLapMark += this.route.length;
      this.laps++;
    }

    // elevation + stats
    const y = this.route.pointAt(this.distance).y;
    if (y > this.lastY) this.elevation += y - this.lastY;
    this.lastY = y;
    this.rideTime += dt;
    if (this.physics.speed > 0.5) this.movingTime += dt;
    this.powerSum += this.physics.power; this.powerN++;
    this.maxPower = Math.max(this.maxPower, this.physics.power);
    this.hrSum += this.physics.heartRate; this.hrN++;
    this.maxSpeed = Math.max(this.maxSpeed, this.physics.speed);
    this.calories += (this.physics.power * dt) / 1000;

    // world time + weather
    this.hour = (this.hour + dt / 60) % 24;
    this.weatherTimer += dt;
    if (this.weatherTimer >= 180) {
      this.weatherTimer = 0;
      const next = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
      this.weather = next;
      if (this.scene?.fog) (this.scene.fog as THREE.FogExp2).density = WEATHER_PARAMS[next].fog;
    }

    this.updateZoneAndSegments();
  }

  private updateZoneAndSegments(): void {
    const frac = ((this.distance % this.route.length) + this.route.length) % this.route.length / this.route.length;
    for (const z of this.world.zones) {
      if (frac >= z.from && frac < z.to) { this.zone = z.name; break; }
    }

    // segment tracking (wrap-aware: handles the lap-crossing case)
    const d = ((this.distance % this.route.length) + this.route.length) % this.route.length;
    const prev = this.lastDist;
    const crossed = (mark: number) => {
      if (d >= prev) return prev < mark && mark <= d;
      return prev < mark || mark <= d; // wrapped
    };
    if (!this.activeSegment) {
      for (const seg of this.world.segments) {
        if (crossed(seg.from * this.route.length)) {
          this.activeSegment = {
            name: seg.name,
            start: seg.from * this.route.length,
            end: seg.to * this.route.length,
            startTime: this.rideTime,
          };
          this.callbacks.onSegmentEvent({ kind: 'enter', name: seg.name });
          break;
        }
      }
    } else if (crossed(this.activeSegment.end)) {
      const elapsed = this.rideTime - this.activeSegment.startTime;
      const key = `velodroma_pb_${this.world.id}`;
      let pbs: Record<string, number> = {};
      try { pbs = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* ignore */ }
      const best = pbs[this.activeSegment.name];
      const isPb = !best || elapsed < best;
      if (isPb) {
        pbs[this.activeSegment.name] = elapsed;
        localStorage.setItem(key, JSON.stringify(pbs));
      }
      const name = this.activeSegment.name;
      this.activeSegment = null;
      this.callbacks.onSegmentEvent({ kind: 'complete', name, seconds: elapsed, isPb, isKom: isPb });
    }
    this.lastDist = d;
  }

  private updateVisuals(dt: number): void {
    if (!this.rider || !this.scene) return;
    const s = this.route.sample(this.distance);
    const sideL = { x: s.tz, z: -s.tx };
    const px = s.x + sideL.x * this.lateral;
    const pz = s.z + sideL.z * this.lateral;

    this.rider.position.set(px, s.y, pz);
    this.rider.rotation.y = Math.atan2(s.tx, s.tz);
    this.rider.rotation.z = -this.lateral * 0.14;

    // wheels (roll forward: +rotation.x moves the top toward +Z) + cranks
    const spin = (this.physics.speed / 0.34) * dt;
    for (const w of this.wheels) w.rotation.x += spin;
    if (this.physics.cadence > 2) this.crankPhase += (this.physics.cadence / 60) * Math.PI * 2 * dt;
    const crankCount = this.cranks.length;
    for (let i = 0; i < crankCount; i++) {
      // the CC0 model animates both arms as one node; the fallback has two arms
      this.cranks[i].rotation.x = this.crankPhase + (crankCount === 2 && i === 1 ? Math.PI : 0);
    }
    if (this.bikeSteer) this.bikeSteer.rotation.y = -this.lateral * 0.25;
    if (this.bikeKickstand) this.bikeKickstand.visible = this.physics.speed < 0.4;

    // ---- rider articulation: 2-bone IK (law of cosines), matched to the bike ----
    const BB = new THREE.Vector3(0, 0.28, -0.105); // bottom bracket (CC0 bike)
    const CRANK_R = 0.17;
    const HIP = new THREE.Vector3(0, 1.01, -0.44);
    const up = new THREE.Vector3(0, 1, 0);

    // torso lean: aero under power, relaxed when coasting
    const leanTarget = this.physics.power > 480 ? 0.82 : this.physics.power > 60 ? 0.66 : 0.5;
    if (this.torso) {
      this.leanCur += (leanTarget - this.leanCur) * Math.min(1, dt * 2.5);
      this.torso.rotation.x = this.leanCur;
      // subtle breathing bob
      this.torso.position.y = 1.01 + Math.sin(performance.now() / 480) * 0.006;
    }

    const solveIK = (
      root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number,
      bendHint: THREE.Vector3, upper: THREE.Mesh | null, lower: THREE.Mesh | null
    ) => {
      if (!upper || !lower) return;
      const dir = target.clone().sub(root);
      let d = dir.length();
      dir.divideScalar(d || 1);
      // clamp into the reachable annulus (straightens the limb at full extension)
      d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.02), l1 + l2 - 0.01);
      const reach = root.clone().addScaledVector(dir, d);
      const a = (l1 * l1 + d * d - l2 * l2) / (2 * d);
      const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      // bend direction projected perpendicular to the limb line
      const perp = bendHint.clone().addScaledVector(dir, -bendHint.dot(dir));
      if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
      perp.normalize();
      const joint = root.clone().addScaledVector(dir, a).addScaledVector(perp, h);
      const orient = (mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, restR: number) => {
        const seg = to.clone().sub(from);
        const len = Math.max(seg.length(), 0.02);
        mesh.position.copy(from).add(to).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(up, seg.divideScalar(len));
        mesh.scale.set(1, len, 1);
        void restR;
      };
      orient(upper, root, joint, l1);
      orient(lower, joint, reach, l2);
    };

    // legs: knees bend forward (+Z), feet follow the crank circle
    for (const [i, upper, lower] of [
      [0, this.legUpperL, this.legLowerL],
      [1, this.legUpperR, this.legLowerR],
    ] as [number, THREE.Mesh | null, THREE.Mesh | null][]) {
      const phase = this.crankPhase + (i === 1 ? Math.PI : 0);
      const sideX = i === 0 ? -0.165 : 0.165;
      const pedal = new THREE.Vector3(sideX, BB.y + Math.cos(phase) * CRANK_R, BB.z + Math.sin(phase) * CRANK_R);
      const hip = new THREE.Vector3(i === 0 ? -0.1 : 0.1, HIP.y, HIP.z);
      solveIK(hip, pedal, 0.46, 0.5, new THREE.Vector3(0, 0, 1), upper, lower);
    }

    // arms: hands on the bars, elbows bend down-outward
    const barTarget = this.glbBike
      ? new THREE.Vector3(0, 0.965, 0.335)
      : new THREE.Vector3(0, 0.975, 0.5);
    for (const [i, upper, lower] of [
      [0, this.armUpperL, this.armLowerL],
      [1, this.armUpperR, this.armLowerR],
    ] as [number, THREE.Mesh | null, THREE.Mesh | null][]) {
      const sideX = i === 0 ? -0.2 : 0.2;
      const shoulder = new THREE.Vector3(i === 0 ? -0.185 : 0.185, 0.44, 0.02);
      if (this.torso) {
        shoulder.applyEuler(this.torso.rotation).add(this.torso.position);
      }
      const hand = new THREE.Vector3(sideX, barTarget.y, barTarget.z);
      solveIK(shoulder, hand, 0.32, 0.33, new THREE.Vector3(0, -1, sideX * 0.6), upper, lower);
    }

    // clouds + sun disc ride along (they read as infinitely far)
    if (this.clouds) {
      this.clouds.position.set(px, 0, pz);
      this.clouds.rotation.y += dt * 0.004;
    }

    // camera
    const forward = new THREE.Vector3(s.tx, 0, s.tz);
    const speedKmh = this.physics.speed * 3.6;
    let target: THREE.Vector3;
    if (this.state === 'idle') {
      const t = performance.now() / 1000;
      target = new THREE.Vector3(px + Math.cos(t * 0.25) * 9, s.y + 3.4, pz + Math.sin(t * 0.25) * 9);
    } else {
      switch (this.camView) {
        case 0: target = new THREE.Vector3(px, s.y, pz).addScaledVector(forward, -5.2).add(new THREE.Vector3(0, 2.1, 0)); break;
        case 1: target = new THREE.Vector3(px, s.y, pz).addScaledVector(forward, -3.2).add(new THREE.Vector3(0, 1.6, 0)); break;
        case 2: target = new THREE.Vector3(px, s.y, pz).addScaledVector(forward, 0.4).add(new THREE.Vector3(0, 1.35, 0)); break;
        default: target = new THREE.Vector3(px, s.y, pz).addScaledVector(forward, -10).add(new THREE.Vector3(0, 9, 0));
      }
    }
    this.camPos.lerp(target, Math.min(1, dt * 6));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(px + forward.x * 2, s.y + 1.0, pz + forward.z * 2);
    const targetFov = this.state === 'idle' ? 55 : 62 + Math.min(22, speedKmh / 8);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 2);
    this.camera.updateProjectionMatrix();

    // sun + sky follow the rider
    const dayPhase = Math.min(1, Math.max(0, Math.sin(((this.hour - 6) / 12) * Math.PI)));
    const w = WEATHER_PARAMS[this.weather];
    if (this.sun) {
      const angle = (this.hour / 24) * Math.PI * 2;
      this.sun.position.set(px + Math.cos(angle) * 250, 180 + dayPhase * 260, pz + Math.sin(angle) * 250);
      this.sun.target.position.set(px, s.y, pz);
      this.sun.target.updateMatrixWorld();
      this.sun.intensity = (0.2 + dayPhase * 1.55) * w.sun;
      this.sun.color.setRGB(1.0, 0.86, 0.7).lerp(new THREE.Color(1.0, 0.98, 0.92), dayPhase);
    }
    if (this.hemi) this.hemi.intensity = 0.16 + dayPhase * 0.34;
    if (this.sunDisc && this.sun) {
      // hang the visible sun along the light direction, far away
      const dir = this.sun.position.clone().sub(new THREE.Vector3(px, s.y, pz)).normalize();
      this.sunDisc.position.set(px, s.y, pz).addScaledVector(dir, this.quality.drawDistance * 1.3);
      this.sunDisc.lookAt(this.camera.position);
      this.sunDisc.visible = dayPhase > 0.02;
      this.sunDisc.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (mat) mat.opacity = dayPhase; // SpriteMaterial/MeshBasicMaterial have opacity
        if (mat && 'transparent' in mat) (mat as THREE.SpriteMaterial).transparent = true;
      });
    }
    if (this.skyMat) {
      const top = SKY_NIGHT_TOP.clone().lerp(SKY_DAY_TOP, dayPhase).multiplyScalar(w.sun > 0.7 ? 1 : 0.8);
      const horizon = SKY_NIGHT_HORIZON.clone().lerp(SKY_DAY_HORIZON, dayPhase).multiplyScalar(w.sun > 0.7 ? 1 : 0.85);
      (this.skyMat.uniforms.topColor.value as THREE.Color).copy(top);
      (this.skyMat.uniforms.horizonColor.value as THREE.Color).copy(horizon);
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setRGB(0.65, 0.72, 0.82).lerp(SKY_NIGHT_TOP, 1 - dayPhase);
    }
  }

  private resize(): void {
    if (!this.canvas) return;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private emitHud(): void {
    const mm = this.route.minimapAt(this.distance);
    const frac = ((this.distance % this.route.length) + this.route.length) % this.route.length;
    const seg = this.activeSegment
      ? { name: this.activeSegment.name, progress: Math.min(1, Math.max(0, (frac * this.route.length - this.activeSegment.start) / (this.activeSegment.end - this.activeSegment.start))) }
      : null;
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    this.callbacks.onHud({
      speedKmh: this.physics.speed * 3.6,
      powerW: this.physics.power,
      heartRate: Math.round(this.physics.heartRate),
      cadence: this.physics.cadence,
      gearFront: this.physics.gearFront,
      gearRear: this.physics.gearRear,
      distanceKm: this.distance / 1000,
      timeS: this.rideTime,
      gradient: this.physics.gradient,
      elevationM: this.elevation,
      clock: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      weather: this.weather,
      zone: this.zone || this.world.zones[0]?.name || '',
      worldName: this.world.name,
      laps: this.laps,
      segment: seg,
      minimapX: mm[0],
      minimapY: mm[1],
      fps: Math.round(this.fpsEma),
      quality: this.quality.key,
      autoQuality: this.autoQuality,
      calories: this.calories,
    });
  }

  private loop(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.lastT) / 1000));
    this.lastT = now;

    this.fpsEma = this.fpsEma * 0.95 + (1 / dt) * 0.05;

    if (this.state === 'riding') {
      this.updateRide(dt);
      // dynamic downshift in auto mode: sustained sub-30 fps
      if (this.autoQuality) {
        if (this.fpsEma < 28) {
          this.lowFpsTime += dt;
          if (this.lowFpsTime > 4 && this.quality.key !== 'low') {
            const next = stepDown(this.quality.key);
            this.quality = QUALITY[next];
            this.lowFpsTime = 0;
            this.buildScene();
            this.callbacks.onQualityDownshift(next);
          }
        } else {
          this.lowFpsTime = Math.max(0, this.lowFpsTime - dt * 2);
        }
      }
    } else {
      // idle/paused: still advance clock slowly so the world feels alive
      this.hour = (this.hour + dt / 60) % 24;
    }
    this.updateVisuals(dt);

    this.hudAccum += dt;
    if (this.hudAccum > 0.125) {
      this.hudAccum = 0;
      this.emitHud();
    }

    this.renderer.render(this.scene!, this.camera);
  }
}

export { QUALITY };
export type { QualityChoice, QualityKey };
