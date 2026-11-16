# Velodroma

Velodroma is a combined **Strava + MyWhoosh** platform:
- **Virtual riding (3D game):** immersive procedural cycling worlds — terrain, roads, climbs, weather, day/night, segments with PB/KOM detection — playable at `/ride` with nothing to install. Graphics presets from **Low** (integrated GPUs) to **Ultra** (high-end PCs), with auto-detection and FPS-based step-down.
- **Social fitness network (web):** activities, feed, kudos/comments, profiles, segments & leaderboards, clubs, training plans/workouts.
- **Desktop apps:** native builds for **macOS, Windows and Linux** (Tauri) — see [Desktop apps](#desktop-apps).
- **Realtime backend:** REST API + WebSocket server for auth, activities, social graph, segment efforts, and live ride events.

## Repository layout

- `src/server` — Node.js/TypeScript API + WebSocket server (Express, SQLite via `node:sqlite`)
- `src/client/web` — React + Vite + Tailwind web app, including the 3D ride engine (`src/game`)
- `src/client/web/public/models` — 3D assets (CC0-licensed, see `models/LICENSE.txt`)
- `desktop/` — Tauri v2 desktop shell (wraps the built web app)
- `.github/workflows/desktop.yml` — release pipeline that builds the desktop apps
- `src/shared` — shared TypeScript types/models
- `docs/`, `docker/`, `scripts/`, `ci/` — supporting assets and automation

## Quick start

### Prerequisites
- Node.js **22.5+ / 24** (the server uses the built-in `node:sqlite` module, run with `--experimental-sqlite`)
- npm 10+

### Install
```bash
npm install
```

### Run in development
```bash
npm run dev
```
- Web app + game: http://localhost:5173
- API: http://localhost:8787/api
- WS:  ws://localhost:8787/ws

The server auto-creates a local SQLite database at `src/server/data/velodroma.db` and seeds demo data on first run.

**Demo login:** `demo` / `password123`

### Play
Open **http://localhost:5173/ride**, pick a world, pick a graphics preset (or leave it on **Auto**), and hit **Start Ride**.

**Controls:**

| Input | Action |
|---|---|
| `W` / `↑` | Pedal |
| `S` / `↓` / `Space` | Brake |
| `Shift` | Sprint |
| `Q` / `E` | Shift gears down / up |
| `A`/`D` or `←`/`→` | Steer / lane position |
| `V` | Cycle camera (chase → close → onboard → drone) |
| `Esc` | Pause / finish ride |

When you finish, the ride summary lets you save the activity straight to your Velodroma feed (sign in first) so friends can give kudos.

### Graphics presets
| Preset | Target | What it changes |
|---|---|---|
| **Auto** (default) | everyone | Detects your GPU, then steps down automatically if FPS drops below ~30 |
| **Low** | integrated GPUs / older laptops | 60% render scale, no shadows, sparse trees, no city props |
| **Medium** | older discrete GPUs | 80% render scale, 1k shadows, utility poles, signs, bridge |
| **High** | modern gaming GPUs | full resolution, 2k shadows, dense tree corridors, alpha-card foliage, NYC skyline |
| **Ultra** | high-end PCs | 4k shadows, extra dense scenery, bigger sun haze, 2.6 km draw distance |

You can switch presets any time from the HUD (top-right) — the world rebuilds instantly without interrupting the ride.

### Worlds
- **Watopia** — volcano loops, ocean causeways, jungle rolls
- **Innsbruck** — alpine climbs, Nordkette KOM, mountain scenery
- **France** — fast rolling lanes through lavender fields
- **New York** — Manhattan skyline backdrop, river causeways, Manhattan Bridge overpass (photogrammetry skyline loads on High/Ultra)

### Build
```bash
npm run build
npm start
```
`npm start` serves the API and the built web app from `src/client/web/dist`.

## Desktop apps

The desktop apps wrap the same web app (Tauri v2): the ride runs fully local/offline;
social features use the hosted API when reachable.

- **Download:** grab the latest installers from the [releases page](https://github.com/Catrick-cpu/velodroma/releases/latest) (`.dmg` for macOS, `.msi`/`.exe` for Windows, `.AppImage`/`.deb` for Linux).
- **Build locally:** the web build must exist first (`npm --workspace src/client/web run build`), then:
  ```bash
  cd desktop && cargo tauri build   # or: npx @tauri-apps/cli build in desktop/
  ```
- **Releases:** push a tag `app-v1.0.0` (or run the *Desktop builds* workflow) — GitHub Actions builds all three platforms and attaches the installers to a release.

## Deployment

### Web (Vercel)
The web app + game deploy to Vercel as a static SPA (`vercel.json` handles the SPA
fallback). The API is **not** part of the Vercel deployment — `node:sqlite` needs a
long-running Node process, so the API lives on any Node host:

- **Web + game (this repo → Vercel):** `vercel deploy --prod`. Ride the game immediately; social API calls fail gracefully until the API is configured.
- **API (any Node host):** `docker compose -f docker/docker-compose.yml up --build` (or `npm run build && npm start`). Point the frontend at it with `VITE_API_BASE=https://your-api-host/api` at build time.

### Environment variables

Server:
- `PORT` (default `8787`)
- `JWT_SECRET` (set in production)
- `VELODROMA_DB_PATH` / `VELODROMA_DATA_DIR`

Web build:
- `VITE_API_BASE` — API base URL (default `/api`)

## 3D assets & licensing

- `public/models/bicycle.glb` — CC0 bicycle model from grab3d.com (public domain, see `public/models/LICENSE.txt`).
- **NYC scenery** (`public/models/nyc/skyline.glb`, `public/models/nyc/bridge.glb`) —
  licensed via CGTrader (Royalty Free). These files are **not included in the
  repository** and must not be redistributed; add them locally after purchase/download.
  The New York world detects their absence and falls back to procedural scenery.

## Core features

### Virtual riding (MyWhoosh-like)
- Four procedural worlds (Watopia, Innsbruck, France, New York) with zones, segment gates, day/night cycle and weather
- Physics-driven speed/power/cadence/heart-rate simulation (gravity, rolling + aero drag, gears)
- Sample-quality scenery: textured asphalt and grass, tree corridors with alpha-card foliage, guardrails with reflectors, wooden utility poles with sagging wires, road signs
- CC0 bicycle model with animated wheels/cranks/steering + 2-bone IK rider (procedural fallback)
- Live HUD: hero speed readout, power/HR zone colors, minimap, gradient, clock, weather, FPS
- Segment detection with PB/KOM tracking (persisted per browser)
- Chase / close / onboard / drone cameras with speed-reactive FOV
- Ride summaries saved as activities to your feed

### Social & tracking (Strava-like)
- User accounts, profiles, followers/following
- Activity upload and feed (kudos, comments)
- Segments, efforts, leaderboards, KOM/PB logic
- Clubs and community
- Training workouts and plans

## Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/users/me`, `GET /api/users/:id`, `GET /api/users/:id/stats`, `GET /api/users/:id/activities`
- `GET/POST /api/activities`, `GET /api/activities/feed`, `GET /api/activities/explore`, `GET /api/activities/:id`
- `POST/DELETE /api/activities/:id/kudos`, `POST /api/activities/:id/comments`
- `GET/POST /api/segments`, `GET /api/segments/:id/leaderboard`, `POST /api/segments/:id/efforts`
- `GET/POST /api/social/clubs`, `POST /api/social/clubs/:id/join`
- `GET /api/training/workouts`, `GET /api/training/plans`

## License

MIT (add your preferred license file for distribution).
