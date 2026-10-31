// A new battle: who plays (you against the bot, two players on one phone, or two bots), each side's army, the
// mission and the map. The last choices are remembered.
import { useEffect, useMemo, useState } from 'react';
import { deploymentName, dispositionById, LAYOUTS, MISSIONS, RULES, type DispositionId } from '../engine/config';
import { KILL_VP } from '../engine/attack';
import { autoAttach, forChapter, listPoints, syncList } from '../engine/army';
import { createGame } from '../engine/game';
import type { ArmyList, GameState } from '../engine/types';
import { Emblem, titleCase } from './ArmyBuilder';
import { loadFaction, useFactions, type FactionIndex } from './data';
import { Icon } from './Icon';
import { LayoutPreview } from './LayoutPreview';
import { loadBattlePrefs, saveBattlePrefs, withAutoRules, type Army, type ArmyRef, type BattleMode, type BattlePrefs } from './library';

interface Props {
  armies: Army[];
  index: FactionIndex | null;
  onBack: () => void;
  onStart: (s: GameState) => void;
  onUpdateArmy: (a: Army) => void;
}

const SEC_MODES: { id: BattlePrefs['secMode']; label: string; note: string }[] = [
  { id: 'tactical', label: 'Tactical', note: 'Draw up to 2 cards each Command phase' },
  { id: 'fixed', label: 'Fixed', note: 'Pick 2 cards that last the whole battle' },
  { id: 'none', label: 'None', note: 'Primary Mission only: good for a first game' },
];

const LEVELS: { id: BattlePrefs['level']; label: string; note: string }[] = [
  { id: 'easy', label: 'Easy', note: 'Plays each unit on its own and slips now and then. Good for learning the rules.' },
  { id: 'normal', label: 'Normal', note: 'Tries its turn three ways before playing it, and plans while you play yours.' },
  { id: 'hard', label: 'Hard', note: 'Tries each way on two rolls of the dice. Thinks up to ~20 s, mostly during your turn.' },
  { id: 'expert', label: 'Expert', note: 'Five ways, three rolls each. The strongest, and the longest thinking (up to ~40 s).' },
];

const LENGTHS: { id: BattlePrefs['rounds']; label: string; note: string }[] = [
  { id: 5, label: 'Full · 5 rounds', note: 'The whole battle, as at a tournament.' },
  { id: 3, label: 'Short · 3 rounds', note: 'A quicker battle: three rounds, then the score is final. Good with a small army (Incursion).' },
];

const MODES: { id: BattleMode; label: string }[] = [
  { id: 'bot', label: 'vs Bot' },
  { id: 'hotseat', label: '2 Players' },
  { id: 'botbot', label: 'Bot vs Bot' },
];

export function BattleSetup({ armies, index, onBack, onStart }: Props) {
  const [prefs, setPrefs] = useState<BattlePrefs>(() => loadBattlePrefs(armies));
  useEffect(() => saveBattlePrefs(prefs), [prefs]);
  const set = (patch: Partial<BattlePrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const [choosing, setChoosing] = useState<0 | 1 | null>(null); // the side whose army is being picked
  const [mapDeploy, setMapDeploy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // no army picked yet (none built): an empty stand-in, shown as "Choose an army"
  const missing = (i: 0 | 1) => !armies.some((a) => a.id === prefs.sides[i].id);
  const listOf = (i: 0 | 1): ArmyList => armies.find((a) => a.id === prefs.sides[i].id) ?? { name: '', factionId: 'SM', battleSize: RULES.battleSizes[0].id, detachments: [], units: [] };
  const lists: [ArmyList, ArmyList] = [listOf(0), listOf(1)];
  const ptsFacs = useFactions(armies.map((x) => x.factionId));
  const ptsOf = (l: ArmyList) => listPoints(l, ptsFacs[l.factionId]);

  const bot = (i: 0 | 1) => prefs.mode === 'botbot' || (prefs.mode === 'bot' && i === 1);
  const factionName = (id: string) => index?.factions.find((f) => f.id === id)?.name ?? id;
  const armyNameOf = (i: 0 | 1) => lists[i]?.name?.trim() || factionName(lists[i]?.factionId) || (i ? 'Side 2' : 'Side 1');
  const role = (i: 0 | 1) => armyNameOf(i);
  const playerName = (i: 0 | 1) => {
    const custom = prefs.names[i] && !/^Player [12]$/i.test(prefs.names[i]) ? prefs.names[i] : null;
    const base = custom || armyNameOf(i);
    return bot(i) ? `${base} (Bot)` : base;
  };

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const factions = await Promise.all([loadFaction(lists[0].factionId), loadFaction(lists[1].factionId)]);
      // the bot attaches its loose characters to squads, as a player would at Declare Battle Formations
      const ready = (i: 0 | 1) => { const f = forChapter(factions[i], lists[i].subfaction); const l = syncList(lists[i], f); return bot(i) ? autoAttach(l, f) : l; };
      const gone = lists.flatMap((l, i) => l.units.filter((u) => !factions[i].datasheets.some((d) => d.name === u.datasheet)).map((u) => `${l.name || role(i as 0 | 1)}: ${u.datasheet}`));
      if (gone.length) { setErr(`Some units are not in 11th edition any more (Legends). Remove them from the army first: ${gone.join(', ')}`); return; }
      if (lists.some((l) => !l.units.length)) { setErr('An army has no units yet. Open it from the home screen and add some, or pick another army.'); return; }
      // each side's Force Disposition is rolled every battle (a picked layout keeps its own pairing)
      const picked = LAYOUTS.find((l) => l.id === prefs.layoutPick);
      const roll = () => MISSIONS.forceDispositions[Math.floor(Math.random() * MISSIONS.forceDispositions.length)].id;
      const flip = Math.random() < 0.5;
      const dz: [DispositionId, DispositionId] = picked ? [picked.matchup[flip ? 1 : 0], picked.matchup[flip ? 0 : 1]] : [roll(), roll()];
      const s = createGame({
        lists: [ready(0), ready(1)], factions: [factions[0], factions[1]],
        names: [playerName(0), playerName(1)], deploymentId: picked?.id, dispositions: dz, secondaryMode: prefs.secMode, maxRounds: prefs.rounds,
      });
      s.botPlayer = prefs.mode === 'bot' ? 1 : null;
      s.bots = prefs.mode === 'botbot' ? [0, 1] : prefs.mode === 'bot' ? [1] : [];
      s.botLevel = prefs.level;
      onStart(withAutoRules(s));
    } catch (e) {
      setErr(`Could not start the battle: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const choices = useMemo(() => [
    ...armies.map((a) => ({ ref: { kind: 'list', id: a.id } as ArmyRef, list: a as ArmyList })),
  ], [armies]);

  const side = (i: 0 | 1) => {
    const l = lists[i];
    const size = RULES.battleSizes.find((b) => b.id === l.battleSize) ?? RULES.battleSizes[0];
    return (
      <div className={`side-slot s${i}`}>
        <div className="side-head">
          <span className="side-mark" aria-hidden="true" />
          <span className="label">{role(i)}</span>
          {bot(i) && <span className="side-bot"><Icon name="bot" size={14} /> plays itself</span>}
        </div>
        {!bot(i) && prefs.mode === 'hotseat' && (
          <input id={`player-name-${i}`} aria-label={`${role(i)} name`} value={prefs.names[i]} onChange={(e) => set({ names: (i ? [prefs.names[0], e.target.value] : [e.target.value, prefs.names[1]]) as [string, string] })} />
        )}
        {missing(i) ? (
          <button className="pick-army" onClick={() => setChoosing(i)}>
            <span className="pick-army-text"><span className="pick-army-name">Choose an army</span><span className="pick-army-meta">Build one from the home screen first</span></span>
            <span className="pick-army-change">Pick</span>
          </button>
        ) : (
        <button className="pick-army" onClick={() => setChoosing(i)}>
          <Emblem factionId={l.factionId} sub={l.subfaction} />
          <span className="pick-army-text">
            <span className="pick-army-name">{l.name || 'Untitled army'}</span>
            <span className="pick-army-meta">{factionName(l.factionId)}{l.subfaction ? ` · ${titleCase(l.subfaction)}` : ''} · <span className="num">{ptsOf(l)}/{size.points}</span></span>
          </span>
          <span className="pick-army-change">Change</span>
        </button>
        )}
      </div>
    );
  };

  return (
    <div className="app setup">
      <header className="appbar">
        <button className="appbar-back-btn" aria-label="Back" onClick={onBack}>&lt;</button>
        <span className="appbar-title">New battle</span>
      </header>
      <main className="screen">
        <div className="seg" role="radiogroup" aria-label="Who plays">
          {MODES.map((m) => <button key={m.id} role="radio" aria-checked={prefs.mode === m.id} className={prefs.mode === m.id ? 'on' : ''} onClick={() => set({ mode: m.id })}>{m.label}</button>)}
        </div>

        {prefs.mode !== 'hotseat' && (
          <div className="field">
            <span id="bot-level">Bot level</span>
            <div className="seg" role="radiogroup" aria-labelledby="bot-level">
              {LEVELS.map((l) => <button key={l.id} type="button" role="radio" aria-checked={prefs.level === l.id} className={prefs.level === l.id ? 'on' : ''} onClick={() => set({ level: l.id })}>{l.label}</button>)}
            </div>
            <span className="field-note">{LEVELS.find((l) => l.id === prefs.level)?.note}</span>
          </div>
        )}

        <section className="sides" aria-label="Armies">
          {side(0)}
          <div className="vs" aria-hidden="true"><span>vs</span></div>
          {side(1)}
        </section>

        <section className="group pad" aria-label="Mission">
          <div className="group-head"><h3>Mission</h3><span className="group-note">Chapter Approved 2026–27</span></div>
          <p className="small muted">Each side's Force Disposition, and so its Primary Mission, is rolled when the battle starts. Every mission also gives a little VP for each enemy unit destroyed (2 for a Character, Vehicle or Monster, at most {KILL_VP} a battle).</p>
          <div className="map-head">
            <span className="small">{`All ${LAYOUTS.length} official layouts (a picked map sets the pairing)`}</span>
          </div>
          <div className="map-filter">
            {['', ...new Set(LAYOUTS.map((l) => l.deployment))].map((d) => (
              <button key={d || 'all'} type="button" className={`chip ${mapDeploy === d ? 'on' : ''}`} onClick={() => setMapDeploy(d)}>{d ? deploymentName(d) : 'All'}</button>
            ))}
          </div>
          <div className="layout-pick wrap">
            <button type="button" className={`layout-opt ${prefs.layoutPick === '' ? 'on' : ''}`} onClick={() => set({ layoutPick: '' })}>
              <div className="layout-random">?</div><span>Random</span>
            </button>
            {LAYOUTS.filter((l) => !mapDeploy || l.deployment === mapDeploy).map((l) => (
              <button key={l.id} type="button" className={`layout-opt ${prefs.layoutPick === l.id ? 'on' : ''}`} onClick={() => set({ layoutPick: l.id })}>
                <LayoutPreview layout={l} width={64} />
                <span>{`${deploymentName(l.deployment)} · ${l.matchup.map((m) => dispositionById(m).name).join(' / ')} #${l.number}`}</span>
              </button>
            ))}
          </div>
          <div className="field">
            <span id="length">Battle length</span>
            <div className="seg" role="radiogroup" aria-labelledby="length">
              {LENGTHS.map((m) => <button key={m.id} type="button" role="radio" aria-checked={prefs.rounds === m.id} className={prefs.rounds === m.id ? 'on' : ''} onClick={() => set({ rounds: m.id })}>{m.label}</button>)}
            </div>
            <span className="field-note">{LENGTHS.find((m) => m.id === prefs.rounds)?.note}</span>
          </div>
          <div className="field">
            <span id="sec-mode">Secondary Missions</span>
            <div className="seg" role="radiogroup" aria-labelledby="sec-mode">
              {SEC_MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={prefs.secMode === m.id} className={prefs.secMode === m.id ? 'on' : ''} onClick={() => set({ secMode: m.id })}>{m.label}</button>)}
            </div>
            <span className="field-note">{SEC_MODES.find((m) => m.id === prefs.secMode)?.note}</span>
          </div>
        </section>

        {err && <div className="err" role="alert">{err}</div>}
        <div className="cta-bar">
          <button className="btn primary big wide" disabled={busy || !index || missing(0) || missing(1)} onClick={start}>{busy ? 'Setting up…' : 'Start battle'}</button>
        </div>
      </main>

      {choosing !== null && (
        <div className="tray-backdrop" onClick={() => setChoosing(null)}>
          <div className="tray" role="dialog" aria-label={`Army for ${role(choosing)}`} onClick={(e) => e.stopPropagation()}>
            <div className="tray-head">
              <span className="sheet-title grow">Army for {role(choosing)}</span>
              <button className="btn small ghost" onClick={() => setChoosing(null)}>Close</button>
            </div>
            <div className="group">
              {!choices.length && <div className="empty">No armies yet: build one from the home screen.</div>}
              {choices.map((c) => {
                const size = RULES.battleSizes.find((b) => b.id === c.list.battleSize) ?? RULES.battleSizes[0];
                const on = c.ref.id === prefs.sides[choosing].id;
                return (
                  <button key={c.ref.id} className={`pick-row ${on ? 'on' : ''}`} onClick={() => {
                    set({ sides: (choosing ? [prefs.sides[0], c.ref] : [c.ref, prefs.sides[1]]) as [ArmyRef, ArmyRef] });
                    setChoosing(null);
                  }}>
                    <Emblem factionId={c.list.factionId} sub={c.list.subfaction} />
                    <span className="pick-army-text">
                      <span className="pick-army-name">{c.list.name || 'Untitled army'}</span>
                      <span className="pick-army-meta">{factionName(c.list.factionId)} · {c.list.detachments.join(' + ') || 'No Detachment'} · <span className="num">{ptsOf(c.list)}/{size.points}</span></span>
                    </span>
                    {on && <Icon name="check" size={20} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
