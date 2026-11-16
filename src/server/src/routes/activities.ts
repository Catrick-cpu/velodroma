import { Router } from 'express';
import { z } from 'zod';
import { db, uid } from '../db/database.js';
import { authRequired, authOptional, type AuthedRequest } from '../middleware/auth.js';
import { mapActivity } from './users.js';

export const activitiesRouter = Router();

const activitySchema = z.object({
  id: z.string().optional(),
  type: z.string().default('ride'),
  name: z.string().min(1).default('Ride'),
  description: z.string().optional(),
  world: z.string().optional(),
  route: z.string().optional(),
  startTime: z.string().optional(),
  elapsedTimeS: z.number().nonnegative().default(0),
  movingTimeS: z.number().nonnegative().default(0),
  distanceM: z.number().nonnegative().default(0),
  elevationGainM: z.number().nonnegative().default(0),
  calories: z.number().nonnegative().default(0),
  avgSpeedMs: z.number().nonnegative().default(0),
  maxSpeedMs: z.number().nonnegative().default(0),
  avgPowerW: z.number().optional(),
  maxPowerW: z.number().optional(),
  normalizedPowerW: z.number().optional(),
  avgHr: z.number().optional(),
  maxHr: z.number().optional(),
  avgCadence: z.number().optional(),
  samples: z.any().optional()
});

activitiesRouter.post('/', authRequired, (req: AuthedRequest, res) => {
  const parsed = activitySchema.safeParse(req.body.activity || req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid activity data' });
  const a = parsed.data;
  const id = a.id || uid('act_');
  const start = a.startTime || new Date().toISOString();
  db.prepare(`INSERT INTO activities (id,user_id,type,name,description,world,route,start_time,elapsed_time_s,moving_time_s,distance_m,elevation_gain_m,calories,avg_speed_ms,max_speed_ms,avg_power_w,max_power_w,normalized_power_w,avg_hr,max_hr,avg_cadence,samples_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user!.id, a.type, a.name, a.description ?? null, a.world ?? null, a.route ?? null, start,
      a.elapsedTimeS, a.movingTimeS, a.distanceM, a.elevationGainM, a.calories, a.avgSpeedMs, a.maxSpeedMs,
      a.avgPowerW ?? null, a.maxPowerW ?? null, a.normalizedPowerW ?? null, a.avgHr ?? null, a.maxHr ?? null, a.avgCadence ?? null,
      a.samples ? JSON.stringify(a.samples) : null);
  db.prepare('INSERT INTO feed_events (id,type,user_id,activity_id) VALUES (?,?,?,?)').run(uid('fe_'), 'activity', req.user!.id, id);
  const row = db.prepare(`SELECT a.*, u.username as userName FROM activities a JOIN users u ON u.id=a.user_id WHERE a.id=?`).get(id);
  res.json({ ok: true, data: mapActivity(row) });
});

activitiesRouter.get('/feed', authRequired, (req: AuthedRequest, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const rows = db.prepare(`
    SELECT a.*, u.username as userName, u.name as displayName, u.avatar_url as avatarUrl,
      (SELECT COUNT(*) FROM kudos k WHERE k.activity_id=a.id) as kudosCount,
      (SELECT COUNT(*) FROM comments c WHERE c.activity_id=a.id) as commentCount
    FROM activities a JOIN users u ON u.id=a.user_id
    WHERE a.user_id = ? OR a.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
    ORDER BY a.created_at DESC LIMIT ?
  `).all(req.user!.id, req.user!.id, limit);
  res.json({ ok: true, data: rows.map(mapActivity) });
});

activitiesRouter.get('/explore', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const rows = db.prepare(`
    SELECT a.*, u.username as userName,
      (SELECT COUNT(*) FROM kudos k WHERE k.activity_id=a.id) as kudosCount,
      (SELECT COUNT(*) FROM comments c WHERE c.activity_id=a.id) as commentCount
    FROM activities a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT ?
  `).all(limit);
  res.json({ ok: true, data: rows.map(mapActivity) });
});

activitiesRouter.get('/:id', authOptional, (req, res) => {
  const row = db.prepare(`SELECT a.*, u.username as userName,
    (SELECT COUNT(*) FROM kudos k WHERE k.activity_id=a.id) as kudosCount,
    (SELECT COUNT(*) FROM comments c WHERE c.activity_id=a.id) as commentCount
    FROM activities a JOIN users u ON u.id=a.user_id WHERE a.id=?`).get(String(req.params.id)) as any;
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  const act = mapActivity(row);
  if (row.samples_json) (act as any).samples = JSON.parse(row.samples_json);
  const comments = db.prepare(`SELECT c.*, u.username as userName, u.avatar_url as avatarUrl FROM comments c JOIN users u ON u.id=c.user_id WHERE c.activity_id=? ORDER BY c.created_at ASC`).all(String(req.params.id));
  const kudos = db.prepare(`SELECT k.user_id as userId, u.username as userName FROM kudos k JOIN users u ON u.id=k.user_id WHERE k.activity_id=?`).all(String(req.params.id));
  res.json({ ok: true, data: { ...act, comments, kudos } });
});

activitiesRouter.post('/:id/kudos', authRequired, (req: AuthedRequest, res) => {
  db.prepare('INSERT OR IGNORE INTO kudos (activity_id, user_id) VALUES (?, ?)').run(String(req.params.id), req.user!.id);
  res.json({ ok: true });
});
activitiesRouter.delete('/:id/kudos', authRequired, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM kudos WHERE activity_id=? AND user_id=?').run(String(req.params.id), req.user!.id);
  res.json({ ok: true });
});

activitiesRouter.post('/:id/comments', authRequired, (req: AuthedRequest, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Empty comment' });
  const id = uid('cmt_');
  db.prepare('INSERT INTO comments (id, activity_id, user_id, text) VALUES (?,?,?,?)').run(id, String(req.params.id), req.user!.id, text);
  const row = db.prepare(`SELECT c.*, u.username as userName FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?`).get(id);
  res.json({ ok: true, data: row });
});

activitiesRouter.delete('/:id', authRequired, (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT user_id FROM activities WHERE id=?').get(String(req.params.id)) as any;
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  if (row.user_id !== req.user!.id) return res.status(403).json({ ok: false, error: 'Forbidden' });
  db.prepare('DELETE FROM activities WHERE id=?').run(String(req.params.id));
  res.json({ ok: true });
});
