# Velodroma Architecture

## Overview
Velodroma unifies social fitness tracking (Strava-like) and virtual cycling simulation (MyWhoosh-like).

## Components
- **Web Client (`src/client/web`)**: React SPA for feed, profiles, activities, segments, clubs, training — plus the built-in 3D ride engine (`src/game`) that runs the virtual worlds directly in the browser (Three.js/WebGL, no install required).
- **Server (`src/server`)**: REST API + WebSocket gateway, SQLite persistence, auth, domain logic.
- **Shared (`src/shared`)**: Cross-platform domain types/contracts.

## Ride engine (`src/client/web/src/game`)
- `worlds.ts` — world definitions (zones, segments, palettes, climb profiles)
- `spline.ts` — closed Catmull-Rom route, terrain (value noise + road blending), minimap
- `physics.ts` — rider physics (power, gradient, rolling/aero drag, gears, HR model)
- `quality.ts` — graphics presets Low → Ultra with GPU auto-detection and FPS self-tuning
- `engine.ts` — Three.js scene/loop: procedural terrain, road, trees, water, sky, day/night, weather, segments
- `../pages/RidePage.tsx` — HUD, world select, quality picker, pause, ride summary, save to feed

## Data model (core)
- Users, Follows
- Activities, Samples, Kudos, Comments
- Segments, Segment Efforts (PB/KOM)
- Clubs, Memberships
- Training Workouts/Plans

## Realtime
WebSocket (`/ws`) handles auth, live player updates, chat, and group ride room events. REST handles durable state and queries.

## Deployment
Single container serves the API + static web build; the game is part of the web build and needs no additional runtime.
