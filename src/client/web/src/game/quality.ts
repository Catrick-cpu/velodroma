// Graphics quality presets for the WebGL client.
// LOW targets integrated GPUs / older laptops; ULTRA targets high-end discrete GPUs.
// "auto" detects the GPU once at startup and dynamically steps down if FPS stays low.

export type QualityKey = 'low' | 'medium' | 'high' | 'ultra';
export type QualityChoice = QualityKey | 'auto';

export interface QualitySpec {
  key: QualityKey;
  label: string;
  description: string;
  /** Multiply device pixel ratio (capped at 2) */
  pixelRatioScale: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Terrain grid cells per side */
  terrainCells: number;
  /** Multiply world tree count */
  treeFactor: number;
  /** Fog / camera far distance in meters */
  drawDistance: number;
  water: boolean;
  roadLines: boolean;
}

export const QUALITY: Record<QualityKey, QualitySpec> = {
  low: {
    key: 'low', label: 'Low', description: 'Integrated GPUs · 60+ fps',
    pixelRatioScale: 0.6, shadows: false, shadowMapSize: 0, terrainCells: 64,
    treeFactor: 0.35, drawDistance: 900, water: false, roadLines: true,
  },
  medium: {
    key: 'medium', label: 'Medium', description: 'Older discrete GPUs',
    pixelRatioScale: 0.8, shadows: true, shadowMapSize: 1024, terrainCells: 96,
    treeFactor: 0.65, drawDistance: 1400, water: true, roadLines: true,
  },
  high: {
    key: 'high', label: 'High', description: 'Modern gaming GPUs',
    pixelRatioScale: 1.0, shadows: true, shadowMapSize: 2048, terrainCells: 128,
    treeFactor: 1.0, drawDistance: 2000, water: true, roadLines: true,
  },
  ultra: {
    key: 'ultra', label: 'Ultra', description: 'High-end PCs · everything on',
    pixelRatioScale: 1.0, shadows: true, shadowMapSize: 4096, terrainCells: 160,
    treeFactor: 1.3, drawDistance: 2600, water: true, roadLines: true,
  },
};

export const QUALITY_ORDER: QualityKey[] = ['low', 'medium', 'high', 'ultra'];

const STORAGE_KEY = 'velodroma_quality';

export function loadQualityPref(): QualityChoice {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'low' || v === 'medium' || v === 'high' || v === 'ultra' || v === 'auto' ? v : 'auto';
}

export function saveQualityPref(q: QualityChoice): void {
  localStorage.setItem(STORAGE_KEY, q);
}

function rendererString(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return '';
    const gl2 = gl as WebGLRenderingContext;
    const ext = gl2.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl2.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl2.getParameter(gl2.RENDERER));
    gl2.getExtension('WEBGL_lose_context')?.loseContext();
    return r.toLowerCase();
  } catch {
    return '';
  }
}

/** One-time GPU/CPU heuristic to pick the starting preset. */
export function detectQuality(): QualityKey {
  const gpu = rendererString();
  const cores = navigator.hardwareConcurrency || 4;
  let score = 40;

  if (/rtx\s?(40|50)|rx\s?[678]9?\d{3}|arc\s?a[57]\d{2}/.test(gpu)) score = 100;
  else if (/rtx\s?(20|30)|rx\s?[56]\d{3}|radeon\s?pro/.test(gpu)) score = 80;
  else if (/rtx|gtx\s?16|gtx\s?10|rx\s?\d{3,4}/.test(gpu)) score = 62;
  else if (/apple\s?m[1-9]|apple\s?gpu/.test(gpu)) score = 75;
  else if (/intel|uhd|iris|swiftshader|mali|adreno|powervr|software/.test(gpu)) score = 25;

  if (cores >= 12) score += 10;
  else if (cores >= 8) score += 5;
  if ((navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4) score -= 15;

  if (score >= 90) return 'ultra';
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

export function stepDown(q: QualityKey): QualityKey {
  const i = QUALITY_ORDER.indexOf(q);
  return QUALITY_ORDER[Math.max(0, i - 1)];
}
