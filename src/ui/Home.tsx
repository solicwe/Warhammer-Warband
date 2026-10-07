// Home: the player's armies (open one to edit it, start a new one), a battle to continue, and the way into a new battle.
import { useEffect, useState } from 'react';
import { RULES } from '../engine/config';
import { listPoints } from '../engine/army';
import type { GameState } from '../engine/types';
import { Emblem, titleCase } from './ArmyBuilder';
import type { FactionIndex } from './data';
import { Icon } from './Icon';
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
  onContinue: () => void;
  onAbandon: () => void;
}

export function Home({ armies, index, saved, onOpen, onNew, onDuplicate, onDelete, onBattle, onContinue, onAbandon }: Props) {
  const [menu, setMenu] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // a delete that needs a second tap (dialogs are blocked here)
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(null), 3000); return () => window.clearTimeout(t); }, [armed]);
  const factionName = (id: string) => index?.factions.find((f) => f.id === id)?.name ?? id;
  const live = saved && saved.phase !== 'gameover' ? saved : null;
  const score = (g: GameState, p: 0 | 1) => g.players[p].vp + g.players[p].secVp;

  return (
    <div className="app home">
      <header className="appbar">
        <span className="brand">40K<span className="brand-sub">Tabletop</span></span>
        <span className="appbar-note">11th edition</span>
      </header>
      <main className="screen">
        {live && (
          <section className="resume" aria-label="Battle in progress">
            <div className="resume-head">
              <span className="label">Battle in progress</span>
              <span className="resume-round">{live.phase === 'deploy' || live.phase === 'scouts' ? 'Deployment' : `Round ${live.round} of 5`}</span>
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
          </section>
        )}

        <button className="btn primary big wide" onClick={onBattle}><Icon name="fight" size={20} />New battle</button>

        <section className="group" aria-label="Your armies">
          <div className="group-head">
            <h3>Armies</h3>
            <span className="group-count num">{armies.length}</span>
          </div>
          <button className="list-new" onClick={onNew}><Icon name="plus" size={20} />New army</button>
          {armies.map((a) => {
            const size = RULES.battleSizes.find((b) => b.id === a.battleSize) ?? RULES.battleSizes[0];
            const pts = listPoints(a);
            const over = pts > size.points;
            return (
              <div key={a.id} className={`army ${menu === a.id ? 'open' : ''}`}>
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
          {!armies.length && <div className="empty">No armies yet. Tap “New army” to build one, or start a battle with a ready-made army.</div>}
        </section>

        <footer className="foot">Datasheets: Wahapedia 11th edition export{index ? ` · updated ${index.lastUpdate.slice(0, 10)}` : ''} · Core Rules June 2026 · Warhammer 40,000 is a trademark of Games Workshop</footer>
      </main>
    </div>
  );
}
