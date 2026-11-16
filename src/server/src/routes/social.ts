import { Router } from 'express';
import { db, uid } from '../db/database.js';
import { authRequired, type AuthedRequest } from '../middleware/auth.js';

export const socialRouter = Router();

socialRouter.get('/clubs', (_req, res) => {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM club_members m WHERE m.club_id=c.id) as memberCount FROM clubs c ORDER BY c.created_at DESC LIMIT 100`).all();
  res.json({ ok: true, data: rows.map((r: any) => ({ id: r.id, name: r.name, description: r.description, avatarUrl: r.avatar_url, isPrivate: !!r.is_private, memberCount: r.memberCount, ownerId: r.owner_id, createdAt: r.created_at })) });
});

socialRouter.post('/clubs', authRequired, (req: AuthedRequest, res) => {
  const { name, description, isPrivate } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'Name required' });
  const id = uid('club_');
  db.prepare('INSERT INTO clubs (id,name,description,is_private,owner_id) VALUES (?,?,?,?,?)').run(id, name, description || null, isPrivate ? 1 : 0, req.user!.id);
  db.prepare('INSERT INTO club_members (club_id,user_id,role) VALUES (?,?,?)').run(id, req.user!.id, 'owner');
  const row = db.prepare('SELECT * FROM clubs WHERE id=?').get(id) as any;
  res.json({ ok: true, data: { id: row.id, name: row.name, description: row.description, isPrivate: !!row.is_private, memberCount: 1, ownerId: row.owner_id, createdAt: row.created_at } });
});

socialRouter.post('/clubs/:id/join', authRequired, (req: AuthedRequest, res) => {
  const club = db.prepare('SELECT id FROM clubs WHERE id=?').get(String(req.params.id));
  if (!club) return res.status(404).json({ ok: false, error: 'Not found' });
  db.prepare('INSERT OR IGNORE INTO club_members (club_id,user_id) VALUES (?,?)').run(String(req.params.id), req.user!.id);
  res.json({ ok: true });
});

socialRouter.delete('/clubs/:id/leave', authRequired, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM club_members WHERE club_id=? AND user_id=?').run(String(req.params.id), req.user!.id);
  res.json({ ok: true });
});

socialRouter.get('/clubs/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM clubs WHERE id=?').get(String(req.params.id)) as any;
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  const members = db.prepare(`SELECT u.id, u.username, u.name, u.avatar_url as avatarUrl, m.role FROM club_members m JOIN users u ON u.id=m.user_id WHERE m.club_id=? ORDER BY m.joined_at`).all(String(req.params.id));
  const memberCount = members.length;
  res.json({ ok: true, data: { id: row.id, name: row.name, description: row.description, isPrivate: !!row.is_private, memberCount, ownerId: row.owner_id, createdAt: row.created_at, members } });
});

socialRouter.get('/notifications', authRequired, (req: AuthedRequest, res) => {
  // Simplified: recent kudos/comments on my activities
  const rows = db.prepare(`
    SELECT 'kudos' as type, k.user_id as actorId, u.username as actorName, k.activity_id as activityId, a.name as activityName, k.created_at as createdAt
    FROM kudos k JOIN users u ON u.id=k.user_id JOIN activities a ON a.id=k.activity_id
    WHERE a.user_id=? AND k.user_id != ?
    UNION ALL
    SELECT 'comment' as type, c.user_id as actorId, u.username as actorName, c.activity_id as activityId, a.name as activityName, c.created_at as createdAt
    FROM comments c JOIN users u ON u.id=c.user_id JOIN activities a ON a.id=c.activity_id
    WHERE a.user_id=? AND c.user_id != ?
    ORDER BY createdAt DESC LIMIT 50
  `).all(req.user!.id, req.user!.id, req.user!.id, req.user!.id);
  res.json({ ok: true, data: rows });
});
