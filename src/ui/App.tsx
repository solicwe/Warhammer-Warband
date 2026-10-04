import { Component, useEffect, useState, type ReactNode } from 'react';
import { dispositionById, dispositionId, LAYOUTS, layoutsFor, MISSIONS, primaryFor, deploymentName, type DispositionId } from '../engine/config';
import { createGame, listDisposition } from '../engine/game';
import { autoAttach, listPoints, syncList, forChapter } from '../engine/army';
import { LayoutPreview } from './LayoutPreview';
import type { ArmyList, FactionData, GameState } from '../engine/types';
import { ArmyBuilder } from './ArmyBuilder';
import { loadFaction, loadIndex, type FactionIndex } from './data';
import { GameScreen } from './GameScreen';
import { PRESETS } from './presets';
import { clearSaved, loadSaved } from './store';
import { TokenSprites } from './Tokens';
import { titleCase } from './ArmyBuilder';

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
  // '' = random official layout for the matchup, 'any' = random from every layout, else a layout id
  const [layoutPick, setLayoutPick] = useState<string>('');
  const [allMaps, setAllMaps] = useState(false);
  const [mapDeploy, setMapDeploy] = useState('');
  const [secMode, setSecMode] = useState<'none' | 'tactical' | 'fixed'>('tactical');
  const [mode, setMode] = useState<'hotseat' | 'bot' | 'botbot'>('hotseat');
  const vsBot = mode !== 'hotseat';
  const [facs, setFacs] = useState<[FactionData | null, FactionData | null]>([null, null]);
  const [dispPick, setDispPick] = useState<[DispositionId | null, DispositionId | null]>([null, null]);
  const [index, setIndex] = useState<FactionIndex | null>(null);
  const [saved, setSaved] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { loadIndex().then(setIndex).catch(() => setErr('โหลดรายชื่อ faction ไม่ได้ ลองรีเฟรชหน้า')); setSaved(loadSaved()); }, []);
  useEffect(() => { try { localStorage.setItem(LISTS_KEY, JSON.stringify(lists)); } catch { /* ignore */ } }, [lists]);
  useEffect(() => {
    let live = true;
    Promise.all([loadFaction(lists[0].factionId), loadFaction(lists[1].factionId)]).then((f) => {
      if (!live) return;
      setFacs([f[0], f[1]]);
      // wargear points (e.g. default thunder hammers) for lists saved before wargear existed
      const synced: [ArmyList, ArmyList] = [syncList(lists[0], f[0]), syncList(lists[1], f[1])];
      if (synced[0] !== lists[0] || synced[1] !== lists[1]) setLists(synced);
    }).catch(() => {});
    return () => { live = false; };
  }, [lists]);
  /** Dispositions a list can choose from: one per detachment it brings. */
  const dispOptions = (i: 0 | 1): DispositionId[] => {
    const f = facs[i];
    if (!f) return [];
    const ids = lists[i].detachments.map((n) => dispositionId(f.detachments.find((d) => d.name === n)?.forceDisposition)).filter((x): x is DispositionId => !!x);
    return ids.length ? [...new Set(ids)] : ['take-and-hold'];
  };
  const dispOf = (i: 0 | 1): DispositionId | null => {
    const opts = dispOptions(i);
    const pick = dispPick[i];
    if (pick && opts.includes(pick)) return pick;
    return facs[i] ? listDisposition(lists[i], facs[i]!) : null;
  };
  const d0 = dispOf(0), d1 = dispOf(1);
  const layouts = d0 && d1 ? layoutsFor(d0, d1) : [];

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const factions = await Promise.all([loadFaction(lists[0].factionId), loadFaction(lists[1].factionId)]);
      const botSide = (i: number) => mode === 'botbot' || (mode === 'bot' && i === 1);
      // the bot attaches its loose characters to squads, as a player would at Declare Battle Formations
      const ready = (i: 0 | 1) => { const f = forChapter(factions[i], lists[i].subfaction); const l = syncList(lists[i], f); return botSide(i) ? autoAttach(l, f) : l; };
      const lists2: [ArmyList, ArmyList] = [ready(0), ready(1)];
      const gone = lists.flatMap((l, i) => l.units.filter((u) => !factions[i].datasheets.some((d) => d.name === u.datasheet)).map((u) => `${names[i]}: ${u.datasheet}`));
      if (gone.length) { setErr(`มีหน่วยที่ไม่อยู่ใน 11th edition แล้ว (Legends) — เข้า "จัดทัพ" แล้วลบออกก่อน: ${gone.join(', ')}`); return; }
      const dz: [DispositionId, DispositionId] = [dispOf(0) ?? listDisposition(lists[0], factions[0]), dispOf(1) ?? listDisposition(lists[1], factions[1])];
      const layout = LAYOUTS.find((l) => l.id === layoutPick) ?? LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)];
      const s = createGame({
        lists: lists2, factions: factions as [typeof factions[0], typeof factions[1]],
        names: mode === 'botbot' ? ['บอท 1', 'บอท 2'] : vsBot ? [names[0], 'บอท'] : names,
        deploymentId: layout?.id, dispositions: dz, secondaryMode: secMode,
      });
      s.botPlayer = mode === 'bot' ? 1 : null;
      s.bots = mode === 'botbot' ? [0, 1] : mode === 'bot' ? [1] : [];
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
  const pts = listPoints;
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
            <button className={mode === 'hotseat' ? 'on' : ''} onClick={() => setMode('hotseat')}>2 คน</button>
            <button className={mode === 'bot' ? 'on' : ''} onClick={() => setMode('bot')}>เล่นกับบอท</button>
            <button className={mode === 'botbot' ? 'on' : ''} onClick={() => setMode('botbot')}>บอท vs บอท</button>
          </div>
          {[0, 1].map((i) => (
            <div key={i} className={`army-row side ${i ? 's1' : ''}`}>
              <div className="grow">
                {(i === 1 && vsBot) || mode === 'botbot'
                  ? <div className="army-name">{mode === 'botbot' ? `บอท ${i + 1}` : 'บอท'}</div>
                  : <input aria-label={`ชื่อผู้เล่น ${i + 1}`} value={names[i]} onChange={(e) => setNames((n) => (i === 0 ? [e.target.value, n[1]] : [n[0], e.target.value]))} />}
                <div className="small" style={{ marginTop: 4 }}>
                  <b>{factionName(lists[i].factionId)}{lists[i].subfaction ? ` · ${titleCase(lists[i].subfaction!)}` : ''}</b> <span className="muted">· {pts(lists[i])} pts · {lists[i].units.length} หน่วย · {lists[i].detachments.join(', ') || 'ยังไม่เลือก detachment'}</span>
                </div>
                {(() => {
                  const ii = i as 0 | 1;
                  const opts = dispOptions(ii);
                  const cur = dispOf(ii);
                  if (!cur) return null;
                  return (
                    <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
                      <span className="tiny muted">Force Disposition</span>
                      {opts.map((d) => (
                        <button key={d} type="button" className={`disp-chip ${cur === d ? '' : 'off'}`} style={{ background: dispositionById(d).color }} onClick={() => setDispPick((x) => (ii === 0 ? [d, x[1]] : [x[0], d]))}>{dispositionById(d).name}</button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <button className="btn small" onClick={() => setScreen({ kind: 'build', player: i as 0 | 1 })}>จัดทัพ</button>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="card-title">Mission · Chapter Approved 2026-27</div>
          {d0 && d1 ? (
            <>
              <div className="small">
                <div><b>{dispositionById(d0).name}</b> vs <b>{dispositionById(d1).name}</b></div>
                <div className="muted">Primary ของ {mode === 'botbot' ? 'บอท 1' : names[0]}: <b>{primaryFor(d0, d1).name}</b> · ของ {mode === 'botbot' ? 'บอท 2' : vsBot ? 'บอท' : names[1]}: <b>{primaryFor(d1, d0).name}</b></div>
              </div>
              <div className="field">
                <div className="map-head">
                  <span>{allMaps ? `แผนที่ทั้งหมด (${LAYOUTS.length} layout ทางการ)` : 'Layout ทางการ (Battlemaster) สำหรับคู่นี้'}</span>
                  <button type="button" className="btn small" onClick={() => { setAllMaps((v) => !v); setMapDeploy(''); }}>{allMaps ? 'เฉพาะคู่นี้' : `ดูทุกแมพ (${LAYOUTS.length})`}</button>
                </div>
                {allMaps && (
                  <div className="map-filter">
                    {['', ...new Set(LAYOUTS.map((l) => l.deployment))].map((d) => (
                      <button key={d || 'all'} type="button" className={`chip ${mapDeploy === d ? 'on' : ''}`} onClick={() => setMapDeploy(d)}>{d ? deploymentName(d) : 'ทั้งหมด'}</button>
                    ))}
                  </div>
                )}
                <div className={`layout-pick ${allMaps ? 'wrap' : ''}`}>
                  <button type="button" className={`layout-opt ${layoutPick === '' ? 'on' : ''}`} onClick={() => setLayoutPick('')}>
                    <div className="layout-random">?</div><span>สุ่มจากทุกแมพ</span>
                  </button>
                  {(allMaps ? LAYOUTS.filter((l) => !mapDeploy || l.deployment === mapDeploy) : layouts).map((l) => (
                    <button key={l.id} type="button" className={`layout-opt ${layoutPick === l.id ? 'on' : ''}`} onClick={() => setLayoutPick(l.id)}>
                      <LayoutPreview layout={l} width={64} />
                      <span>{allMaps ? `${deploymentName(l.deployment)} · ${l.matchup.map((m) => dispositionById(m).name).join(' / ')} #${l.number}` : `#${l.number} ${deploymentName(l.deployment)}`}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : <div className="small muted">กำลังโหลดกองทัพ…</div>}
          <label className="field">Secondary
            <select value={secMode} onChange={(e) => setSecMode(e.target.value as typeof secMode)}>
              <option value="tactical">Tactical (จั่วให้ครบ 2 ใบทุก Command phase)</option>
              <option value="fixed">Fixed (เลือก 2 ใบใช้ทั้งเกม)</option>
              <option value="none">ไม่ใช้ (เหมาะกับมือใหม่)</option>
            </select>
          </label>
          <div className="tiny muted">Force Disposition มาจาก detachment ในรายชื่อกองทัพ · คู่ disposition กำหนด Primary ของแต่ละฝ่ายและแผนที่ (3 layout ทางการต่อคู่)</div>
        </section>

        {err && <div className="err">{err}</div>}
        <button className="btn primary big" disabled={busy || !index} onClick={start}>{busy ? 'กำลังโหลด…' : 'เริ่มเกม'}</button>
        <div className="tiny muted">ข้อมูล datasheet: Wahapedia 11th edition export{index ? ` · อัปเดต ${index.lastUpdate.slice(0, 10)}` : ''} · Core Rules มิ.ย. 2026 · Warhammer 40,000 เป็นเครื่องหมายการค้าของ Games Workshop</div>
      </div>
    </div>
  );
}
