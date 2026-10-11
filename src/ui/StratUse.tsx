// One detachment stratagem, ready to use: pick the unit, the option ("select either …"), the enemy unit, then use it.
// Shared by the Stratagem tray and the prompt the game opens at a stratagem's moment ("just after an enemy unit has shot").
import { useState } from 'react';
import { Em } from './Em';
import { alive, onBoard, stratCost, type ReactCtx } from '../engine/state';
import { EFFECT_LABEL, stratagemBlock, stratChoices, stratEnemies, type StratRule, type StratUse as Use } from '../engine/stratagems';
import type { GameState, PlayerId, StratagemData, UnitState } from '../engine/types';
import { Icon } from './Icon';

const short = (n: string) => (n.length > 22 ? n.slice(0, 21) + '…' : n);

export function StratUseCard({ s, p, st, rule, detachment, units, ctx, react, bot, auto, onAuto, onUse }: {
  s: GameState; p: PlayerId; st: StratagemData; rule: StratRule; detachment: string;
  /** units it can be used on (own units, or units in Reserves / just destroyed) */
  units: UnitState[];
  ctx?: ReactCtx; react?: boolean; bot?: boolean;
  auto?: boolean; onAuto?: () => void;
  onUse: (unitId: string | undefined, use: Use) => void;
}) {
  const [unitId, setUnitId] = useState<string>(units.length === 1 ? units[0].id : '');
  const [choice, setChoice] = useState<number | undefined>(undefined);
  const [enemyId, setEnemyId] = useState<string>('');
  const [extra, setExtra] = useState<string[]>([]);
  const unit = units.find((u) => u.id === unitId);
  const why = stratagemBlock(s, p, st, unit, { react, ctx });
  const timingOk = !why || /Select a target|Must be one of your units|Select an enemy unit|Not enough CP|TARGET|does not qualify|No enemy unit/.test(why);
  const cost = stratCost(s, st.id, unit?.owner === p && onBoard(unit) ? unit : undefined, st.cp);
  const choices = stratChoices(s, rule, unit);
  const enemies = rule.enemy && !rule.enemy.all ? stratEnemies(s, p, rule, unit, ctx) : [];
  const pickedChoice = choice ?? (choices.length === 1 ? choices[0].i : undefined);
  const needChoice = choices.length > 1 && pickedChoice === undefined;
  const pickedEnemy = enemies.find((e) => e.id === enemyId) ?? (enemies.length === 1 ? enemies[0] : undefined);
  const needEnemy = enemies.length > 1 && !pickedEnemy;
  // Guerrilla Tactics: "up to two PHOBOS and/or SCOUT SQUAD units" — extra picks only while every pick has one of the keywords
  const extraOk = (u: UnitState) => !!rule.extraTargets && u.id !== unitId
    && (!rule.extraTargets.kw || [unit, u].every((x) => x && rule.extraTargets!.kw!.some((k) => x.keywords.includes(k) || x.sources.some((n) => n.toUpperCase() === k))))
    && [unit, u].every((x) => x && !rule.extraTargets!.notKw?.some((k) => x.keywords.includes(k)));
  return (
    <div className={`strat-card ${timingOk ? '' : 'off'}`}>
      <div className="row">
        <b className="grow">{st.name}</b>
        <span className={`chip ${cost !== st.cp ? 'warn' : ''}`}>{cost !== st.cp ? <><s>{st.cp}</s> {cost}</> : st.cp}CP</span>
      </div>
      <div className="tiny muted">{detachment} · {st.turn} · {st.phase}</div>
      <div className="strat-fx">
        <span className={`chip ${rule.status === 'auto' || !rule.status ? 'good' : rule.status === 'partial' ? 'warn' : ''}`}>{rule.status === 'auto' || !rule.status ? 'Automated' : rule.status === 'partial' ? <><Icon name="partial" size={13} /> Mostly automated</> : 'Resolve as written'}</span>
        {(rule.buffs ?? []).map((k) => <span key={k} className="chip good">{EFFECT_LABEL[k] ?? k}</span>)}
        {rule.note && <span className="tiny muted">{rule.note}</span>}
      </div>
      <details><summary className="tiny">Full text</summary><div className="sheet tiny"><Em text={st.text} /></div></details>
      {timingOk && bot && <div className="tiny muted"><Icon name="bot" size={13} /> The bot decides when to use this Stratagem</div>}
      {timingOk && !bot && (
        <>
          {units.length > 1 && (
            <div className="unit-strip">
              {units.map((u) => (
                <button key={u.id} className={`unit-pill ${unitId === u.id ? 'sel' : extra.includes(u.id) ? 'sel2' : ''}`} onClick={() => {
                  if (unitId && unitId !== u.id && extraOk(u) && extra.length < (rule.extraTargets?.count ?? 1) - 1) { setExtra(extra.includes(u.id) ? extra.filter((x) => x !== u.id) : [...extra, u.id]); return; }
                  setUnitId(unitId === u.id ? '' : u.id); setExtra([]); setChoice(undefined); setEnemyId('');
                }}>
                  <span className={`side-dot s${u.owner}`} aria-hidden="true" /> {short(u.name)}{u.status === 'reserves' ? ' (Reserves)' : !alive(u).length ? ' (destroyed)' : ''}
                </button>
              ))}
            </div>
          )}
          {rule.extraTargets && unit && <div className="tiny muted">You can select {rule.extraTargets.count - 1 - extra.length} more unit(s) (tap another unit)</div>}
          {choices.length > 1 && (
            <div className="wg-chips">
              {choices.map(({ o, i }) => (
                <button key={i} type="button" className={pickedChoice === i ? 'on' : ''} onClick={() => setChoice(i)}>
                  {pickedChoice === i && <Icon name="check" size={16} />}{o.label}
                </button>
              ))}
            </div>
          )}
          {enemies.length > 1 && (
            <>
              <div className="tiny muted">Select an enemy unit</div>
              <div className="unit-strip">
                {enemies.map((e) => (
                  <button key={e.id} className={`unit-pill ${pickedEnemy?.id === e.id ? 'sel' : ''}`} onClick={() => setEnemyId(e.id)}>
                    <span className={`side-dot s${e.owner}`} aria-hidden="true" /> {short(e.name)}
                  </button>
                ))}
              </div>
            </>
          )}
          {enemies.length === 1 && <div className="tiny muted">Enemy: <b>{enemies[0].name}</b></div>}
          <button className="btn primary" disabled={!!why || needChoice || needEnemy} onClick={() => onUse(unit?.id, { choice: pickedChoice, enemyId: pickedEnemy?.id, extraIds: extra })}>
            {why ? why : needChoice ? 'Select an option first' : needEnemy ? 'Select an enemy unit first' : `Use ${st.name}${unit ? ` → ${short(unit.name)}` : ''}`}
          </button>
          {onAuto && (
            <label className="tiny row" style={{ gap: 6 }}>
              <input type="checkbox" checked={!!auto} onChange={onAuto} /> Use automatically when it comes up (don't ask)
            </label>
          )}
        </>
      )}
      {!timingOk && <div className="tiny muted">{why}</div>}
    </div>
  );
}
