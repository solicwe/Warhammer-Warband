// Home: a battle to continue, the three ways to play (a battle, the campaign, a first battle with tips), and the
// player's armies (open one to edit it, start a new one).
import { useEffect, useState } from 'react';
import { RULES } from '../engine/config';
import { listPoints } from '../engine/army';
import { loadRun } from '../engine/campaign';
import { lastRound } from '../engine/state';
import type { GameState } from '../engine/types';
import { Emblem, titleCase } from './ArmyBuilder';
import { useFactions, type FactionIndex } from './data';
import { Icon } from './Icon';
import { armyColor } from './Sheet';
import type { Army } from './library';

interface Props {
  armies: Army[];
  index: FactionIndex | null;
  saved: GameState | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onBattle: () => void;
  onCampaign: () => void;
  onTutorial: () => void;
  onContinue: () => void;
  onAbandon: () => void;
}

export function Home({ armies, index, saved, onOpen, onNew, onDuplicate, onDelete, onBattle, onCampaign, onTutorial, onContinue, onAbandon }: Props) {
  const run = loadRun();
  const runLayer = run ? Math.max(0, ...run.path.map((id) => (run.map.find((n) => n.id === id)?.layer ?? -1) + 1)) : 0;
  const runLayers = run ? Math.max(...run.map.map((n) => n.layer)) + 1 : 0;
  const [menu, setMenu] = useState<string | null>(null);
  const facs = useFactions(armies.map((a) => a.factionId)); // points with the duplicate tax, as in the army builder
  const [armed, setArmed] = useState<string | null>(null); // a delete that needs a second tap (dialogs are blocked here)
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(null), 3000); return () => window.clearTimeout(t); }, [armed]);
  const factionName = (id: string) => index?.factions.find((f) => f.id === id)?.name ?? id;
  const live = saved && saved.phase !== 'gameover' ? saved : null;
  const score = (g: GameState, p: 0 | 1) => g.players[p].vp + g.players[p].secVp;

  return (
    <div className="app home">
      <header className="appbar">
        <span className="brand">Pocket Warband</span>
        <span className="appbar-note">11th edition</span>
      </header>
      <main className="screen">
        {live && (
          <section className="resume slate" aria-label="Battle in progress">
           <div className="slate-in">
            <div className="resume-head">
              <span className="label">{live.campaign ? 'Campaign battle' : 'Battle in progress'}</span>
              <span className="resume-round">{live.phase === 'deploy' || live.phase === 'scouts' ? 'Deployment' : `Round ${live.round} of ${lastRound(live)}`}</span>
            </div>
            <div className="resume-score">
              <span className="p0">{live.players[0].name}</span>
              <b className="num">{score(live, 0)}<i>:</i>{score(live, 1)}</b>
              <span className="p1">{live.players[1].name}</span>
            </div>
            <div className="resume-acts">
              <button className="btn primary grow" onClick={onContinue}>Continue</button>
              <button className={`btn ${armed === 'game' ? 'danger on-armed' : 'ghost'}`} onClick={() => (armed === 'game' ? (setArmed(null), onAbandon()) : setArmed('game'))}>
                {armed === 'game' ? 'Tap again to abandon' : 'Abandon'}
              </button>
            </div>
           </div>
          </section>
        )}

        <nav className="modes" aria-label="Play">
          <button className="mode slate main" onClick={onBattle}>
            <span className="slate-in">
              <span className="mode-icon"><Icon name="fight" size={26} /></span>
              <span className="mode-text"><b>New battle</b><small>Against the bot, two players on one device, or bot against bot</small></span>
              <Icon name="next" size={20} className="mode-go" />
            </span>
          </button>
          <button className="mode slate" onClick={onCampaign}>
            <span className="slate-in">
              <span className="mode-icon"><Icon name="trophy" size={22} /></span>
              <span className="mode-text"><b>Campaign</b><small>{run && !run.over ? `Stage ${Math.min(runLayer + 1, runLayers)} of ${runLayers} · ${run.fate} Fate` : 'Short battles, relics and a Warlord at the end'}</small></span>
            </span>
          </button>
          <button className="mode slate" onClick={onTutorial}>
            <span className="slate-in">
              <span className="mode-icon"><Icon name="hint" size={22} /></span>
              <span className="mode-text"><b>How to play</b><small>A first battle with tips at every step</small></span>
            </span>
          </button>
        </nav>

        <section className="group" aria-label="Your armies">
          <div className="group-head">
            <h3>Armies</h3>
            <span className="group-count num">{armies.length}</span>
          </div>
          <button className="list-new" onClick={onNew}><Icon name="plus" size={20} />New army</button>
          {armies.map((a) => {
            const size = RULES.battleSizes.find((b) => b.id === a.battleSize) ?? RULES.battleSizes[0];
            const pts = listPoints(a, facs[a.factionId]);
            const over = pts > size.points;
            return (
              <div key={a.id} className={`army ${menu === a.id ? 'open' : ''}`} style={{ ['--accent' as string]: armyColor(a.factionId, a.subfaction), ['--accent-2' as string]: armyColor(a.factionId, a.subfaction) }}>
                <button className="army-main" onClick={() => onOpen(a.id)}>
                  <Emblem factionId={a.factionId} sub={a.subfaction} />
                  <span className="army-text">
                    <span className="army-title">{a.name || 'Untitled army'}</span>
                    <span className="army-meta">{factionName(a.factionId)}{a.subfaction ? ` · ${titleCase(a.subfaction)}` : ''}</span>
                    <span className="army-meta">{a.detachments.join(' + ') || 'No Detachment yet'}</span>
                    <span className={`army-foot ${over ? 'over' : ''}`}>
                      <span className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, (pts / size.points) * 100)}%` }} /></span>
                      <span className="army-pts-val"><b className="num">{pts}</b><span className="num">/{size.points} pts</span></span>
                      <span className="army-units">{a.units.length} {a.units.length === 1 ? 'unit' : 'units'}</span>
                    </span>
                  </span>
                </button>
                <button className="army-more" aria-label={`More for ${a.name || 'this army'}`} aria-expanded={menu === a.id} onClick={() => { setMenu(menu === a.id ? null : a.id); setArmed(null); }}>
                  <Icon name="more" size={20} />
                </button>
                {menu === a.id && (
                  <div className="army-menu">
                    <button onClick={() => { setMenu(null); onDuplicate(a.id); }}><Icon name="duplicate" size={18} />Duplicate</button>
                    <button className={armed === a.id ? 'danger' : ''} onClick={() => {
                      if (armed !== a.id) { setArmed(a.id); return; }
                      setArmed(null); setMenu(null); onDelete(a.id);
                    }}><Icon name="delete" size={18} />{armed === a.id ? 'Tap again to delete' : 'Delete'}</button>
                  </div>
                )}
              </div>
            );
          })}
          {!armies.length && <div className="empty">No armies yet. Tap “New army” to build one.</div>}
        </section>

        <footer className="foot">Datasheets: Wahapedia 11th edition export{index ? ` · updated ${index.lastUpdate.slice(0, 10)}` : ''} · Core Rules June 2026 · Warhammer 40,000 is a trademark of Games Workshop</footer>
      </main>
    </div>
  );
}
