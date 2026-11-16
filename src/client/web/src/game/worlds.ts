// World definitions (worlds, zones, segments, palettes, climb profiles).

export interface ZoneDef {
  name: string;
  from: number;
  to: number;
}

export interface SegmentDef {
  name: string;
  from: number;
  to: number;
  category: 'climb' | 'sprint' | 'hill' | 'mountain' | 'flat';
}

export interface MountainDef {
  center: [number, number];
  radius: number;
  height: number;
}

export interface WorldDef {
  id: string;
  name: string;
  description: string;
  seed: number;
  worldSize: number;
  hillAmp: number;
  water: boolean;
  waterLevel: number;
  grassColor: [number, number, number];
  treeColor: [number, number, number];
  roadColor: [number, number, number];
  accentColor: [number, number, number];
  treeCount: number;
  climbHeight: number;
  climbCenter: number;
  climbWidth: number;
  radius: [number, number];
  mountains?: boolean;
  /** Photogrammetry city backdrop (skyline + bridge GLBs, quality-gated). */
  city?: boolean;
  zones: ZoneDef[];
  segments: SegmentDef[];
}

export const WORLDS: Record<string, WorldDef> = {
  watopia: {
    id: 'watopia',
    name: 'Watopia',
    description: 'Volcano loops, ocean views and jungle rolls',
    seed: 1101, worldSize: 2800, hillAmp: 12, water: true, waterLevel: 1.4,
    grassColor: [0.23, 0.52, 0.28], treeColor: [0.13, 0.44, 0.22],
    roadColor: [0.15, 0.15, 0.17], accentColor: [0.93, 0.3, 0.55],
    treeCount: 260, climbHeight: 150, climbCenter: 0.62, climbWidth: 0.35,
    radius: [880, 620],
    zones: [
      { name: 'Downtown', from: 0.0, to: 0.14 },
      { name: 'Ocean Drive', from: 0.14, to: 0.4 },
      { name: 'Volcano', from: 0.4, to: 0.68 },
      { name: 'Jungle', from: 0.68, to: 0.86 },
      { name: 'Downtown', from: 0.86, to: 1.0 },
    ],
    segments: [
      { name: 'Volcano KOM', from: 0.44, to: 0.64, category: 'climb' },
      { name: 'Ocean Sprint', from: 0.2, to: 0.27, category: 'sprint' },
      { name: 'Jungle Circuit', from: 0.7, to: 0.84, category: 'hill' },
    ],
  },
  innsbruck: {
    id: 'innsbruck',
    name: 'Innsbruck',
    description: 'Alpine climbs and crisp mountain air',
    seed: 4407, worldSize: 3000, hillAmp: 18, water: false, waterLevel: 0,
    grassColor: [0.31, 0.5, 0.33], treeColor: [0.1, 0.3, 0.2],
    roadColor: [0.17, 0.17, 0.19], accentColor: [0.95, 0.55, 0.15],
    treeCount: 340, climbHeight: 265, climbCenter: 0.5, climbWidth: 0.48,
    radius: [950, 700], mountains: true,
    zones: [
      { name: 'Old Town', from: 0.0, to: 0.2 },
      { name: 'Nordkette Climb', from: 0.2, to: 0.62 },
      { name: 'Alpine Descent', from: 0.62, to: 0.85 },
      { name: 'Old Town', from: 0.85, to: 1.0 },
    ],
    segments: [
      { name: 'Nordkette KOM', from: 0.24, to: 0.6, category: 'mountain' },
      { name: 'Old Town Sprint', from: 0.05, to: 0.12, category: 'sprint' },
      { name: 'Descent Bomb', from: 0.64, to: 0.82, category: 'flat' },
    ],
  },
  france: {
    id: 'france',
    name: 'France',
    description: 'Fast rolling lanes through lavender fields',
    seed: 7702, worldSize: 2600, hillAmp: 9, water: false, waterLevel: 0,
    grassColor: [0.45, 0.55, 0.25], treeColor: [0.25, 0.4, 0.18],
    roadColor: [0.19, 0.18, 0.17], accentColor: [0.2, 0.6, 0.95],
    treeCount: 170, climbHeight: 22, climbCenter: 0.35, climbWidth: 0.15,
    radius: [820, 560],
    zones: [
      { name: 'Provence', from: 0.0, to: 0.35 },
      { name: 'Col Rapid', from: 0.35, to: 0.5 },
      { name: 'Lavender Fields', from: 0.5, to: 0.78 },
      { name: 'Provence', from: 0.78, to: 1.0 },
    ],
    segments: [
      { name: 'Lavender Flat-Out', from: 0.52, to: 0.74, category: 'sprint' },
      { name: 'Col Rapid', from: 0.3, to: 0.48, category: 'hill' },
    ],
  },
  newyork: {
    id: 'newyork',
    name: 'New York',
    description: 'Manhattan skyline, river causeways and the bridge loop',
    seed: 5142, worldSize: 2400, hillAmp: 3, water: true, waterLevel: 0.6,
    grassColor: [0.29, 0.4, 0.28], treeColor: [0.16, 0.36, 0.2],
    roadColor: [0.16, 0.16, 0.18], accentColor: [0.99, 0.76, 0.08],
    treeCount: 150, climbHeight: 9, climbCenter: 0.5, climbWidth: 0.3,
    radius: [720, 520], city: true,
    zones: [
      { name: 'Lower Manhattan', from: 0.0, to: 0.2 },
      { name: 'Hudson Greenway', from: 0.2, to: 0.45 },
      { name: 'Midtown', from: 0.45, to: 0.62 },
      { name: 'Central Park', from: 0.62, to: 0.82 },
      { name: 'East River', from: 0.82, to: 1.0 },
    ],
    segments: [
      { name: 'Hudson Sprint', from: 0.22, to: 0.34, category: 'sprint' },
      { name: 'Manhattan KOM', from: 0.48, to: 0.62, category: 'climb' },
      { name: 'Bridge Circuit', from: 0.8, to: 0.95, category: 'hill' },
    ],
  },
};

export const WORLD_LIST: WorldDef[] = Object.values(WORLDS);
