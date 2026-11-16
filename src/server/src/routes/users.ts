import { Router } from 'express';
import { db } from '../db/database.js';
import { authRequired, authOptional, type AuthedRequest } from '../middleware/auth.js';

export const usersRouter = Router();

function shapeUser(row: any) {
  if (!row) return null;
  const followers = (db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(row.id) as any).c;
  const following = (db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(row.id) as any).c;
  return {
    id: row.id, username: row.username, email: row.email, name: row.name,
    avatarUrl: row.avatar_url, bio: row.bio, location: row.location,
    weightKg: row.weight_kg, ftp: row.ftp, createdAt: row.created_at,
    followers, following
  };
}

usersRouter.get('/me', authRequired, (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id);
  res.json({ ok: true, data: shapeUser(row) });
});

usersRouter.put('/me', authRequired, (req: AuthedRequest, res) => {
  const { name, bio, location, weightKg, ftp, avatarUrl } = req.body || {};
  db.prepare(`UPDATE users SET name=COALESCE(?,name), bio=COALESCE(?,bio), location=COALESCE(?,location),
    weight_kg=COALESCE(?,weight_kg), ftp=COALESCE(?,ftp), avatar_url=COALESCE(?,avatar_url) WHERE id=?`)
    .run(name ?? null, bio ?? null, location ?? null, weightKg ?? null, ftp ?? null, avatarUrl ?? null, req.user!.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id);
  res.json({ ok: true, data: shapeUser(row) });
});

usersRouter.get('/search', authOptional, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ ok: true, data: [] });
  const rows = db.prepare(`SELECT * FROM users WHERE username LIKE ? OR name LIKE ? LIMIT 20`).all(`%${q}%`, `%${q}%`);
  res.json({ ok: true, data: rows.map(shapeUser) });
});

usersRouter.get('/:id', authOptional, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ? OR username = ?').get(String(req.params.id), String(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: 'User not found' });
  res.json({ ok: true, data: shapeUser(row) });
});

usersRouter.get('/:id/stats', (req, res) => {
  const row = db.prepare('SELECT id FROM users WHERE id = ? OR username = ?').get(String(req.params.id), String(req.params.id)) as any;
  if (!row) return res.status(404).json({ ok: false, error: 'User not found' });
  const stats = db.prepare(`
    SELECT COUNT(*) as rides, COALESCE(SUM(distance_m),0) as distance_m, COALESCE(SUM(elevation_gain_m),0) as elevation_m,
      COALESCE(SUM(moving_time_s),0) as time_s, COALESCE(SUM(calories),0) as calories,
      COALESCE(AVG(avg_power_w),0) as avg_power, COALESCE(MAX(max_power_w),0) as max_power
    FROM activities WHERE user_id = ?
  `).get(row.id);
  res.json({ ok: true, data: stats });
});

usersRouter.post('/:id/follow', authRequired, (req: AuthedRequest, res) => {
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(String(req.params.id)) as any;
  if (!target) return res.status(404).json({ ok: false, error: 'User not found' });
  if (target.id === req.user!.id) return res.status(400).json({ ok: false, error: 'Cannot follow yourself' });
  db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.user!.id, target.id);
  res.json({ ok: true });
});

usersRouter.delete('/:id/follow', authRequired, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user!.id, String(req.params.id));
  res.json({ ok: true });
});

usersRouter.get('/:id/activities', (req, res) => {
  const row = db.prepare('SELECT id FROM users WHERE id = ? OR username = ?').get(String(req.params.id), String(req.params.id)) as any;
  if (!row) return res.status(404).json({ ok: false, error: 'User not found' });
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const acts = db.prepare(`SELECT a.*, u.username as userName, u.name as displayName,
    (SELECT COUNT(*) FROM kudos k WHERE k.activity_id=a.id) as kudosCount,
    (SELECT COUNT(*) FROM comments c WHERE c.activity_id=a.id) as commentCount
    FROM activities a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY a.created_at DESC LIMIT ?`).all(row.id, limit);
  res.json({ ok: true, data: acts.map(mapActivity) });
});

export function mapActivity(r: any) {
  return {
    id: r.id, userId: r.user_id, userName: r.userName || r.username, type: r.type, name: r.name,
    description: r.description, world: r.world, route: r.route, startTime: r.start_time,
    elapsedTimeS: r.elapsed_time_s, movingTimeS: r.moving_time_s, distanceM: r.distance_m,
    elevationGainM: r.elevation_gain_m, calories: r.calories, avgSpeedMs: r.avg_speed_ms,
    maxSpeedMs: r.max_speed_ms, avgPowerW: r.avg_power_w, maxPowerW: r.max_power_w,
    normalizedPowerW: r.normalized_power_w, avgHr: r.avg_hr, maxHr: r.max_hr, avgCadence: r.avg_cadence,
    kudosCount: r.kudosCount ?? 0, commentCount: r.commentCount ?? 0, createdAt: r.created_at
  };
}
