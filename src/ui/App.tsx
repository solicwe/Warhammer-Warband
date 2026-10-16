import { Component, useEffect, useState, type ReactNode } from 'react';
import { newUid, syncList } from '../engine/army';
import type { GameState } from '../engine/types';
import { ArmyBuilder } from './ArmyBuilder';
import { BattleSetup } from './BattleSetup';
import { CampaignScreen } from './Campaign';
import { resetCoach } from './Coach';
import { loadFaction, loadIndex, type FactionIndex } from './data';
import { GameScreen } from './GameScreen';
import { Home } from './Home';
import { loadArmies, loadBattlePrefs, saveArmies, saveBattlePrefs, withAutoRules, type Army } from './library';
import { clearSaved, loadSaved } from './store';
import { TokenSprites } from './Tokens';

type Screen = { kind: 'home' } | { kind: 'build'; id: string; fresh?: boolean } | { kind: 'battle' } | { kind: 'game'; state: GameState } | { kind: 'campaign' };

/** Keeps a rendering bug from taking the whole app down; the game itself is already saved. */
class Guard extends Component<{ children: ReactNode; onReset: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen">
        <div className="sheet-title">This screen could not be shown</div>
        <div className="small">Your battle and armies are saved. Go back home and tap Continue.</div>
        <div className="tiny muted">{this.state.error}</div>
        <button className="btn primary" onClick={() => { this.setState({ error: null }); this.props.onReset(); }}>Back to home</button>
      </div>
    );
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [armies, setArmies] = useState<Army[]>(loadArmies);
  const [index, setIndex] = useState<FactionIndex | null>(null);
  const [saved, setSaved] = useState<GameState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { loadIndex().then(setIndex).catch(() => setErr('Could not load the faction list. Reload the page to try again.')); setSaved(loadSaved()); }, []);
  useEffect(() => saveArmies(armies), [armies]);
  // a points update (Munitorum Field Manual) reaches the saved armies too: each one is repriced from its faction's data
  useEffect(() => {
    let live = true;
    const ids = [...new Set(armies.map((a) => a.factionId))];
    Promise.all(ids.map((id) => loadFaction(id).then((f) => [id, f] as const).catch(() => null))).then((rows) => {
      if (!live) return;
      const byId = new Map(rows.filter((r): r is NonNullable<typeof r> => !!r));
      setArmies((xs) => {
        let changed = false;
        const next = xs.map((a) => { const f = byId.get(a.factionId); if (!f) return a; const s = syncList(a, f); if (s !== a) changed = true; return s === a ? a : { ...a, ...s }; });
        return changed ? next : xs;
      });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (a: Army) => setArmies((xs) => xs.map((x) => (x.id === a.id ? { ...a, updatedAt: Date.now() } : x)));
  const goHome = () => { setSaved(loadSaved()); setScreen({ kind: 'home' }); };
  const wrap = (node: ReactNode) => <div className="app-frame"><TokenSprites /><Guard onReset={goHome}>{node}</Guard></div>;

  // leaving a campaign battle goes back to the campaign map (its result moves the run on)
  const exitGame = () => { const sv = loadSaved(); setSaved(sv); setScreen(sv?.campaign ? { kind: 'campaign' } : { kind: 'home' }); };
  if (screen.kind === 'game') return wrap(<div className="app game-app"><GameScreen initial={screen.state} onExit={exitGame} /></div>);
  if (screen.kind === 'campaign') {
    return wrap(<CampaignScreen index={index} saved={saved} onBack={goHome} onPlay={(s) => setScreen({ kind: 'game', state: s })} onClearSaved={() => { clearSaved(); setSaved(null); }} />);
  }
  if (screen.kind === 'build') {
    const a = armies.find((x) => x.id === screen.id);
    if (!a) return wrap(<div className="screen"><button className="btn" onClick={goHome}>Back to home</button></div>);
    return wrap(
      <div className="app">
        {/* the list keeps its id whatever the builder does to it (a faction change starts it from a ready-made list) */}
        <ArmyBuilder list={a} startPicker={screen.fresh} onChange={(l) => update({ ...l, id: a.id })} onDone={() => {
          // backing out of "New army" before picking anything leaves no empty army behind
          if (screen.fresh && a.name === 'New army' && !a.units.length && !a.detachments.length) setArmies((xs) => xs.filter((x) => x.id !== a.id));
          goHome();
        }} />
      </div>,
    );
  }
  if (screen.kind === 'battle') {
    return wrap(<BattleSetup armies={armies} index={index} onBack={goHome} onUpdateArmy={update} onStart={(s) => setScreen({ kind: 'game', state: s })} />);
  }
  return wrap(
    <>
      <Home
        armies={[...armies].sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0))}
        index={index}
        saved={saved}
        onOpen={(id) => setScreen({ kind: 'build', id })}
        onNew={() => {
          const id = newUid('a');
          setArmies((xs) => [...xs, { id, name: 'New army', factionId: 'SM', battleSize: 'strike-force', detachments: [], units: [], updatedAt: Date.now() }]);
          setScreen({ kind: 'build', id, fresh: true });
        }}
        onDuplicate={(id) => setArmies((xs) => { const a = xs.find((x) => x.id === id); return a ? [...xs, { ...structuredClone(a), id: newUid('a'), name: `${a.name || 'Army'} (copy)`, updatedAt: Date.now() }] : xs; })}
        onDelete={(id) => setArmies((xs) => xs.filter((x) => x.id !== id))}
        onImportArmies={(newArmies) => {
          setArmies((xs) => {
            const existingIds = new Set(xs.map((x) => x.id));
            const toAdd = newArmies.map((a) => (existingIds.has(a.id) ? { ...a, id: newUid('a') } : a));
            return [...xs, ...toAdd];
          });
        }}
        onBattle={() => setScreen({ kind: 'battle' })}
        onCampaign={() => setScreen({ kind: 'campaign' })}
        onTutorial={() => {
          // a first battle with every tip: against an easy bot, short, Primary Mission only
          resetCoach();
          saveBattlePrefs({ ...loadBattlePrefs(armies), mode: 'bot', level: 'easy', rounds: 3, secMode: 'none' });
          setScreen({ kind: 'battle' });
        }}
        onContinue={() => { if (saved) setScreen({ kind: 'game', state: withAutoRules(saved) }); }}
        onAbandon={() => { clearSaved(); setSaved(null); }}
      />
      {err && <div className="toast" role="alert">{err}</div>}
    </>,
  );
}
