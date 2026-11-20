// Thousand Sons Rituals at the start of the Shooting phase: pick a sorcerer, a Ritual and a target, roll 2D6, then
// Command Re-roll a die and decide to Channel the Warp. The choice (`rit`) lives in GameScreen because a tap on the
// board picks a caster or a target too.
import type { Dispatch, SetStateAction } from 'react';
import { canUseStratagem, unitById } from '../engine/state';
import type { GameState, UnitState } from '../engine/types';
import { beginRitual, endRituals, finishRitual, rerollRitualDie, RITUALS, type Caster, type Ritual } from '../factions/rituals';

export interface RitPick { model?: string; ritual?: string; target?: string }

interface Props {
  s: GameState;
  act: <T>(fn: (g: GameState) => T) => T;
  flash: (text: string) => void;
  setSel: (unitId: string | null) => void;
  rit: RitPick;
  setRit: Dispatch<SetStateAction<RitPick>>;
  casters: Caster[];
  caster: Caster | null;
  left: Ritual[];
  ritual: Ritual | null;
  targets: UnitState[];
  /** the dice are still rolling on the screen: the numbers and what they mean wait until they land */
  rolling: boolean;
}

export function RitualPanel({ s, act, flash, setSel, rit, setRit, casters: cs, caster: c, left, ritual: r, targets, rolling }: Props) {
  const U = (id: string) => unitById(s, id);
  const p = s.active;
  const pending = s.players[p].rituals?.pending;
  if (pending) {
    const ritual = RITUALS.find((x) => x.id === pending.ritualId)!;
    const unit = U(pending.unitId);
    const caster = unit.models.find((m) => m.id === pending.modelId);
    const target = U(pending.targetId);
    const score = pending.dice.reduce((a, b) => a + b, 0) + pending.bonus;
    const rrWhy = canUseStratagem(s, p, 'command-reroll', unit);
    const finish = (channel: boolean) => {
      const res = act((g) => finishRitual(g, p, channel));
      // the outcome is the last card of the roll on the screen, after the dice land: no message ahead of it
      if (res?.error || !res?.out) flash(res?.error ?? 'Could not finish this Psychic test');
    };
    if (rolling) {
      return (
        <div className="rit-result">
          <b>{ritual.name}: Psychic test</b>
          <div className="small muted">Rolling the dice...</div>
        </div>
      );
    }
    return (
      <div className="rit-result">
        <b>{ritual.name}: Psychic test</b>
        <div className="small">{caster?.name ?? unit.name} on {target.name} · +{pending.bonus} = {score} vs WC {ritual.wc}</div>
        <div className="dice">
          {pending.dice.map((v, i) => (
            <button key={i} type="button" className={`die ${pending.rerolled === i ? 'rr' : ''} ${rrWhy === null && pending.rerolled === undefined ? 'pick' : ''}`}
              disabled={rrWhy !== null || pending.rerolled !== undefined}
              title={rrWhy ?? 'Command Re-roll 1CP: re-roll this die'}
              onClick={() => { const e = act((g) => rerollRitualDie(g, p, i)); if (e) flash(e); }}>{v}</button>
          ))}
        </div>
        <div className="small">{score >= ritual.wc ? `Passes WC ${ritual.wc}.` : `Needs ${ritual.wc - score} more for WC ${ritual.wc}.`} {score >= ritual.strong ? `Already at the strongest effect (${ritual.strong}+).` : `Strongest effect at ${ritual.strong}+: needs ${ritual.strong - score} more.`}</div>
        <div className="small muted">{rrWhy === null && pending.rerolled === undefined ? 'Tap a die to Command Re-roll it (1CP).' : pending.rerolled !== undefined ? 'Command Re-roll used.' : `No Command Re-roll: ${rrWhy}`}</div>
        <div className="small">Choose whether to add a Channel die, even if the test already passes.</div>
        <div className="row wrap">
          <button className="btn primary" onClick={() => finish(true)}>Channel the Warp · roll 1D6</button>
          <button className="btn" onClick={() => finish(false)}>Resolve with 2D6</button>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="handoff">Rituals · start of the Shooting phase</div>
      <div className="unit-strip rit-casters">
        {cs.map((x) => (
          <button key={x.model.id} className={`unit-pill ${rit.model === x.model.id ? 'sel' : ''}`} onClick={() => { setRit({ model: x.model.id }); setSel(x.unit.id); }}>
            <span className={`side-dot s${x.unit.owner}`} aria-hidden="true" /> {x.model.name}{x.bonus ? ` +${x.bonus}` : ''}{x.tries > 1 ? ` ×${x.tries}` : ''}
          </button>
        ))}
      </div>
      {c && (
        <div className="rit-list">
          {left.map((x) => (
            <button key={x.id} className={`rit-opt ${rit.ritual === x.id ? 'on' : ''}`} onClick={() => setRit({ ...rit, ritual: x.id, target: undefined })}>
              <span className="rit-opt-head"><b>{x.name}</b><span className="rit-wc">WC {x.wc} · strong {x.strong}+</span></span>
              <small>{x.text}</small>
            </button>
          ))}
        </div>
      )}
      {r && (
        <>
          <div className="label rit-target-head">{r.side === 'enemy' ? 'Enemy target' : 'Friendly unit'} · within {c!.range}"</div>
          {targets.length ? (
            <div className="unit-strip rit-targets">{targets.map((t) => <button key={t.id} className={`unit-pill ${rit.target === t.id ? 'sel' : ''}`} onClick={() => setRit({ ...rit, target: t.id })}>{t.name}</button>)}</div>
          ) : <div className="small muted">No unit in range and in sight (a ruin or wall in between blocks sight; a ruin your unit stands in does not)</div>}
        </>
      )}
      <div className="row">
        <button className="btn" onClick={() => { act((g) => endRituals(g, p)); setRit({}); }}>Done with Rituals</button>
        <button className="btn primary grow" disabled={!c || !r || !rit.target} onClick={() => {
          const res = act((g) => beginRitual(g, p, c!.model.id, r!.id, rit.target));
          if (res?.error) flash(res.error);
          else setRit({});
        }}>Roll 2D6 · {r ? r.name : 'Ritual'}</button>
      </div>
    </>
  );
}
