import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, uid } from '../db/database.js';
import { signToken } from '../middleware/auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).max(80)
});

authRouter.post('/register', (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
  const { username, email, password, name } = parsed.data;
  const exists = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (exists) return res.status(409).json({ ok: false, error: 'Username or email already taken' });
  const id = uid('u_');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, username, email, password_hash, name) VALUES (?, ?, ?, ?, ?)').run(id, username, email.toLowerCase(), hash, name);
  const token = signToken({ id, username });
  const user = db.prepare('SELECT id, username, email, name, avatar_url as avatarUrl, bio, location, weight_kg as weightKg, ftp, created_at as createdAt FROM users WHERE id = ?').get(id);
  res.json({ ok: true, data: { token, user } });
});

const loginSchema = z.object({ login: z.string().min(1), password: z.string().min(1) });

authRouter.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid input' });
  const { login, password } = parsed.data;
  const row = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login.toLowerCase()) as any;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  const token = signToken({ id: row.id, username: row.username });
  const { password_hash, ...user } = row;
  res.json({ ok: true, data: { token, user: { ...user, avatarUrl: row.avatar_url, weightKg: row.weight_kg, createdAt: row.created_at } } });
});
