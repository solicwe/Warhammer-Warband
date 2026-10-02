import { useEffect, useState } from 'react';
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

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [lists, setLists] = useState<[ArmyList, ArmyList]>([PRESETS.SM, PRESETS.ORK]);
  const [names, setNames] = useState<[string, string]>(['ผู้เล่น 1', 'ผู้เล่น 2']);
  const [deployment, setDeployment] = useState('random');
  const [primary, setPrimary] = useState('battlefield-dominance');
  const [index, setIndex] = useState<FactionIndex | null>(null);
  const [saved, setSaved] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadIndex().then(setIndex); setSaved(loadSaved()); }, []);

  const start = async () => {
    setBusy(true);
    const factions = await Promise.all([loadFaction(lists[0].factionId), loadFaction(lists[1].factionId)]);
    const deps = MISSIONS.deployments;
    const depId = deployment === 'random' ? deps[Math.floor(Math.random() * deps.length)].id : deployment;
    const s = createGame({ lists, factions: factions as [typeof factions[0], typeof factions[1]], names, deploymentId: depId, primaryId: primary });
    setBusy(false);
    setScreen({ kind: 'game', state: s });
  };

  if (screen.kind === 'game') {
    return <div className="app"><TokenSprites /><GameScreen initial={screen.state} onExit={() => { setSaved(loadSaved()); setScreen({ kind: 'home' }); }} /></div>;
  }
  if (screen.kind === 'build') {
    const p = screen.player;
    return (
      <div className="app">
        <TokenSprites />
        <ArmyBuilder list={lists[p]} onChange={(l) => setLists((ls) => (p === 0 ? [l, ls[1]] : [ls[0], l]))} onDone={() => setScreen({ kind: 'home' })} />
      </div>
    );
  }
  const factionName = (id: string) => index?.factions.find((f) => f.id === id)?.name ?? id;
  return (
    <div className="app">
      <TokenSprites />
      <div className="screen">
        <div className="title">WARHAMMER <span>40K</span> · 11th</div>
        <div className="muted small">จำลองเกมบนโต๊ะแบบ 2D · เดินเอง ระบบทอยเต๋าให้ · Hotseat 2 คน</div>

        {saved && saved.phase !== 'gameover' && (
          <div className="card row">
            <div className="grow">
              <div style={{ fontWeight: 700 }}>เกมที่ค้างไว้</div>
              <div className="small muted">Round {saved.round} · {saved.players[0].name} {saved.players[0].vp} – {saved.players[1].vp} {saved.players[1].name}</div>
            </div>
            <button className="btn primary" onClick={() => setScreen({ kind: 'game', state: saved })}>เล่นต่อ</button>
            <button className="btn small danger" onClick={() => { clearSaved(); setSaved(null); }}>ลบ</button>
          </div>
        )}

        {[0, 1].map((i) => (
          <div key={i} className={`card side ${i ? 's1' : ''}`}>
            <div className="row">
              <input className="grow" value={names[i]} onChange={(e) => setNames((n) => (i === 0 ? [e.target.value, n[1]] : [n[0], e.target.value]))} />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <div className="grow small">
                <b className={i ? 'p1' : 'p0'}>{factionName(lists[i].factionId)}</b>
                <div className="muted tiny">{lists[i].units.length} หน่วย · {lists[i].units.reduce((a, u) => a + u.pts, 0)} pts · {lists[i].detachments.join(', ') || 'ไม่มี detachment'}</div>
              </div>
              <button className="btn small" onClick={() => setScreen({ kind: 'build', player: i as 0 | 1 })}>จัดทัพ</button>
            </div>
          </div>
        ))}

        <div className="card">
          <h3>Mission (Chapter Approved 2026-27)</h3>
          <div className="row">
            <label className="small grow">Deployment
              <select style={{ width: '100%' }} value={deployment} onChange={(e) => setDeployment(e.target.value)}>
                <option value="random">สุ่ม</option>
                {MISSIONS.deployments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="small grow">Primary (Mirrored World)
              <select style={{ width: '100%' }} value={primary} onChange={(e) => setPrimary(e.target.value)}>
                {MISSIONS.primaries.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            {MISSIONS.primaries.find((p) => p.id === primary)?.scoring.map((r) => `R${r.rounds[0]}-${r.rounds[1]}: ${r.text} ${r.vp}VP`).join(' · ')}
          </div>
        </div>

        <button className="btn primary" disabled={busy} onClick={start}>เริ่มเกม</button>
        <div className="tiny muted">
          ข้อมูล datasheet: Wahapedia 11th edition export {index ? `(อัปเดต ${index.lastUpdate})` : ''} · กฎ: Core Rules มิ.ย. 2026
        </div>
      </div>
    </div>
  );
}
