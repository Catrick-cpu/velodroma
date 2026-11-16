import { Navigate, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, createContext, useContext, lazy, Suspense } from 'react';
import { Activity, Apple, AppWindow, Bike, Dumbbell, Flag, Home, LogOut, Map, Menu, Settings, Terminal, Trophy, Users, X, Zap, Flame, Mountain, Timer, Download } from 'lucide-react';
import { Users as UsersApi, Activities, Segments, Social, Training, api } from './lib/api';

const RidePage = lazy(() => import('./pages/RidePage'));

const RELEASES_URL = 'https://github.com/Catrick-cpu/velodroma/releases/latest';

type AuthCtx = { user: any; setUser: (u: any) => void; logout: () => void; refresh: () => Promise<void> };
const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => useContext(Ctx)!;

function fmtDist(m: number) { return `${(m / 1000).toFixed(1)} km`; }
function fmtTime(s: number) { const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60); return h>0?`${h}h ${m}m`:`${m}m ${sec}s`; }
function fmtSpeed(ms: number) { return `${(ms*3.6).toFixed(1)} km/h`; }
function fmtDate(iso: string) { return new Date(iso).toLocaleString(); }

function Avatar({ name, size = 'h-10 w-10 text-base' }: { name: string; size?: string }) {
  return <div className={`${size} rounded-full bg-zinc-800 border border-white/[0.08] flex items-center justify-center font-semibold text-zinc-300`}>{(name || 'U')[0]?.toUpperCase()}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const nav = [
    { to: '/', label: 'Feed', icon: Home },
    { to: '/ride', label: 'Ride', icon: Zap },
    { to: '/explore', label: 'Explore', icon: Map },
    { to: '/segments', label: 'Segments', icon: Flag },
    { to: '/training', label: 'Training', icon: Dumbbell },
    { to: '/clubs', label: 'Clubs', icon: Users },
    { to: '/profile', label: 'Profile', icon: Activity },
  ];
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/85 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-white"><Bike size={15} /></span>
            Velodroma
          </Link>
          <nav className="hidden md:flex items-center gap-0.5">
            {nav.map(n => { const I = n.icon; const active = loc.pathname === n.to; return (
              <Link key={n.to} to={n.to} className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors ${active ? 'bg-white/[0.07] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'}`}>
                <I size={15} /> {n.label}
              </Link>
            );})}
          </nav>
          <div className="flex items-center gap-2">
            {user ? (<>
              <Link to="/profile" className="hidden sm:flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.05]">
                <Avatar name={user.username} size="h-6 w-6 text-[11px]" />
                <span className="text-sm text-zinc-300">{user.username}</span>
              </Link>
              <button onClick={logout} className="btn-secondary !px-2.5 !py-1.5" title="Logout"><LogOut size={15} /></button>
            </>) : <Link to="/login" className="btn-primary">Sign in</Link>}
            <button className="md:hidden btn-secondary !px-2.5 !py-1.5" onClick={()=>setOpen(!open)}>{open?<X size={15}/>:<Menu size={15}/>}</button>
          </div>
        </div>
        {open && <div className="md:hidden border-t border-white/[0.06] px-4 py-3 space-y-0.5 bg-zinc-950">{nav.map(n=>{const I=n.icon;return <Link key={n.to} to={n.to} onClick={()=>setOpen(false)} className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-zinc-300 hover:bg-white/[0.05]"><I size={15}/>{n.label}</Link>})}</div>}
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

function Stat({ icon: I, label, value, sub }: any) {
  return <div className="card p-4"><div className="flex items-center gap-2 text-zinc-400 text-xs mb-1.5"><I size={14} />{label}</div><div className="text-xl font-semibold tabular-nums">{value}</div>{sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}</div>;
}

function ActivityCard({ a, onKudos }: { a: any; onKudos?: (id:string)=>void }) {
  return (
    <div className="card p-5 hover:border-white/[0.12] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={a.userName || 'U'} />
          <div>
            <div className="font-medium text-sm">{a.userName || 'Rider'} <span className="text-zinc-500 font-normal">· {a.type?.replace('_',' ')}</span></div>
            <div className="text-xs text-zinc-500">{fmtDate(a.startTime || a.createdAt)} {a.world ? `· ${a.world}` : ''}</div>
          </div>
        </div>
        <span className="badge">{a.type === 'race' ? 'Race' : a.type === 'virtual_ride' ? 'Virtual' : 'Ride'}</span>
      </div>
      <Link to={`/activity/${a.id}`} className="block mt-3">
        <h3 className="text-base font-medium hover:text-brand-400 transition-colors">{a.name}</h3>
        {a.description && <p className="text-zinc-400 text-sm mt-1">{a.description}</p>}
      </Link>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
        <div><div className="text-xs text-zinc-500">Distance</div><div className="font-medium tabular-nums">{fmtDist(a.distanceM||0)}</div></div>
        <div><div className="text-xs text-zinc-500">Elevation</div><div className="font-medium tabular-nums">{Math.round(a.elevationGainM||0)} m</div></div>
        <div><div className="text-xs text-zinc-500">Time</div><div className="font-medium tabular-nums">{fmtTime(a.movingTimeS||a.elapsedTimeS||0)}</div></div>
        <div><div className="text-xs text-zinc-500">Avg Power</div><div className="font-medium tabular-nums">{a.avgPowerW?`${Math.round(a.avgPowerW)} W`:'—'}</div></div>
      </div>
      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/[0.06] text-sm text-zinc-300">
        <button onClick={()=>onKudos?.(a.id)} className="flex items-center gap-1.5 hover:text-brand-400 transition-colors"><Flame size={15}/> {a.kudosCount||0} kudos</button>
        <span className="flex items-center gap-1.5 text-zinc-400"><Users size={15}/> {a.commentCount||0} comments</span>
        <span className="ml-auto text-zinc-500 tabular-nums">{fmtSpeed(a.avgSpeedMs||0)}</span>
      </div>
    </div>
  );
}

function DownloadSection() {
  const downloads = [
    { icon: Apple, label: 'macOS', sub: '.dmg · Universal' },
    { icon: AppWindow, label: 'Windows', sub: '.msi / .exe' },
    { icon: Terminal, label: 'Linux', sub: '.AppImage / .deb' },
  ];
  return (
    <section className="mt-20">
      <div className="card p-8 md:p-10">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold tracking-tight">Velodroma for Desktop</h2>
          <p className="text-zinc-400 mt-2 text-sm leading-relaxed">
            Native apps for Linux, Windows and macOS — same account, smoother Ultra graphics
            and full-screen rides without browser limits.
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-6">
          {downloads.map(d => { const I = d.icon; return (
            <a key={d.label} href={RELEASES_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3.5 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.14] px-4 py-3.5 transition-colors">
              <I size={20} className="text-zinc-300" />
              <div>
                <div className="text-sm font-medium">{d.label}</div>
                <div className="text-xs text-zinc-500">{d.sub}</div>
              </div>
              <Download size={15} className="ml-auto text-zinc-500" />
            </a>
          );})}
        </div>
        <p className="text-xs text-zinc-500 mt-4">All builds are produced by the release pipeline — grab them from the <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="text-zinc-300 underline underline-offset-2 hover:text-brand-400">releases page</a>. The browser version stays free and needs no install.</p>
      </div>
    </section>
  );
}

function Landing() {
  return (
    <div className="space-y-16 py-4">
      <section className="grid md:grid-cols-[1.1fr_1fr] gap-10 items-center py-6">
        <div>
          <span className="badge mb-5">Virtual riding + social fitness</span>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
            Ride. Race. <span className="text-brand-500">Rise.</span>
          </h1>
          <p className="mt-4 text-base text-zinc-400 leading-relaxed max-w-lg">
            Log real rides, race through virtual worlds, chase KOMs on segments and
            train with structure — all in one platform, playable right in your browser.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link to="/ride" className="btn-primary !px-5 !py-2.5">Play in browser</Link>
            <Link to="/login" className="btn-secondary !px-5 !py-2.5">Get started</Link>
            <Link to="/explore" className="btn-secondary !px-5 !py-2.5">Explore</Link>
          </div>
          <div className="mt-9 flex gap-10">
            {[['4', 'Virtual worlds'], ['Live', 'Segments & KOMs'], ['Pro', 'Training plans']].map(([v, l]) => (
              <div key={l}>
                <div className="text-xl font-semibold tabular-nums">{v}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Live ride telemetry</span>
            <span className="badge"><span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse" /> Live</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat icon={Zap} label="Power" value="286 W" sub="Zone 4 · Threshold" />
            <Stat icon={Timer} label="Speed" value="42.3 km/h" sub="Avg 38.1 km/h" />
            <Stat icon={Activity} label="Heart Rate" value="162 bpm" sub="88% max" />
            <Stat icon={Mountain} label="Gradient" value="6.2%" sub="Volcano KOM" />
          </div>
          <div className="h-24 rounded-lg border border-white/[0.06] flex items-end p-3 gap-1">
            {Array.from({length:24}).map((_,i)=>(<div key={i} className="flex-1 rounded-sm bg-brand-500/70" style={{height:`${30+Math.sin(i*0.7)*25+20}%`}}/>))}
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        {[{icon:Map,title:'Immersive worlds',desc:'Ride Watopia, Innsbruck, France and New York with dynamic weather, day/night cycles and physics-based riding.'},
          {icon:Trophy,title:'Segments & leaderboards',desc:'Compete on sprints, climbs and KOMs. Track personal bests and compare efforts globally.'},
          {icon:Dumbbell,title:'Structured training',desc:'Power-based workouts, FTP plans and analytics that make you faster.'}].map(f=>{const I=f.icon;return (
          <div key={f.title} className="card p-6"><div className="h-9 w-9 rounded-lg bg-white/[0.06] border border-white/[0.06] flex items-center justify-center mb-4"><I size={17} className="text-zinc-300"/></div><h3 className="font-medium">{f.title}</h3><p className="text-zinc-400 mt-1.5 text-sm leading-relaxed">{f.desc}</p></div>
        )})}
      </section>

      <DownloadSection />
    </div>
  );
}

function Login() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<'login'|'register'>('login');
  const [form, setForm] = useState({ login:'demo', password:'password123', username:'', email:'', name:'' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
    async function doLogin(e: React.FormEvent){ e.preventDefault(); setErr(''); setLoading(true); try{ const data:any = await api('/auth/login',{method:'POST',body:JSON.stringify({login:form.login,password:form.password})}); localStorage.setItem('velodroma_token',data.token); setUser(data.user); nav('/'); }catch(ex:any){setErr(ex.message)}finally{setLoading(false)} }
  async function doRegister(e: React.FormEvent){ e.preventDefault(); setErr(''); setLoading(true); try{ const data:any = await api('/auth/register',{method:'POST',body:JSON.stringify({username:form.username,email:form.email,password:form.password,name:form.name})}); localStorage.setItem('velodroma_token',data.token); setUser(data.user); nav('/'); }catch(ex:any){setErr(ex.message)}finally{setLoading(false)} }
  return (
    <div className="max-w-md mx-auto py-10">
      <div className="card p-8">
        <div className="text-center mb-6"><div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand-500 mb-4"><Bike size={20} className="text-white"/></div><h1 className="text-xl font-semibold">{mode==='login'?'Welcome back':'Create your account'}</h1><p className="text-zinc-400 text-sm mt-1">Join the ride on Velodroma</p></div>
        <div className="flex rounded-lg bg-white/[0.05] p-1 mb-5">{['login','register'].map(m => <button key={m} onClick={()=>setMode(m as any)} className={`flex-1 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${mode===m?'bg-zinc-800 text-zinc-100':'text-zinc-400 hover:text-zinc-200'}`}>{m}</button>)}</div>
        {err && <div className="mb-4 text-sm text-red-400 bg-red-500/[0.08] border border-red-500/20 rounded-lg px-3 py-2">{err}</div>}
        {mode==='login' ? (
          <form onSubmit={doLogin} className="space-y-3">
            <input className="input" placeholder="Username or email" value={form.login} onChange={e=>setForm({...form,login:e.target.value})} />
            <input className="input" type="password" placeholder="Password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} />
            <button className="btn-primary w-full" disabled={loading}>{loading?'Signing in...':'Sign in'}</button>
            <p className="text-xs text-zinc-500 text-center">Demo: <span className="text-zinc-300">demo / password123</span></p>
          </form>
        ) : (
          <form onSubmit={doRegister} className="space-y-3">
            <input className="input" placeholder="Full name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} />
            <input className="input" placeholder="Username" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} />
            <input className="input" placeholder="Email" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
            <input className="input" type="password" placeholder="Password (min 6)" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} />
            <button className="btn-primary w-full" disabled={loading}>{loading?'Creating...':'Create account'}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const [feed, setFeed] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{ (async()=>{ try{
    const [f,s] = await Promise.all([Activities.feed().catch(()=>Activities.explore()), UsersApi.stats(user?.id||'me').catch(()=>null)]);
    setFeed(f||[]); setStats(s);
  } finally{ setLoading(false); } })(); },[user]);
  async function giveKudos(id:string){ try{ await Activities.kudos(id); setFeed(feed.map(a=>a.id===id?{...a,kudosCount:(a.kudosCount||0)+1}:a)); }catch{} }
  if (loading) return <div className="text-zinc-500 text-sm py-10 text-center">Loading your feed…</div>;
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Your Feed</h1><Link to="/upload" className="btn-primary text-sm"><Zap size={15}/> Upload Activity</Link></div>
        {feed.length===0 ? <div className="card p-8 text-center text-zinc-500 text-sm">No activities yet. Follow riders or upload your first ride!</div> : feed.map(a=> <ActivityCard key={a.id} a={a} onKudos={giveKudos} />)}
      </div>
      <aside className="space-y-4">
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-4"><Avatar name={user?.username || 'U'} size="h-11 w-11 text-lg" /><div><div className="font-medium">{user?.name || user?.username}</div><div className="text-xs text-zinc-500">@{user?.username}</div></div></div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm"><div><div className="font-semibold tabular-nums">{user?.followers||0}</div><div className="text-zinc-500 text-xs">Followers</div></div><div><div className="font-semibold tabular-nums">{user?.following||0}</div><div className="text-zinc-500 text-xs">Following</div></div><div><div className="font-semibold tabular-nums">{stats?.rides||0}</div><div className="text-zinc-500 text-xs">Rides</div></div></div>
        </div>
        {stats && <div className="space-y-3">
          <Stat icon={Bike} label="Total Distance" value={fmtDist(stats.distance_m||0)} />
          <Stat icon={Mountain} label="Elevation Gain" value={`${Math.round(stats.elevation_m||0)} m`} />
          <Stat icon={Timer} label="Time Riding" value={fmtTime(stats.time_s||0)} />
        </div>}
        <div className="card p-5"><h3 className="font-medium mb-3 text-sm">This Week</h3><div className="h-20 flex items-end gap-1.5">{['M','T','W','T','F','S','S'].map((d,i)=>(<div key={i} className="flex-1 flex flex-col items-center gap-1.5"><div className="w-full rounded-sm bg-brand-500/60" style={{height:`${20+((i*37)%60)+15}%`}}/><span className="text-[10px] text-zinc-500">{d}</span></div>))}</div></div>
      </aside>
    </div>
  );
}

function Explore() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(()=>{ Activities.explore().then(setItems).catch(()=>{}); },[]);
  async function giveKudos(id:string){ try{ await Activities.kudos(id); setItems(items.map(a=>a.id===id?{...a,kudosCount:(a.kudosCount||0)+1}:a)); }catch{} }
  return <div className="space-y-4"><div><h1 className="text-xl font-semibold">Explore</h1><p className="text-zinc-400 text-sm mt-1">See what the community is riding right now.</p></div><div className="grid md:grid-cols-2 gap-4">{items.map(a=> <ActivityCard key={a.id} a={a} onKudos={giveKudos} />)}{items.length===0 && <div className="card p-8 text-center text-zinc-500 text-sm">No public activities yet.</div>}</div></div>;
}

function ActivityDetail() {
  const id = useLocation().pathname.split('/').pop()!;
  const [a, setA] = useState<any>(null);
  const [comment, setComment] = useState('');
  useEffect(()=>{ Activities.get(id).then(setA).catch(()=>{}); },[id]);
  if(!a) return <div className="text-zinc-500 text-sm py-10 text-center">Loading activity…</div>;
  async function postComment(e:any){ e.preventDefault(); if(!comment.trim()) return; try{ await Activities.comment(id, comment); setComment(''); const fresh=await Activities.get(id); setA(fresh);}catch{} }
  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-6">
      <div className="space-y-4">
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4"><Avatar name={a.userName||'U'} /><div><div className="font-medium text-sm">{a.userName}</div><div className="text-xs text-zinc-500">{fmtDate(a.startTime||a.createdAt)} · {a.world||'Outdoor'}</div></div></div>
          <h1 className="text-xl font-semibold">{a.name}</h1>
          {a.description && <p className="text-zinc-400 mt-2 text-sm">{a.description}</p>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {[['Distance',fmtDist(a.distanceM||0)],['Moving Time',fmtTime(a.movingTimeS||0)],['Elevation',`${Math.round(a.elevationGainM||0)} m`],['Calories',`${Math.round(a.calories||0)} kcal`],['Avg Speed',fmtSpeed(a.avgSpeedMs||0)],['Max Speed',fmtSpeed(a.maxSpeedMs||0)],['Avg Power',a.avgPowerW?`${Math.round(a.avgPowerW)} W`:'—'],['Normalized Power',a.normalizedPowerW?`${Math.round(a.normalizedPowerW)} W`:'—'],['Avg HR',a.avgHr?`${Math.round(a.avgHr)} bpm`:'—'],['Max HR',a.maxHr?`${Math.round(a.maxHr)} bpm`:'—'],['Avg Cadence',a.avgCadence?`${Math.round(a.avgCadence)} rpm`:'—'],['Elapsed',fmtTime(a.elapsedTimeS||0)]].map(([l,v])=> <div key={l as string} className="bg-white/[0.03] border border-white/[0.05] rounded-lg p-3"><div className="text-xs text-zinc-500">{l}</div><div className="font-medium mt-1 tabular-nums text-sm">{v}</div></div>)}
          </div>
        </div>
        <div className="card p-6">
          <h2 className="font-medium mb-4">Analysis</h2>
          <div className="h-36 rounded-lg border border-white/[0.06] flex items-end p-4 gap-1">{Array.from({length:40}).map((_,i)=>(<div key={i} className="flex-1 rounded-sm bg-brand-500/60" style={{height:`${20+Math.abs(Math.sin(i*0.4))*70}%`}}/>))}</div>
          <p className="text-xs text-zinc-500 mt-2">Power stream visualization (sample data shown when detailed samples unavailable)</p>
        </div>
        <div className="card p-6">
          <h2 className="font-medium mb-4">Comments ({a.comments?.length||0})</h2>
          <div className="space-y-3 mb-4">{(a.comments||[]).map((c:any)=>(<div key={c.id} className="flex gap-3"><Avatar name={c.userName||'U'} size="h-7 w-7 text-[11px]" /><div><div className="text-sm"><span className="font-medium">{c.userName}</span> <span className="text-zinc-400">{c.text}</span></div><div className="text-xs text-zinc-500">{fmtDate(c.created_at||c.createdAt)}</div></div></div>))}{(!a.comments||a.comments.length===0)&&<div className="text-zinc-500 text-sm">No comments yet.</div>}</div>
          <form onSubmit={postComment} className="flex gap-2"><input className="input" placeholder="Add a comment..." value={comment} onChange={e=>setComment(e.target.value)} /><button className="btn-primary">Post</button></form>
        </div>
      </div>
      <aside className="space-y-4">
        <div className="card p-5"><h3 className="font-medium mb-3 text-sm">Kudos ({a.kudos?.length||0})</h3><div className="flex flex-wrap gap-2">{(a.kudos||[]).map((k:any)=><span key={k.userId} className="badge">{k.userName}</span>)}{(!a.kudos||a.kudos.length===0)&&<span className="text-sm text-zinc-500">Be the first to give kudos!</span>}</div><button className="btn-primary w-full mt-4" onClick={async()=>{try{await Activities.kudos(id); setA(await Activities.get(id));}catch{}}}><Flame size={15}/> Give Kudos</button></div>
        <div className="card p-5"><h3 className="font-medium mb-2 text-sm">Device & Context</h3><div className="text-sm text-zinc-300 space-y-1"><div>Type: {a.type}</div><div>World: {a.world||'—'}</div><div>Route: {a.route||'—'}</div></div></div>
      </aside>
    </div>
  );
}

function SegmentsPage() {
  const [segs, setSegs] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<any>(null);
  const [lb, setLb] = useState<any[]>([]);
  useEffect(()=>{ Segments.list().then(setSegs).catch(()=>{}); },[]);
  async function search(e:any){ e.preventDefault(); setSegs(await Segments.list({q}).catch(()=>[])); }
  async function open(s:any){ setSel(s); setLb(await Segments.leaderboard(s.id).catch(()=>[])); }
  const catColor: any = { flat:'bg-zinc-500/15 text-zinc-300', sprint:'bg-yellow-500/15 text-yellow-300', hill:'bg-orange-500/15 text-orange-300', climb:'bg-red-500/15 text-red-300', mountain:'bg-fuchsia-500/15 text-fuchsia-300' };
  return (
    <div className="grid lg:grid-cols-[1fr_420px] gap-6">
      <div className="space-y-4">
        <div><h1 className="text-xl font-semibold">Segments</h1><p className="text-zinc-400 text-sm mt-1">Sprints, climbs and KOMs to chase.</p></div>
        <form onSubmit={search} className="flex gap-2"><input className="input" placeholder="Search segments..." value={q} onChange={e=>setQ(e.target.value)} /><button className="btn-primary">Search</button></form>
        <div className="space-y-3">{segs.map(s=> (
          <button key={s.id} onClick={()=>open(s)} className={`w-full text-left card p-4 hover:border-white/[0.12] transition-colors ${sel?.id===s.id?'border-brand-500/40':''}`}>
            <div className="flex items-center justify-between gap-3"><div><div className="font-medium text-sm">{s.name}</div><div className="text-xs text-zinc-500">{s.world||'Unknown world'} · {fmtDist(s.distanceM)} · {Math.round(s.elevationGainM)} m elev</div></div><span className={`badge ${catColor[s.category]||''}`}>{s.category}</span></div>
            <div className="flex gap-4 mt-2 text-xs text-zinc-500"><span>{s.effortCount} efforts</span><span>{s.athleteCount} athletes</span>{s.komUser && <span className="text-yellow-300/90">★ {s.komUser} {fmtTime(s.komTimeS)}</span>}</div>
          </button>
        ))}{segs.length===0 && <div className="card p-8 text-center text-zinc-500 text-sm">No segments found.</div>}</div>
      </div>
      <aside className="space-y-4">
        {sel ? <div className="card p-5 sticky top-20"><div className="flex items-center justify-between mb-2"><h2 className="font-medium">{sel.name}</h2><span className={`badge ${catColor[sel.category]||''}`}>{sel.category}</span></div><div className="text-xs text-zinc-500 mb-4">{fmtDist(sel.distanceM)} · {Math.round(sel.elevationGainM)} m · avg {sel.avgGrade}%</div><h3 className="text-sm font-medium mb-2 flex items-center gap-1.5"><Trophy size={14} className="text-yellow-300/90"/> Leaderboard</h3><div className="space-y-1.5">{lb.map((e:any)=>(<div key={e.effortId||e.rank} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.05] rounded-lg px-3 py-2"><div className="flex items-center gap-2.5"><span className={`w-5 text-xs font-semibold ${e.rank===1?'text-yellow-300':e.rank===2?'text-zinc-200':e.rank===3?'text-amber-500':'text-zinc-500'}`}>{e.rank}</span><span className="text-sm">{e.userName}</span></div><div className="text-sm"><span className="font-medium tabular-nums">{fmtTime(e.elapsedTimeS)}</span>{e.avgPowerW && <span className="text-zinc-500 ml-2 tabular-nums">{Math.round(e.avgPowerW)}W</span>}</div></div>))}{lb.length===0 && <div className="text-zinc-500 text-sm">No efforts yet.</div>}</div></div> : <div className="card p-8 text-center text-zinc-500 text-sm sticky top-20">Select a segment to view the leaderboard.</div>}
      </aside>
    </div>
  );
}

function TrainingPage() {
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  useEffect(()=>{ Training.workouts().then(setWorkouts).catch(()=>{}); Training.plans().then(setPlans).catch(()=>{}); },[]);
  const catColors:any={recovery:'bg-zinc-400',endurance:'bg-sky-400',sweet_spot:'bg-emerald-400',threshold:'bg-amber-400',vo2max:'bg-orange-400',anaerobic:'bg-red-400'};
  return (
    <div className="space-y-8">
      <div><h1 className="text-xl font-semibold">Training</h1><p className="text-zinc-400 text-sm mt-1">Structured workouts and plans to build your fitness.</p></div>
      <section><h2 className="text-base font-medium mb-3">Training Plans</h2><div className="grid md:grid-cols-2 gap-4">{plans.map(p=>(<div key={p.id} className="card p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{p.name}</h3><p className="text-zinc-400 text-sm mt-1">{p.description}</p></div><span className="badge whitespace-nowrap">{p.weeks} weeks</span></div><button className="btn-primary mt-4">Start Plan</button></div>))}{plans.length===0 && <div className="card p-8 text-center text-zinc-500 text-sm">No plans yet.</div>}</div></section>
      <section><h2 className="text-base font-medium mb-3">Workouts</h2><div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">{workouts.map(w=>(<div key={w.id} className="card p-5 overflow-hidden relative"><div className={`absolute top-0 left-0 right-0 h-0.5 ${catColors[w.category]||'bg-brand-500'}`}/><div className="flex items-center justify-between mt-1"><span className="badge capitalize">{w.category?.replace('_',' ')}</span><span className="text-xs text-zinc-500">TSS {w.tss}</span></div><h3 className="font-medium mt-2.5">{w.name}</h3><p className="text-zinc-400 text-sm mt-1">{w.description}</p><div className="flex items-center gap-4 mt-3 text-xs text-zinc-400"><span className="flex items-center gap-1"><Timer size={13}/> {w.durationMin} min</span><span>{w.intervals?.length||0} intervals</span></div><div className="mt-3 h-10 flex items-end gap-0.5">{(w.intervals||[]).map((iv:any,i:number)=>(<div key={i} className="flex-1 rounded-sm bg-brand-500/50" style={{height:`${Math.max(20, (iv.powerPct||0.5)*80)}%`, opacity: iv.type==='rest'?0.4:0.9}} title={`${iv.type} ${Math.round((iv.powerPct||0)*100)}%`} />))}{(!w.intervals||w.intervals.length===0)&&<div className="text-xs text-zinc-500">Structured interval player coming soon</div>}</div><button className="btn-secondary w-full mt-4">View Workout</button></div>))}{workouts.length===0 && <div className="card p-8 text-center text-zinc-500 text-sm">No workouts yet.</div>}</div></section>
    </div>
  );
}

function ClubsPage() {
  const [clubs, setClubs] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  useEffect(()=>{ Social.clubs().then(setClubs).catch(()=>{}); },[]);
  async function open(id:string){ setSel(await Social.club(id).catch(()=>null)); }
  async function join(id:string){ try{ await Social.joinClub(id); if(sel?.id===id) open(id); }catch{} }
  return (
    <div className="grid lg:grid-cols-[1fr_420px] gap-6">
      <div className="space-y-4"><div><h1 className="text-xl font-semibold">Clubs</h1><p className="text-zinc-400 text-sm mt-1">Find your crew and ride together.</p></div>
        <div className="grid md:grid-cols-2 gap-4">{clubs.map(c=>(<button key={c.id} onClick={()=>open(c.id)} className={`text-left card p-5 hover:border-white/[0.12] transition-colors ${sel?.id===c.id?'border-brand-500/40':''}`}><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-lg bg-zinc-800 border border-white/[0.06] flex items-center justify-center font-medium">{c.name[0]}</div><div><div className="font-medium text-sm">{c.name}</div><div className="text-xs text-zinc-500">{c.memberCount} members · {c.isPrivate?'Private':'Public'}</div></div></div><p className="text-sm text-zinc-400 mt-3 line-clamp-2">{c.description||'No description'}</p></button>))}{clubs.length===0 && <div className="card p-8 text-center text-zinc-500 text-sm">No clubs yet.</div>}</div>
      </div>
      <aside>{sel ? <div className="card p-5 sticky top-20"><h2 className="font-medium">{sel.name}</h2><p className="text-zinc-400 text-sm mt-1">{sel.description}</p><div className="text-sm text-zinc-300 mt-3">{sel.memberCount} members</div><button className="btn-primary mt-4 w-full" onClick={()=>join(sel.id)}>Join Club</button><h3 className="text-sm font-medium mt-5 mb-2">Members</h3><div className="space-y-2 max-h-80 overflow-auto">{(sel.members||[]).map((m:any)=>(<div key={m.id} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.05] rounded-lg px-3 py-2"><span className="text-sm">{m.name||m.username}</span><span className="badge">{m.role}</span></div>))}</div></div> : <div className="card p-8 text-center text-zinc-500 text-sm sticky top-20">Select a club to see details.</div>}</aside>
    </div>
  );
}

function ProfilePage() {
  const { user, setUser } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [acts, setActs] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user?.name||'', bio: user?.bio||'', location: user?.location||'', ftp: user?.ftp||200, weightKg: user?.weightKg||70 });
  useEffect(()=>{ if(!user) return; UsersApi.stats(user.id).then(setStats).catch(()=>{}); UsersApi.activities(user.id).then(setActs).catch(()=>{}); },[user]);
  async function save(e:any){ e.preventDefault(); try{ const u=await UsersApi.updateMe(form); setUser(u); setEditing(false);}catch{} }
  if(!user) return null;
  return (
    <div className="space-y-6">
      <div className="card p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="h-16 w-16 rounded-2xl bg-zinc-800 border border-white/[0.08] flex items-center justify-center text-2xl font-semibold text-zinc-300">{user.username?.[0]?.toUpperCase()}</div>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">{user.name}</h1>
            <div className="text-zinc-500 text-sm">@{user.username} {user.location?`· ${user.location}`:''}</div>
            {user.bio && <p className="text-zinc-400 mt-2 text-sm">{user.bio}</p>}
            <div className="flex gap-4 mt-3 text-sm"><span><b className="tabular-nums">{user.followers||0}</b> <span className="text-zinc-500">followers</span></span><span><b className="tabular-nums">{user.following||0}</b> <span className="text-zinc-500">following</span></span><span><b className="tabular-nums">{user.ftp||'—'}</b> <span className="text-zinc-500">FTP</span></span></div>
          </div>
          <button className="btn-secondary" onClick={()=>setEditing(!editing)}><Settings size={15}/> Edit Profile</button>
        </div>
        {editing && <form onSubmit={save} className="grid md:grid-cols-2 gap-3 mt-6 pt-6 border-t border-white/[0.06]"><input className="input" placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input className="input" placeholder="Location" value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/><input className="input md:col-span-2" placeholder="Bio" value={form.bio} onChange={e=>setForm({...form,bio:e.target.value})}/><input className="input" type="number" placeholder="FTP (W)" value={form.ftp} onChange={e=>setForm({...form,ftp:Number(e.target.value)})}/><input className="input" type="number" placeholder="Weight (kg)" value={form.weightKg} onChange={e=>setForm({...form,weightKg:Number(e.target.value)})}/><div className="md:col-span-2"><button className="btn-primary">Save changes</button></div></form>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat icon={Bike} label="Rides" value={stats?.rides||0} />
        <Stat icon={Map} label="Distance" value={fmtDist(stats?.distance_m||0)} />
        <Stat icon={Mountain} label="Elevation" value={`${Math.round(stats?.elevation_m||0)} m`} />
        <Stat icon={Timer} label="Time" value={fmtTime(stats?.time_s||0)} />
      </div>
      <div><h2 className="text-base font-medium mb-3">Recent Activities</h2><div className="grid md:grid-cols-2 gap-4">{acts.map(a=> <ActivityCard key={a.id} a={a} />)}{acts.length===0 && <div className="card p-8 text-center text-zinc-500 text-sm">No activities yet.</div>}</div></div>
    </div>
  );
}

function UploadPage() {
  const nav = useNavigate();
  const [f, setF] = useState({ name:'Lunch Ride', type:'ride', distanceKm:25, elevationM:300, movingMin:60, avgPower:200, description:'', world:'Watopia' });
  const [saving,setSaving]=useState(false);
  async function submit(e:any){ e.preventDefault(); setSaving(true); try{ const act={ name:f.name,type:f.type,description:f.description,world:f.world,startTime:new Date().toISOString(),elapsedTimeS:f.movingMin*60,movingTimeS:f.movingMin*60,distanceM:f.distanceKm*1000,elevationGainM:f.elevationM,avgSpeedMs:(f.distanceKm*1000)/(f.movingMin*60),maxSpeedMs:(f.distanceKm*1000)/(f.movingMin*60)*1.3,avgPowerW:f.avgPower,maxPowerW:f.avgPower*1.6,calories:Math.round(f.avgPower*f.movingMin*60/1000/4.184/0.24)}; const res:any=await api('/activities',{method:'POST',body:JSON.stringify({activity:act})}); nav(`/activity/${res.id}`);}catch(err){alert((err as any).message)}finally{setSaving(false)} }
  return <div className="max-w-2xl mx-auto"><h1 className="text-xl font-semibold mb-4">Upload Activity</h1><form onSubmit={submit} className="card p-6 space-y-4">
    <div className="grid md:grid-cols-2 gap-3"><input className="input md:col-span-2" placeholder="Activity name" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/><select className="input" value={f.type} onChange={e=>setF({...f,type:e.target.value})}><option value="ride">Ride</option><option value="virtual_ride">Virtual Ride</option><option value="race">Race</option><option value="workout">Workout</option><option value="run">Run</option></select><input className="input" placeholder="World" value={f.world} onChange={e=>setF({...f,world:e.target.value})}/><label className="text-sm text-zinc-400">Distance (km)<input className="input mt-1" type="number" step="0.1" value={f.distanceKm} onChange={e=>setF({...f,distanceKm:Number(e.target.value)})}/></label><label className="text-sm text-zinc-400">Elevation (m)<input className="input mt-1" type="number" value={f.elevationM} onChange={e=>setF({...f,elevationM:Number(e.target.value)})}/></label><label className="text-sm text-zinc-400">Moving time (min)<input className="input mt-1" type="number" value={f.movingMin} onChange={e=>setF({...f,movingMin:Number(e.target.value)})}/></label><label className="text-sm text-zinc-400">Avg power (W)<input className="input mt-1" type="number" value={f.avgPower} onChange={e=>setF({...f,avgPower:Number(e.target.value)})}/></label></div>
    <textarea className="input min-h-[100px]" placeholder="Description" value={f.description} onChange={e=>setF({...f,description:e.target.value})}/>
    <button className="btn-primary" disabled={saving}>{saving?'Saving...':'Save Activity'}</button>
  </form></div>;
}

/** The ride is immersive/full-screen; every other page renders inside the social shell. */
function Frame({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  if (pathname.startsWith('/ride')) return <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>{children}</Suspense>;
  return <Shell>{children}</Shell>;
}

function App() {
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  async function refresh() { try { setUser(await UsersApi.me()); } catch { localStorage.removeItem('velodroma_token'); setUser(null); } }
  useEffect(()=>{ (async()=>{ if(localStorage.getItem('velodroma_token')) await refresh(); setReady(true); })(); },[]);
  function logout(){ localStorage.removeItem('velodroma_token'); setUser(null); }
  if(!ready) return <div className="min-h-screen flex items-center justify-center text-zinc-500 text-sm">Loading Velodroma…</div>;
  return (
    <Ctx.Provider value={{ user, setUser, logout, refresh }}>
      <Frame>
        <Routes>
          <Route path="/" element={user ? <Dashboard/> : <Landing/>} />
          <Route path="/login" element={user ? <Navigate to="/"/> : <Login/>} />
          <Route path="/ride" element={<RidePage/>} />
          <Route path="/explore" element={<Explore/>} />
          <Route path="/activity/:id" element={<ActivityDetail/>} />
          <Route path="/segments" element={<SegmentsPage/>} />
          <Route path="/training" element={<TrainingPage/>} />
          <Route path="/clubs" element={<ClubsPage/>} />
          <Route path="/profile" element={user ? <ProfilePage/> : <Navigate to="/login"/>} />
          <Route path="/upload" element={user ? <UploadPage/> : <Navigate to="/login"/>} />
          <Route path="*" element={<Navigate to="/"/>} />
        </Routes>
      </Frame>
    </Ctx.Provider>
  );
}
export default App;
