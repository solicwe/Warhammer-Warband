import { Component, useEffect, useState, type ReactNode } from 'react';
import { MISSIONS } from '../engine/config';
import { createGame } from '../engine/game';
import type { ArmyList, GameState } from '../engine/types';
import { ArmyBuilder } from './ArmyBuilder';
import { loadFaction, loadIndex, type FactionIndex } from './data';
import { GameScreen } from './GameScreen';
import { PRESETS } from './presets';
import { clearSaved, loadSaved } from './store';
import { TokenSprites } from './Tokens';

type Screen = { kind: 'home' } | { kind: 'build'; player: 0 | 1 } | { kind: 'game'; state: GameState };

const LISTS_KEY = 'w40k11-lists';
function loadLists(): [ArmyList, ArmyList] {
  try {
    const v = JSON.parse(localStorage.getItem(LISTS_KEY) ?? 'null');
    if (Array.isArray(v) && v.length === 2 && v.every((l) => l && Array.isArray(l.units))) return v as [ArmyList, ArmyList];
  } catch { /* ignore */ }
  return [PRESETS.SM, PRESETS.ORK];
}

/** Keeps a rendering bug from taking the whole app down; the game itself is already saved. */
class Guard extends Component<{ children: ReactNode; onReset: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen">
        <div className="sheet-title">เกิดข้อผิดพลาด</div>
        <div className="card">
          <div className="small">หน้าจอนี้แสดงผลไม่ได้ แต่เกมถูกเซฟไว้แล้ว กลับหน้าแรกแล้วกด "เล่นต่อ" ได้เลย</div>
          <div className="tiny muted" style={{ marginTop: 6 }}>{this.state.error}</div>
        </div>
        <button className="btn primary" onClick={() => { this.setState({ error: null }); this.props.onReset(); }}>กลับหน้าแรก</button>
      </div>
    );
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [lists, setLists] = useState<[ArmyList, ArmyList]>(loadLists);
  const [names, setNames] = useState<[string, string]>(['ผู้เล่น 1', 'ผู้เล่น 2']);
  const [deployment, setDeployment] = useState('random');
  const [primary, setPrimary] = useState('battlefield-dominance');
  const [secMode, setSecMode] = useState<'none' | 'tactical' | 'fixed'>('tactical');
  const [vsBot, setVsBot] = useState(false);
  const [index, setIndex] = useState<FactionIndex | null>(null);
  const [saved, setSaved] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { loadIndex().then(setIndex).catch(() => setErr('โหลดรายชื่อ faction ไม่ได้ ลองรีเฟรชหน้า')); setSaved(loadSaved()); }, []);
  useEffect(() => { try { localStorage.setItem(LISTS_KEY, JSON.stringify(lists)); } catch { /* ignore */ } }, [lists]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const factions = await Promise.all([loadFaction(lists[0].factionId), loadFaction(lists[1].factionId)]);
      const deps = MISSIONS.deployments;
      const depId = deployment === 'random' ? deps[Math.floor(Math.random() * deps.length)].id : deployment;
      const s = createGame({
        lists, factions: factions as [typeof factions[0], typeof factions[1]],
        names: vsBot ? [names[0], 'บอท'] : names, deploymentId: depId, primaryId: primary, secondaryMode: secMode,
      });
      s.botPlayer = vsBot ? 1 : null;
      setScreen({ kind: 'game', state: s });
    } catch (e) {
      setErr(`เริ่มเกมไม่ได้: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const goHome = () => { setSaved(loadSaved()); setScreen({ kind: 'home' }); };

  if (screen.kind === 'game') {
    return <div className="app"><TokenSprites /><Guard onReset={goHome}><GameScreen initial={screen.state} onExit={goHome} /></Guard></div>;
  }
  if (screen.kind === 'build') {
    const p = screen.player;
    return (
      <div className="app">
        <TokenSprites />
        <Guard onReset={goHome}>
          <ArmyBuilder list={lists[p]} onChange={(l) => setLists((ls) => (p === 0 ? [l, ls[1]] : [ls[0], l]))} onDone={() => setScreen({ kind: 'home' })} />
        </Guard>
      </div>
    );
  }
  const factionName = (id: string) => index?.factions.find((f) => f.id === id)?.name ?? id;
  const pts = (l: ArmyList) => l.units.reduce((a, u) => a + u.pts + (u.enhancementPts ?? 0), 0);
  return (
    <div className="app">
      <TokenSprites />
      <header className="appbar"><span className="brand">40K Tabletop</span><span className="muted small">11th edition</span></header>
      <div className="screen">
        {saved && saved.phase !== 'gameover' && (
          <section className="card">
            <div className="row">
              <div className="grow">
                <div className="card-title">เกมที่ค้างไว้</div>
                <div className="small muted">Battle Round {saved.round || '–'} · {saved.players[0].name} {saved.players[0].vp + saved.players[0].secVp} : {saved.players[1].vp + saved.players[1].secVp} {saved.players[1].name}</div>
              </div>
              <button className="btn primary" onClick={() => setScreen({ kind: 'game', state: saved })}>เล่นต่อ</button>
            </div>
            <button className="btn small ghost" onClick={() => { clearSaved(); setSaved(null); }}>ลบเกมนี้</button>
          </section>
        )}

        <section className="card">
          <div className="card-title">ผู้เล่น</div>
          <div className="seg">
            <button className={!vsBot ? 'on' : ''} onClick={() => setVsBot(false)}>2 คน (ส่งเครื่องกัน)</button>
            <button className={vsBot ? 'on' : ''} onClick={() => setVsBot(true)}>เล่นกับบอท</button>
          </div>
          {[0, 1].map((i) => (
            <div key={i} className={`army-row side ${i ? 's1' : ''}`}>
              <div className="grow">
                {i === 1 && vsBot
                  ? <div className="army-name">บอท</div>
                  : <input aria-label={`ชื่อผู้เล่น ${i + 1}`} value={names[i]} onChange={(e) => setNames((n) => (i === 0 ? [e.target.value, n[1]] : [n[0], e.target.value]))} />}
                <div className="small" style={{ marginTop: 4 }}>
                  <b>{factionName(lists[i].factionId)}</b> <span className="muted">· {pts(lists[i])} pts · {lists[i].units.length} หน่วย · {lists[i].detachments.join(', ') || 'ยังไม่เลือก detachment'}</span>
                </div>
              </div>
              <button className="btn small" onClick={() => setScreen({ kind: 'build', player: i as 0 | 1 })}>จัดทัพ</button>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="card-title">Mission · Chapter Approved 2026-27</div>
          <label className="field">Deployment
            <select value={deployment} onChange={(e) => setDeployment(e.target.value)}>
              <option value="random">สุ่ม</option>
              {MISSIONS.deployments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="field">Primary (Mirrored World)
            <select value={primary} onChange={(e) => setPrimary(e.target.value)}>
              {MISSIONS.primaries.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">Secondary
            <select value={secMode} onChange={(e) => setSecMode(e.target.value as typeof secMode)}>
              <option value="tactical">Tactical (จั่ว 2 ใบทุก Command phase)</option>
              <option value="fixed">Fixed (เลือก 2 ใบใช้ทั้งเกม)</option>
              <option value="none">ไม่ใช้ (เหมาะกับมือใหม่)</option>
            </select>
          </label>
        </section>

        {err && <div className="err">{err}</div>}
        <button className="btn primary big" disabled={busy || !index} onClick={start}>{busy ? 'กำลังโหลด…' : 'เริ่มเกม'}</button>
        <div className="tiny muted">ข้อมูล datasheet: Wahapedia 11th edition export{index ? ` · อัปเดต ${index.lastUpdate.slice(0, 10)}` : ''} · Core Rules มิ.ย. 2026 · Warhammer 40,000 เป็นเครื่องหมายการค้าของ Games Workshop</div>
      </div>
    </div>
  );
}
