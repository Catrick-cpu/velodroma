import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, db, uid } from './db/database.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { activitiesRouter } from './routes/activities.js';
import { segmentsRouter } from './routes/segments.js';
import { socialRouter } from './routes/social.js';
import { setupRealtime } from './ws/realtime.js';
import bcrypt from 'bcryptjs';

migrate();
try { seed(); } catch (e) { console.error("Seed failed (continuing):", e); }

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Velodroma', version: '1.0.0', ts: new Date().toISOString() }));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/activities', activitiesRouter);
app.use('/api/segments', segmentsRouter);
app.use('/api/social', socialRouter);

// Basic training/workouts endpoints (static-ish builtins)
const workouts = [
  { id: 'recovery_spin', name: 'Recovery Spin', description: 'Easy spinning to promote recovery', durationMin: 30, tss: 15, category: 'recovery', intervals: [{ type: 'warmup', durationS: 300, powerPct: 0.5 }, { type: 'steady', durationS: 1200, powerPct: 0.55 }, { type: 'cooldown', durationS: 300, powerPct: 0.45 }] },
  { id: 'endurance_60', name: 'Endurance Builder', description: 'Steady zone 2 endurance ride', durationMin: 60, tss: 45, category: 'endurance', intervals: [{ type: 'warmup', durationS: 600, powerPct: 0.55 }, { type: 'steady', durationS: 2400, powerPct: 0.7 }, { type: 'cooldown', durationS: 600, powerPct: 0.5 }] },
  { id: 'sweet_spot', name: 'Sweet Spot Intervals', description: '3x10min at 88-94% FTP', durationMin: 60, tss: 65, category: 'sweet_spot', intervals: [{ type: 'warmup', durationS: 600, powerPct: 0.55 }, { type: 'work', durationS: 600, powerPct: 0.9 }, { type: 'rest', durationS: 300, powerPct: 0.5 }, { type: 'work', durationS: 600, powerPct: 0.92 }, { type: 'rest', durationS: 300, powerPct: 0.5 }, { type: 'work', durationS: 600, powerPct: 0.9 }, { type: 'cooldown', durationS: 600, powerPct: 0.5 }] },
  { id: 'threshold_intervals', name: 'Threshold Intervals', description: '4x8min at 95-100% FTP', durationMin: 60, tss: 75, category: 'threshold', intervals: [{ type: 'warmup', durationS: 600, powerPct: 0.55 }, { type: 'work', durationS: 480, powerPct: 0.98 }, { type: 'rest', durationS: 240, powerPct: 0.5 }, { type: 'work', durationS: 480, powerPct: 1.0 }, { type: 'rest', durationS: 240, powerPct: 0.5 }, { type: 'work', durationS: 480, powerPct: 0.98 }, { type: 'rest', durationS: 240, powerPct: 0.5 }, { type: 'work', durationS: 480, powerPct: 1.0 }, { type: 'cooldown', durationS: 360, powerPct: 0.5 }] },
  { id: 'vo2max', name: 'VO2 Max Blasts', description: '5x3min at 110-120% FTP', durationMin: 45, tss: 60, category: 'vo2max', intervals: [] },
];
app.get('/api/training/workouts', (_req, res) => res.json({ ok: true, data: workouts }));
app.get('/api/training/plans', (_req, res) => res.json({ ok: true, data: [
  { id: 'ftp_builder_4w', name: 'FTP Builder (4 Weeks)', description: 'Progressive plan to increase your FTP', weeks: 4 },
  { id: 'race_prep_6w', name: 'Race Prep (6 Weeks)', description: 'Sharpen for event day', weeks: 6 },
] }));

// Serve built web client in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../../client/web/dist');
app.use(express.static(webDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(webDist, 'index.html'), (err) => { if (err) res.status(404).json({ ok: false, error: 'Not found' }); });
});

const port = Number(process.env.PORT) || 8787;
const server = http.createServer(app);
setupRealtime(server);
server.listen(port, () => console.log(`Velodroma server running on http://localhost:${port}`));

function seed() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  if (count > 0) return;
  console.log('Seeding demo data...');
  const users = [
    { id: 'u_demo', username: 'demo', email: 'demo@velodroma.app', name: 'Demo Rider', bio: 'Chasing watts and sunsets.', location: 'Watopia', ftp: 250, weight: 72 },
    { id: 'u_alexa', username: 'alexa', email: 'alexa@velodroma.app', name: 'Alexa Velo', bio: 'Climber. Coffee powered.', location: 'Innsbruck', ftp: 280, weight: 60 },
    { id: 'u_marc', username: 'marc', email: 'marc@velodroma.app', name: 'Marc Sprinter', bio: 'Flat roads & fast finishes.', location: 'France', ftp: 310, weight: 78 },
  ];
  const hash = bcrypt.hashSync('password123', 10);
  const insU = db.prepare('INSERT INTO users (id,username,email,password_hash,name,bio,location,ftp,weight_kg) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const u of users) insU.run(u.id, u.username, u.email, hash, u.name, u.bio, u.location, u.ftp, u.weight);
  db.prepare('INSERT INTO follows (follower_id,following_id) VALUES (?,?)').run('u_demo','u_alexa');
  db.prepare('INSERT INTO follows (follower_id,following_id) VALUES (?,?)').run('u_demo','u_marc');
  db.prepare('INSERT INTO follows (follower_id,following_id) VALUES (?,?)').run('u_alexa','u_demo');

  const segs = [
    { id: 'seg_box_hill', name: 'Box Hill', world: 'London', dist: 2900, elev: 123, grade: 4.2, cat: 'climb' },
    { id: 'seg_volcano', name: 'Volcano KOM', world: 'Watopia', dist: 3700, elev: 120, grade: 3.2, cat: 'climb' },
    { id: 'seg_sprint', name: 'Downtown Sprint', world: 'Watopia', dist: 300, elev: 2, grade: 0.6, cat: 'sprint' },
    { id: 'seg_ventoux', name: 'Mont Ventoux', world: 'France', dist: 21000, elev: 1530, grade: 7.3, cat: 'mountain' },
  ];
  const insS = db.prepare('INSERT INTO segments (id,name,world,distance_m,elevation_gain_m,avg_grade,category) VALUES (?,?,?,?,?,?,?)');
  for (const s of segs) insS.run(s.id, s.name, s.world, s.dist, s.elev, s.grade, s.cat);

  const acts = [
    { id: 'act_1', uid: 'u_demo', type: 'virtual_ride', name: 'Morning Volcano Laps', world: 'Watopia', dist: 32500, elev: 420, time: 3720, move: 3600, pwr: 210, np: 225, hr: 148, spd: 9.0 },
    { id: 'act_2', uid: 'u_alexa', type: 'ride', name: 'Alpine Grind', world: 'Innsbruck', dist: 48200, elev: 1250, time: 7200, move: 6900, pwr: 235, np: 248, hr: 156, spd: 6.9 },
    { id: 'act_3', uid: 'u_marc', type: 'race', name: 'Crit City Blast', world: 'Crit City', dist: 28000, elev: 110, time: 2580, move: 2580, pwr: 295, np: 320, hr: 168, spd: 10.8 },
  ];
  const insA = db.prepare(`INSERT INTO activities (id,user_id,type,name,world,start_time,elapsed_time_s,moving_time_s,distance_m,elevation_gain_m,calories,avg_speed_ms,max_speed_ms,avg_power_w,max_power_w,normalized_power_w,avg_hr,max_hr,avg_cadence)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const a of acts) insA.run(a.id, a.uid, a.type, a.name, a.world, new Date(Date.now()-Math.random()*86400000*3).toISOString(), a.time, a.move, a.dist, a.elev, Math.round(a.pwr*a.move/1000/4.184/0.24), a.spd, a.spd*1.4, a.pwr, a.pwr*1.8, a.np, a.hr, a.hr+25, 88);
  db.prepare('INSERT INTO kudos (activity_id,user_id) VALUES (?,?)').run('act_1','u_alexa');
  db.prepare('INSERT INTO kudos (activity_id,user_id) VALUES (?,?)').run('act_1','u_marc');
  db.prepare('INSERT INTO comments (id,activity_id,user_id,text) VALUES (?,?,?,?)').run(uid('cmt_'),'act_1','u_alexa','Huge watts! 🔥');
  db.prepare('INSERT INTO segment_efforts (id,segment_id,activity_id,user_id,elapsed_time_s,avg_power_w) VALUES (?,?,?,?,?,?)').run(uid('eff_'),'seg_volcano','act_1','u_demo',420,260);
  db.prepare('INSERT INTO segment_efforts (id,segment_id,user_id,elapsed_time_s,avg_power_w) VALUES (?,?,?,?,?)').run(uid('eff_'),'seg_volcano','u_alexa',398,290);
  db.prepare('INSERT INTO segment_efforts (id,segment_id,user_id,elapsed_time_s,avg_power_w) VALUES (?,?,?,?,?)').run(uid('eff_'),'seg_sprint','u_marc',22,850);
  const clubId = uid('club_');
  db.prepare('INSERT INTO clubs (id,name,description,owner_id) VALUES (?,?,?,?)').run(clubId,'Velodroma Racers','Fast rides, good vibes.','u_demo');
  db.prepare('INSERT INTO club_members (club_id,user_id,role) VALUES (?,?,?)').run(clubId,'u_demo','owner');
  db.prepare('INSERT INTO club_members (club_id,user_id,role) VALUES (?,?,?)').run(clubId,'u_alexa','member');
  console.log('Seed complete. Demo login: demo / password123');
}
