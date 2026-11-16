import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, Cloud, Flag, Gauge, HeartPulse, Mountain, Pause, Play, Save, Square, Timer, Wind } from 'lucide-react';
import { useAuth } from '../App';
import { Activities } from '../lib/api';
import { RideEngine, type HudState, type RideSummary, type SegmentEvent } from '../game/engine';
import { WORLD_LIST, type WorldDef } from '../game/worlds';
import { QUALITY_ORDER, QUALITY, loadQualityPref, type QualityChoice } from '../game/quality';

// ---------------------------------------------------------------- helpers ---

function powerColor(w: number, ftp: number): string {
  if (ftp <= 0) return '#f1f5f9';
  const z = w / ftp;
  if (z > 1.05) return '#f87171';
  if (z > 0.9) return '#fbbf24';
  if (z > 0.75) return '#4ade80';
  if (z > 0.55) return '#38bdf8';
  return '#f1f5f9';
}

function hrColor(bpm: number): string {
  const r = bpm / 190;
  if (r > 0.9) return '#f87171';
  if (r > 0.8) return '#fb923c';
  if (r > 0.7) return '#fde047';
  return '#4ade80';
}

function gradientColor(g: number): string {
  if (g > 0.04) return '#fb923c';
  if (g < -0.02) return '#38bdf8';
  return '#f1f5f9';
}

function fmtTime(s: number): string {
  const t = Math.floor(s);
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- minimap ---

function Minimap({ hud, points }: { hud: HudState; points: [number, number][] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || points.length < 2) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = c.width, h = c.height, pad = 12;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const px = pad + x * (w - 2 * pad), py = pad + y * (h - 2 * pad);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
    const [sx, sy] = points[0];
    ctx.fillStyle = '#34d399';
    ctx.beginPath(); ctx.arc(pad + sx * (w - 2 * pad), pad + sy * (h - 2 * pad), 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ec4899';
    ctx.shadowColor = '#ec4899'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(pad + hud.minimapX * (w - 2 * pad), pad + hud.minimapY * (h - 2 * pad), 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }, [hud.minimapX, hud.minimapY, points]);
  return <canvas ref={ref} width={180} height={180} className="mx-auto" />;
}

// ------------------------------------------------------------------- page ---

export default function RidePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RideEngine | null>(null);

  const [engineWorld, setEngineWorld] = useState(WORLD_LIST[0].id);
  const [worldId, setWorldId] = useState(WORLD_LIST[0].id);
  const [hud, setHud] = useState<HudState | null>(null);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [summary, setSummary] = useState<RideSummary | null>(null);
  const [notice, setNotice] = useState<{ title: string; sub: string; color: string } | null>(null);
  const [qualityChoice, setQualityChoice] = useState<QualityChoice>(loadQualityPref());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const minimapPoints = useRef<[number, number][]>([[0.5, 0.5], [0.5, 0.5]]);

  // --- engine lifecycle (fresh canvas per engine; survives StrictMode remount) ---
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.appendChild(canvas);
    const engine = new RideEngine(canvas, engineWorld, {
      onHud: setHud,
      onSegmentEvent: (e: SegmentEvent) => {
        if (e.kind === 'enter') setNotice({ title: e.name, sub: 'Segment started — go!', color: '#38bdf8' });
        else {
          const t = Math.floor(e.seconds || 0);
          const time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
          if (e.isKom) setNotice({ title: `NEW KOM! ${e.name}`, sub: `${time} — personal best & course record`, color: '#fde047' });
          else if (e.isPb) setNotice({ title: `PERSONAL BEST! ${e.name}`, sub: time, color: '#4ade80' });
          else setNotice({ title: `${e.name} complete`, sub: time, color: '#f1f5f9' });
        }
      },
      onQualityDownshift: (to) => setNotice({ title: 'Graphics adjusted', sub: `Switched to ${QUALITY[to].label} to keep the ride smooth`, color: '#fbbf24' }),
    });
    engineRef.current = engine;
    minimapPoints.current = engine.minimapPoints();
    return () => {
      engine.dispose();
      engineRef.current = null;
      canvas.remove();
    };
  }, [engineWorld]);

  // --- notifications auto-dismiss ---
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(t);
  }, [notice]);

  // --- global hotkeys: Esc pause, V camera ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && started && !summary) {
        setPaused((p) => {
          const next = !p;
          if (next) engineRef.current?.pause(); else engineRef.current?.resume();
          return next;
        });
      } else if (e.code === 'KeyV' && started && !paused) {
        engineRef.current?.cycleCamera();
        setNotice({ title: 'Camera', sub: 'View changed — press V to cycle', color: '#f1f5f9' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, paused, summary]);

  const startRide = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.resetRide();
    eng.startRide();
    setStarted(true);
    setPaused(false);
    setSummary(null);
    setSaveError('');
    setNotice({ title: 'Ride started', sub: 'Pedal with W / ↑ · brake S / ↓ · gears Q / E · camera V', color: '#4ade80' });
  }, []);

  const finishRide = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const s = eng.summary();
    if (s.distanceKm < 0.05) {
      // barely moved — just go back to menu
      eng.endRide();
      setStarted(false);
      setPaused(false);
      return;
    }
    eng.endRide();
    setStarted(false);
    setPaused(false);
    setSummary(s);
  }, []);

  const pickQuality = useCallback((q: QualityChoice) => {
    setQualityChoice(q);
    engineRef.current?.setQuality(q);
  }, []);

  const saveActivity = useCallback(async () => {
    if (!summary) return;
    if (!user) { navigate('/login'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const saved = await Activities.create({
        type: 'virtual_ride',
        name: summary.name,
        world: summary.worldName,
        route: `${summary.worldName} Circuit`,
        startTime: new Date(Date.now() - summary.timeS * 1000).toISOString(),
        elapsedTimeS: Math.round(summary.timeS),
        movingTimeS: Math.round(summary.movingTimeS),
        distanceM: Math.round(summary.distanceKm * 1000),
        elevationGainM: Math.round(summary.elevationM),
        calories: Math.round(summary.calories),
        avgSpeedMs: summary.avgSpeedKmh / 3.6,
        maxSpeedMs: summary.maxSpeedKmh / 3.6,
        avgPowerW: Math.round(summary.avgPowerW),
        maxPowerW: Math.round(summary.maxPowerW),
        avgHr: Math.round(summary.avgHr),
      });
      navigate(`/activity/${saved.id}`);
    } catch (err) {
      setSaveError((err as Error).message || 'Could not save activity');
      setSaving(false);
    }
  }, [summary, user, navigate]);

  const speed = hud?.speedKmh ?? 0;
  const power = hud?.powerW ?? 0;
  const hr = hud?.heartRate ?? 88;
  const ftp = 220;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 select-none">
      {/* 3D canvas host */}
      <div ref={hostRef} className="absolute inset-0" />

      {/* vignette for readability */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 180px rgba(2,6,23,0.55)' }} />

      {/* ============================ HUD ============================ */}
      {started && !summary && (
        <>
          {/* top-left: world + minimap + zone */}
          <div className="absolute top-4 left-4 rounded-xl border border-white/10 bg-zinc-950/60 backdrop-blur-md px-4 py-3 pointer-events-none">
            <div className="text-[11px] tracking-widest text-zinc-400">{(hud?.worldName || '').toUpperCase()}</div>
            {hud && <Minimap hud={hud} points={minimapPoints.current} />}
            <div className="text-center text-sm font-medium mt-1">{hud?.zone || '—'}</div>
          </div>

          {/* top-right: clock, weather, perf, quality */}
          <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
            <div className="rounded-xl border border-white/10 bg-zinc-950/60 backdrop-blur-md px-4 py-3 text-right pointer-events-none">
              <div className="text-xl font-semibold tabular-nums">{hud?.clock || '--:--'}</div>
              <div className="text-xs text-zinc-400 flex items-center gap-1 justify-end">
                <Cloud size={12} /> {hud?.weather || '—'}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-zinc-950/60 backdrop-blur-md px-3 py-1.5 flex items-center gap-2 text-xs">
              <Gauge size={13} />
              <span className={hud && hud.fps >= 55 ? 'text-emerald-400' : hud && hud.fps >= 30 ? 'text-amber-400' : 'text-red-400'}>
                {hud?.fps ?? 0} fps
              </span>
              <span className="text-zinc-500">·</span>
              <span className="text-zinc-300 uppercase">{hud?.quality || ''}</span>
              {hud?.autoQuality && <span className="text-brand-400">auto</span>}
            </div>
            <div className="flex gap-1">
              {(['auto', ...QUALITY_ORDER] as QualityChoice[]).map((q) => {
                const active = q === 'auto' ? qualityChoice === 'auto' : qualityChoice === q;
                const engineActive = hud?.quality === q;
                return (
                  <button
                    key={q}
                    onClick={() => pickQuality(q)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wide border transition ${
                      active || (qualityChoice === 'auto' && engineActive)
                        ? 'bg-brand-500/80 border-brand-400/50 text-white'
                        : 'bg-zinc-950/60 border-white/10 text-zinc-300 hover:bg-white/10'
                    }`}
                    title={q === 'auto' ? 'Auto-detect — steps down if FPS drops' : QUALITY[q].description}
                  >
                    {q === 'medium' ? 'med' : q}
                  </button>
                );
              })}
            </div>
          </div>

          {/* top-center: notifications */}
          {notice && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 rounded-xl border border-white/10 bg-zinc-950/70 backdrop-blur-md px-5 py-2.5 text-center pointer-events-none">
              <div className="text-sm font-semibold" style={{ color: notice.color }}>{notice.title}</div>
              {notice.sub && <div className="text-xs text-zinc-400 mt-0.5">{notice.sub}</div>}
            </div>
          )}

          {/* bottom-center: hero speed + stat bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl border border-white/10 bg-zinc-950/60 backdrop-blur-md px-6 py-3 pointer-events-none">
            <div className="flex items-end gap-6">
              <div className="text-center">
                <div className="text-5xl font-semibold tabular-nums leading-none" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
                  {speed.toFixed(1)}
                </div>
                <div className="text-[10px] tracking-widest text-zinc-400 mt-1">KM/H</div>
              </div>
              <Stat label="POWER" value={`${Math.round(power)}`} color={powerColor(power, ftp)} />
              <Stat label="HEART RATE" value={`${hr}`} color={hrColor(hr)} />
              <Stat label="CADENCE" value={`${hud?.cadence ?? 0}`} />
              <Stat label="DISTANCE" value={`${(hud?.distanceKm ?? 0).toFixed(2)} km`} />
              <Stat label="TIME" value={fmtTime(hud?.timeS ?? 0)} />
              <Stat label="GRADIENT" value={`${((hud?.gradient ?? 0) * 100).toFixed(1)}%`} color={gradientColor(hud?.gradient ?? 0)} />
              <Stat label="GEAR" value={`${hud?.gearFront ?? 1}x${hud?.gearRear ?? 5}`} />
            </div>
          </div>

          {/* bottom-right: live segment progress */}
          {hud?.segment && (
            <div className="absolute bottom-4 right-4 w-64 rounded-xl border border-white/10 bg-zinc-950/60 backdrop-blur-md px-4 py-3 pointer-events-none">
              <div className="flex items-center gap-2 text-sm font-medium text-brand-400">
                <Flag size={14} /> {hud.segment.name}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-brand-500" style={{ width: `${Math.round(hud.segment.progress * 100)}%` }} />
              </div>
              <div className="text-[10px] text-zinc-400 mt-1 text-right">{Math.round(hud.segment.progress * 100)}%</div>
            </div>
          )}

          {/* bottom-left: pause hint + camera */}
          <div className="absolute bottom-4 left-4 flex gap-2">
            <button onClick={() => { setPaused(true); engineRef.current?.pause(); }} className="rounded-lg border border-white/10 bg-zinc-950/60 backdrop-blur-md px-3 py-2 text-sm text-zinc-300 hover:bg-white/10 flex items-center gap-2">
              <Pause size={14} /> Esc
            </button>
            <button onClick={() => engineRef.current?.cycleCamera()} className="rounded-lg border border-white/10 bg-zinc-950/60 backdrop-blur-md px-3 py-2 text-sm text-zinc-300 hover:bg-white/10 flex items-center gap-2">
              <Camera size={14} /> V
            </button>
          </div>
        </>
      )}

      {/* ========================= START SCREEN ========================= */}
      {!started && !summary && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/55 backdrop-blur-[2px]">
          <div className="w-[760px] max-w-[94vw] rounded-2xl border border-white/10 bg-zinc-950/85 backdrop-blur-2xl p-8 shadow-glow">
            <div className="text-center">
              <div className="text-2xl font-semibold tracking-tight">Velodroma</div>
              <div className="text-sm text-zinc-400 mt-1">Ride. Race. Rise. — playable right in your browser</div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
              {WORLD_LIST.map((w: WorldDef) => (
                <button
                  key={w.id}
                  onClick={() => { setWorldId(w.id); if (w.id !== engineWorld) setEngineWorld(w.id); }}
                  className={`rounded-xl border p-4 text-left transition-colors ${worldId === w.id ? 'border-brand-500/60 bg-brand-500/[0.08]' : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'}`}
                >
                  <div className="font-medium text-sm">{w.name}</div>
                  <div className="text-xs text-zinc-400 mt-1 min-h-[32px] leading-snug">{w.description}</div>
                  <div className="text-[10px] text-zinc-500 mt-2">{w.zones.length} zones · {w.segments.length} segments</div>
                </button>
              ))}
            </div>

            <div className="mt-6">
              <div className="text-[11px] tracking-widest text-zinc-400 mb-2">GRAPHICS QUALITY</div>
              <div className="grid grid-cols-5 gap-2">
                {(['auto', ...QUALITY_ORDER] as QualityChoice[]).map((q) => {
                  const active = qualityChoice === q;
                  const label = q === 'auto' ? 'Auto' : QUALITY[q].label;
                  const desc = q === 'auto' ? 'Detect & self-tune' : q === 'low' ? 'Integrated GPUs / older PCs' : q === 'ultra' ? 'High-end PCs — everything on' : QUALITY[q].description;
                  return (
                    <button
                      key={q}
                      onClick={() => pickQuality(q)}
                      className={`rounded-lg border px-3 py-2.5 text-center transition-colors ${active ? 'border-brand-500/60 bg-brand-500/[0.12]' : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'}`}
                    >
                      <div className={`text-sm font-medium ${active ? 'text-brand-400' : ''}`}>{label}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5 leading-tight">{desc}</div>
                    </button>
                  );
                })}
              </div>
              {qualityChoice === 'auto' && (
                <div className="text-[11px] text-zinc-500 mt-2">
                  Auto picks the best preset for your GPU and steps down automatically if FPS drops.
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button onClick={startRide} className="btn-primary !px-9 !py-2.5 text-base flex items-center gap-2">
                <Play size={18} /> Start Ride
              </button>
              <Link to="/" className="btn-secondary !px-6 !py-2.5">Back to feed</Link>
            </div>

            <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px] text-zinc-500">
              <span><b className="text-zinc-300">W / ↑</b> pedal</span>
              <span><b className="text-zinc-300">S / ↓ / Space</b> brake</span>
              <span><b className="text-zinc-300">Shift</b> sprint</span>
              <span><b className="text-zinc-300">Q / E</b> gears</span>
              <span><b className="text-zinc-300">A / D</b> steer</span>
              <span><b className="text-zinc-300">V</b> camera</span>
              <span><b className="text-zinc-300">Esc</b> pause</span>
            </div>
          </div>
        </div>
      )}

      {/* ============================ PAUSED ============================ */}
      {paused && !summary && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
          <div className="w-[380px] rounded-2xl border border-white/10 bg-zinc-950/90 backdrop-blur-2xl p-7">
            <div className="text-xl font-semibold text-center">Paused</div>
            <div className="mt-5 space-y-2">
              <button onClick={() => { setPaused(false); engineRef.current?.resume(); }} className="btn-primary w-full !py-2.5 flex items-center justify-center gap-2">
                <Play size={17} /> Resume
              </button>
              <button onClick={() => engineRef.current?.cycleCamera()} className="btn-secondary w-full !py-2.5 flex items-center justify-center gap-2">
                <Camera size={17} /> Cycle camera
              </button>
              <button onClick={finishRide} className="btn-secondary w-full !py-2.5 flex items-center justify-center gap-2 text-brand-400">
                <Square size={15} /> Finish ride
              </button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-zinc-400">
              <div><div className="font-semibold text-zinc-200">{(hud?.distanceKm ?? 0).toFixed(1)} km</div>distance</div>
              <div><div className="font-semibold text-zinc-200">{fmtTime(hud?.timeS ?? 0)}</div>time</div>
              <div><div className="font-semibold text-zinc-200">{Math.round(hud?.calories ?? 0)}</div>kcal</div>
            </div>
          </div>
        </div>
      )}

      {/* ============================ SUMMARY ============================ */}
      {summary && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
          <div className="w-[460px] rounded-2xl border border-white/10 bg-zinc-950/90 backdrop-blur-2xl p-8">
            <div className="text-2xl font-semibold text-center">Ride Complete</div>
            <div className="text-sm text-zinc-400 text-center mt-1">{summary.name} · {summary.worldName}</div>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <SummaryRow icon={<Wind size={15} />} label="Distance" value={`${summary.distanceKm.toFixed(2)} km`} />
              <SummaryRow icon={<Timer size={15} />} label="Time" value={fmtTime(summary.timeS)} />
              <SummaryRow icon={<Mountain size={15} />} label="Elevation" value={`${Math.round(summary.elevationM)} m`} />
              <SummaryRow icon={<Gauge size={15} />} label="Avg power" value={`${Math.round(summary.avgPowerW)} W`} />
              <SummaryRow icon={<HeartPulse size={15} />} label="Avg heart rate" value={`${Math.round(summary.avgHr)} bpm`} />
              <SummaryRow icon={<Gauge size={15} />} label="Avg / max speed" value={`${summary.avgSpeedKmh.toFixed(1)} / ${summary.maxSpeedKmh.toFixed(1)} km/h`} />
            </div>
            {saveError && <div className="mt-4 text-sm text-red-400 text-center">{saveError}</div>}
            <div className="mt-6 space-y-2">
              <button onClick={saveActivity} disabled={saving} className="btn-primary w-full !py-2.5 flex items-center justify-center gap-2">
                <Save size={17} /> {saving ? 'Saving...' : user ? 'Save to Velodroma' : 'Sign in to save'}
              </button>
              <button onClick={startRide} className="btn-secondary w-full !py-2.5 flex items-center justify-center gap-2">
                <Play size={17} /> Ride again
              </button>
            </div>
            {!user && <div className="text-[11px] text-zinc-500 text-center mt-3">Rides are saved to your feed so friends can give kudos.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center min-w-[64px]">
      <div className="text-lg font-semibold tabular-nums" style={{ color: color || '#f4f4f5', textShadow: '0 2px 6px rgba(0,0,0,0.6)' }}>{value}</div>
      <div className="text-[9px] tracking-widest text-zinc-400 mt-0.5">{label}</div>
    </div>
  );
}

function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-zinc-400">{icon}{label}</div>
      <div className="font-medium mt-0.5 tabular-nums text-sm">{value}</div>
    </div>
  );
}
