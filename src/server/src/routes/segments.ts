import { Router } from 'express';
import { db, uid } from '../db/database.js';
import { authRequired, authOptional, type AuthedRequest } from '../middleware/auth.js';

export const segmentsRouter = Router();

function shapeSegment(r: any) {
  const stats = db.prepare(`
    SELECT COUNT(*) as efforts, COUNT(DISTINCT user_id) as athletes, MIN(elapsed_time_s) as best
    FROM segment_efforts WHERE segment_id = ?
  `).get(r.id) as any;
  const kom = db.prepare(`SELECT e.elapsed_time_s as t, u.username as name FROM segment_efforts e JOIN users u ON u.id=e.user_id WHERE e.segment_id=? ORDER BY e.elapsed_time_s ASC LIMIT 1`).get(r.id) as any;
  return {
    id: r.id, name: r.name, description: r.description, world: r.world,
    distanceM: r.distance_m, elevationGainM: r.elevation_gain_m, avgGrade: r.avg_grade,
    category: r.category, effortCount: stats?.efforts || 0, athleteCount: stats?.athletes || 0,
    komTimeS: kom?.t || null, komUser: kom?.name || null, createdAt: r.created_at
  };
}

segmentsRouter.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const world = String(req.query.world || '').trim();
  let sql = 'SELECT * FROM segments WHERE 1=1';
  const params: any[] = [];
  if (q) { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
  if (world) { sql += ' AND world = ?'; params.push(world); }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const rows = db.prepare(sql).all(...params);
  res.json({ ok: true, data: rows.map(shapeSegment) });
});

segmentsRouter.post('/', authRequired, (req: AuthedRequest, res) => {
  const { name, description, world, distanceM, elevationGainM, avgGrade, category, polyline } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'Name required' });
  const id = uid('seg_');
  db.prepare(`INSERT INTO segments (id,name,description,world,distance_m,elevation_gain_m,avg_grade,category,polyline_json,creator_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, name, description || null, world || null, distanceM || 0, elevationGainM || 0, avgGrade || 0, category || 'flat', polyline ? JSON.stringify(polyline) : null, req.user!.id);
  const row = db.prepare('SELECT * FROM segments WHERE id=?').get(id);
  res.json({ ok: true, data: shapeSegment(row) });
});

segmentsRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM segments WHERE id=?').get(String(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, data: shapeSegment(row) });
});

segmentsRouter.get('/:id/leaderboard', (req, res) => {
  const limit = Math.min(Number(req.query.limit as any) || 20, 100);
  const rows = db.prepare(`
    SELECT e.*, u.username as userName, u.avatar_url as avatarUrl
    FROM segment_efforts e JOIN users u ON u.id=e.user_id
    WHERE e.segment_id=? ORDER BY e.elapsed_time_s ASC LIMIT ?
  `).all(String(req.params.id), limit) as any[];
  const data = rows.map((r, i) => ({
    rank: i + 1, effortId: r.id, userId: r.user_id, userName: r.userName, avatarUrl: r.avatar_url,
    elapsedTimeS: r.elapsed_time_s, avgPowerW: r.avg_power_w, avgHr: r.avg_hr, createdAt: r.created_at
  }));
  res.json({ ok: true, data });
});

segmentsRouter.post('/:id/efforts', authRequired, (req: AuthedRequest, res) => {
  const { elapsedTimeS, avgPowerW, avgHr, activityId } = req.body || {};
  if (!elapsedTimeS || elapsedTimeS <= 0) return res.status(400).json({ ok: false, error: 'elapsedTimeS required' });
  const seg = db.prepare('SELECT id FROM segments WHERE id=?').get(String(req.params.id));
  if (!seg) return res.status(404).json({ ok: false, error: 'Segment not found' });
  const id = uid('eff_');
  db.prepare(`INSERT INTO segment_efforts (id,segment_id,activity_id,user_id,elapsed_time_s,avg_power_w,avg_hr) VALUES (?,?,?,?,?,?,?)`)
    .run(id, String(req.params.id), activityId || null, req.user!.id, elapsedTimeS, avgPowerW ?? null, avgHr ?? null);
  const best = db.prepare('SELECT MIN(elapsed_time_s) as t FROM segment_efforts WHERE segment_id=? AND user_id=?').get(String(req.params.id), req.user!.id) as any;
  const kom = db.prepare('SELECT MIN(elapsed_time_s) as t FROM segment_efforts WHERE segment_id=?').get(String(req.params.id)) as any;
  res.json({ ok: true, data: { id, isPb: best.t === elapsedTimeS, isKom: kom.t === elapsedTimeS } });
});

segmentsRouter.post('/:id/star', authRequired, (req: AuthedRequest, res) => {
  db.prepare('INSERT OR IGNORE INTO starred_segments (user_id, segment_id) VALUES (?,?)').run(req.user!.id, String(req.params.id));
  res.json({ ok: true });
});
segmentsRouter.delete('/:id/star', authRequired, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM starred_segments WHERE user_id=? AND segment_id=?').run(req.user!.id, String(req.params.id));
  res.json({ ok: true });
});
