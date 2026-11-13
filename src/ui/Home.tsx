import { useEffect, useState } from 'react';
import { RULES } from '../engine/config';
import { listPoints } from '../engine/army';
import { lastRound } from '../engine/state';
import type { GameState } from '../engine/types';
import { Emblem, titleCase } from './ArmyBuilder';
import { useFactions, type FactionIndex } from './data';
import { Icon, Logo } from './Icon';
import { ThemeToggle } from './ThemeToggle';
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
  onImportArmies?: (armies: Army[]) => void;
  onBattle: () => void;
  onTabletop: () => void;
  onLogs: () => void;
  onContinue: () => void;
  onAbandon: () => void;
}

export function Home({
  armies,
  index,
  saved,
  onOpen,
  onNew,
  onDuplicate,
  onDelete,
  onBattle,
  onTabletop,
  onLogs,
  onContinue,
  onAbandon,
}: Props) {
  const [pop, setPop] = useState<{ id: string; x: number; y: number } | null>(null);
  const facs = useFactions(armies.map((a) => a.factionId)); // points with the duplicate tax, as in the army builder
  const [armed, setArmed] = useState<string | null>(null); // a delete that needs a second tap (dialogs are blocked here)
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(null), 3000); return () => window.clearTimeout(t); }, [armed]);
  const factionName = (id: string) => index?.factions.find((f) => f.id === id)?.name ?? id;
  const live = saved && saved.phase !== 'gameover' ? saved : null;
  const score = (g: GameState, p: 0 | 1) => g.players[p].vp + g.players[p].secVp;

  return (
    <div className="app home">
      <header className="appbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="brand"><Logo size={30} />Warhammer Warband</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeToggle />
          <span className="appbar-note">Tournament Edition</span>
        </div>
      </header>
      <main className="screen">
        {live && (
          <section className="resume slate" aria-label="Battle in progress">
           <div className="slate-in">
            <div className="resume-head">
              <span className="label">Battle in progress</span>
              <span className="resume-round">{live.phase === 'deploy' || live.phase === 'scouts' ? 'Deployment' : `Round ${live.round} of ${Math.max(live.round, lastRound(live))}`}</span>
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

        {/* Play modes: START BATTLE hero button, Tabletop Companion and Match History */}
        <div className="home-modes" aria-label="Play modes">
          <button className="mode-btn-sub mode-btn-hero" onClick={onBattle} title="Play competitive tournament battle against AI or local opponent">
            <Icon name="fight" size={24} />
            <div className="mode-sub-info">
              <span className="mode-sub-label">START BATTLE</span>
              <small className="mode-sub-badge" style={{ opacity: 0.85, marginTop: 2 }}>Incursion (1,000 pts) · Strike Force (2,000 pts)</small>
            </div>
          </button>

          <nav className="modes-sub-grid" aria-label="Secondary play modes">
            <button className="mode-btn-sub" onClick={onTabletop} title="Physical 40k match scorekeeper, tactical deck, and 45 terrain maps">
              <Icon name="tabletop" size={18} />
              <div className="mode-sub-info">
                <span className="mode-sub-label">TABLETOP</span>
              </div>
            </button>
            <button className="mode-btn-sub" onClick={onLogs} title="Past battle history and replays">
              <Icon name="history" size={18} />
              <div className="mode-sub-info">
                <span className="mode-sub-label">HISTORY</span>
              </div>
            </button>
          </nav>
        </div>

        <section className="group" aria-label="Your armies">
          <div className="group-head">
            <h3>Armies</h3>
            <span className="group-count num">{armies.length}</span>
          </div>
          <button className="list-new" onClick={onNew}><Icon name="plus" size={20} />Create New Roster</button>
          {armies.map((a) => {
            const size = RULES.battleSizes.find((b) => b.id === a.battleSize) ?? RULES.battleSizes[0];
            const pts = listPoints(a, facs[a.factionId]);
            const over = pts > size.points;
            const rawName = a.name?.trim();
            const isGenericName = !rawName || rawName.toLowerCase() === 'new army' || rawName.toLowerCase() === 'untitled army';
            const armyTitle = isGenericName
              ? (a.subfaction ? `${titleCase(a.subfaction)} Force` : `${factionName(a.factionId)} Army`)
              : a.name;
            return (
              <div key={a.id} className="army" style={{ ['--accent' as string]: armyColor(a.factionId, a.subfaction), ['--accent-2' as string]: armyColor(a.factionId, a.subfaction) }}>
                <button className="army-main" onClick={() => onOpen(a.id)}>
                  <Emblem factionId={a.factionId} sub={a.subfaction} />
                  <span className="army-text">
                    <span className="army-title">{armyTitle}</span>
                    <span className="army-meta">{factionName(a.factionId)}{a.subfaction ? ` · ${titleCase(a.subfaction)}` : ''}</span>
                    <span className="army-meta">{a.detachments.join(' + ') || 'No Detachment yet'}</span>
                    <span className={`army-foot ${over ? 'over' : ''}`}>
                      <span className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, (pts / size.points) * 100)}%` }} /></span>
                      <span className="army-pts-val"><b className="num">{pts}</b><span className="num">/{size.points} pts</span></span>
                      <span className="army-units">{a.units.length} {a.units.length === 1 ? 'unit' : 'units'}</span>
                    </span>
                  </span>
                </button>
                <button
                  className="army-more"
                  aria-label={`More for ${a.name || 'this army'}`}
                  aria-expanded={pop?.id === a.id}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPop(pop?.id === a.id ? null : { id: a.id, x: r.right, y: r.bottom });
                    setArmed(null);
                  }}
                >
                  <Icon name="more" size={20} />
                </button>
              </div>
            );
          })}
        </section>

        {pop && (() => {
          const a = armies.find((x) => x.id === pop.id);
          if (!a) return null;
          const w = 240;
          const pad = 8;
          const left = Math.max(pad, Math.min(window.innerWidth - w - pad, pop.x - w));
          const top = Math.min(window.innerHeight - 130, Math.max(pad, pop.y + 4));
          return (
            <div className="ab-pop-backdrop" onClick={() => { setPop(null); setArmed(null); }}>
              <div className="ab-pop" style={{ left, top, width: w }} onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => { setPop(null); onDuplicate(a.id); }}>
                  <Icon name="duplicate" size={22} />
                  <span>Duplicate</span>
                </button>
                <button type="button" className={armed === a.id ? 'danger' : ''} onClick={() => {
                  if (armed !== a.id) { setArmed(a.id); return; }
                  setArmed(null); setPop(null); onDelete(a.id);
                }}>
                  <Icon name="delete" size={22} />
                  <span>{armed === a.id ? 'Tap again to delete' : 'Delete'}</span>
                </button>
              </div>
            </div>
          );
        })()}

      </main>
    </div>
  );
}
