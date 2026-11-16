export type ID = string;

export interface User {
  id: ID;
  username: string;
  email: string;
  name: string;
  avatarUrl?: string;
  bio?: string;
  location?: string;
  weightKg?: number;
  ftp?: number;
  createdAt: string;
  followers: number;
  following: number;
}

export interface ActivitySample {
  t: number; // seconds
  lat?: number;
  lng?: number;
  alt?: number;
  speed?: number; // m/s
  power?: number;
  hr?: number;
  cadence?: number;
  distance?: number; // m
}

export interface Activity {
  id: ID;
  userId: ID;
  userName?: string;
  type: 'ride' | 'run' | 'virtual_ride' | 'race' | 'workout';
  name: string;
  description?: string;
  world?: string;
  route?: string;
  startTime: string;
  elapsedTimeS: number;
  movingTimeS: number;
  distanceM: number;
  elevationGainM: number;
  calories: number;
  avgSpeedMs: number;
  maxSpeedMs: number;
  avgPowerW?: number;
  maxPowerW?: number;
  normalizedPowerW?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  kudosCount: number;
  commentCount: number;
  samples?: ActivitySample[];
  createdAt: string;
}

export interface Segment {
  id: ID;
  name: string;
  description?: string;
  world?: string;
  distanceM: number;
  elevationGainM: number;
  avgGrade: number;
  category: 'flat' | 'sprint' | 'hill' | 'climb' | 'mountain';
  polyline?: [number, number, number][];
  effortCount: number;
  athleteCount: number;
  komTimeS?: number;
  komUser?: string;
  createdAt: string;
}

export interface SegmentEffort {
  id: ID;
  segmentId: ID;
  segmentName?: string;
  activityId: ID;
  userId: ID;
  userName?: string;
  elapsedTimeS: number;
  avgPowerW?: number;
  avgHr?: number;
  isPb: boolean;
  isKom: boolean;
  rank?: number;
  createdAt: string;
}

export interface Comment {
  id: ID;
  activityId: ID;
  userId: ID;
  userName: string;
  avatarUrl?: string;
  text: string;
  createdAt: string;
}

export interface Club {
  id: ID;
  name: string;
  description?: string;
  avatarUrl?: string;
  isPrivate: boolean;
  memberCount: number;
  ownerId: ID;
  createdAt: string;
}

export interface FeedItem {
  id: ID;
  type: 'activity' | 'kudos' | 'comment' | 'join' | 'achievement';
  userId: ID;
  userName: string;
  avatarUrl?: string;
  activity?: Activity;
  message?: string;
  createdAt: string;
}

export interface Workout {
  id: ID;
  name: string;
  description?: string;
  durationMin: number;
  tss: number;
  category: string;
  intervals: { type: string; durationS: number; powerPct: number; cadence?: number }[];
}

export interface TrainingPlan {
  id: ID;
  name: string;
  description?: string;
  weeks: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: ID;
  userName: string;
  avatarUrl?: string;
  elapsedTimeS: number;
  avgPowerW?: number;
  createdAt: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
