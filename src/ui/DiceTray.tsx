import { useEffect, useRef, useState } from 'react';
import { freeDiceNow } from '../engine/activations';
import { canUseStratagem, unitById } from '../engine/state';
import type { Die, GameState, Pool } from '../engine/types';
import { abilityLabel, abilitiesOf } from '../engine/weapons';
import { rerollable } from '../engine/attack';
import { Icon } from './Icon';
import { play } from './sfx';
import { Portrait, unitToken } from './Tokens';
import { modelPortraitKey } from './portraits';
import { getPlayerFactionTheme } from './factionColors';

interface Props {
  s: GameState;
  onStep: () => void;
  onReroll: (stage: 'hit' | 'wound' | 'save', index: number) => void;
  onSkip: () => void;
  onClose: () => void;
  /** open the stratagem sheet for a player (e.g. the defender reacting to the attack) */
  onStrat?: (player: 0 | 1) => void;
  stratFor?: (0 | 1)[];
  /** free re-rolls / "change to a 6" from abilities (Armorium Cherub …) */
  onFree?: (key: string, index: number) => void;
  /** pick / unpick a die for an ability re-roll ("you can re-roll the Hit roll") */
  onPick?: (index: number) => void;
  /** the bot is attacking: its own dice roll by themselves, the player rolls the saves */
  auto?: boolean;
  /** players run by the bot: their re-rolls and stratagems are the bot's own decisions, no buttons for them */
  botSides?: (0 | 1)[];
  /** Command Re-roll on the random number of attacks (now), or on the next low damage roll (a switch) */
  onCR?: (what: 'attacks' | 'damage') => void;
}

const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '');

function DiceRow({ dice, cls, pick, onPick, picked }: { dice: Die[]; cls: (d: Die) => string; pick?: (d: Die) => boolean; onPick?: (i: number) => void; picked?: number[] }) {
  if (!dice.length) return <div className="muted small">-</div>;
  return (
    <div className="dice">
      {dice.map((d, i) => {
        const can = pick?.(d);
        return (
          <button
            key={i}
            type="button"
            className={`die ${cls(d)} ${d.rerolled ? 'rr' : ''} ${can ? 'pick' : ''} ${picked?.includes(i) ? 'picked' : ''}`}
            onClick={() => can && onPick?.(i)}
            title={d.rerolled ? `Re-rolled from ${d.orig}` : undefined}
          >
            {d.o === 'auto' ? <Icon name="check" size={16} /> : d.v}
          </button>
        );
      })}
    </div>
  );
}

export function DiceTray({ s, onStep, onReroll, onSkip, onClose, onStrat, stratFor = [0, 1], onFree, onPick, auto, botSides = [], onCR }: Props) {
  const at = s.attack!;
  const [rr, setRr] = useState<null | 'hit' | 'wound' | 'save'>(null);
  const [fd, setFd] = useState<string | null>(null); // free die being used: tap the die
  const free = onFree ? freeDiceNow(s) : [];
  const freeOf = (stage: 'hit' | 'wound') => free.filter((f) => f.stage === stage);
  const fdSpec = free.find((f) => f.key === fd);
  const freeCan = (d: Die) => (fdSpec?.kind === 'setSix' ? d.v !== 6 && d.o !== 'auto' : fdSpec?.stage === 'hit' ? d.o === 'miss' && !d.rerolled : d.o === 'fail' && !d.rerolled);
  const freeButtons = (stage: 'hit' | 'wound') => freeOf(stage).map((f) => (
    <button key={f.key} className={`btn small ${fd === f.key ? 'on' : ''}`} onClick={() => { setRr(null); setFd(fd === f.key ? null : f.key); }}>
      <Icon name="ability" size={16} /> {f.label}{fd === f.key ? ' - tap a die' : ''}
    </button>
  ));

  // a quick second tap must not roll the next stage before the player has seen these dice
  const lastTap = useRef(0);
  const [cool, setCool] = useState(false);
  const guarded = (fn: () => void) => () => {
    if (Date.now() - lastTap.current < 700) return;
    lastTap.current = Date.now();
    setCool(true);
    window.setTimeout(() => setCool(false), 700);
    fn();
  };

  const A = unitById(s, at.attackerId);
  const T = unitById(s, at.targetId);
  const p = at.pools[Math.min(at.idx, at.pools.length - 1)];
  const done = at.stage === 'done';
  const attackerCR = canUseStratagem(s, A.owner, 'command-reroll', A);
  const defenderCR = canUseStratagem(s, T.owner, 'command-reroll', T);
  const attackerBot = botSides.includes(A.owner);
  const defenderBot = botSides.includes(T.owner);

  const stageOf = (pool: Pool) => (pool !== p ? 'done' : at.stage);
  const st = stageOf(p);
  const hitShown = p.hits.length > 0 || (p.autoHit && st !== 'hit');
  const pending = !done ? p.reroll : undefined;
  const nextLabel = done
    ? 'Finish Attack'
    : pending
      ? `Re-roll ${pending.picks.length} selected`
      : st === 'hit'
        ? `Roll to Hit (${p.attacks} dice)`
        : st === 'wound'
          ? 'Roll to Wound'
          : st === 'save'
            ? `${s.players[T.owner].name}: Roll Saving Throws`
            : 'Allocate Damage';

  const pickRow = (stage: 'hit' | 'wound') =>
    pending?.stage === stage && onPick && !botSides.includes(A.owner)
      ? { pick: (d: Die) => rerollable(p, d), picked: pending.picks, onPick: (i: number) => onPick(i) }
      : null;

  // bot auto-rolling
  const [hold, setHold] = useState(false);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const botDice = !!auto && !done && (st === 'hit' || st === 'wound' || !!pending);
  useEffect(() => {
    if (!botDice || hold) return;
    const t = window.setTimeout(() => stepRef.current(), st === 'hit' && at.idx === 0 && !p.hits.length ? 1800 : 900);
    return () => window.clearTimeout(t);
  }, [botDice, hold, st, at.idx, p.hits.length, pending?.stage]);

  // dice roll audio
  const rolled = at.pools.reduce(
    (a, q) =>
      a +
      q.hits.length +
      q.wounds.length +
      q.saves.length +
      q.hits.filter((d) => d.rerolled).length +
      q.wounds.filter((d) => d.rerolled).length +
      q.saves.filter((d) => d.rerolled).length,
    0,
  );
  const weaponAbilities = abilitiesOf(p.profile).map(abilityLabel);
  const lastRolled = useRef(rolled);
  useEffect(() => {
    if (rolled > lastRolled.current) {
      if (st === 'hit') {
        const isMelee = p.profile.range === 'Melee' || at.kind === 'fight';
        const hasTorrent = p.autoHit || /torrent|flamer/i.test(p.weapon) || /torrent/i.test(weaponAbilities.join(' '));
        const isMelta = /melta/i.test(p.weapon) || /melta/i.test(weaponAbilities.join(' '));
        const isPlasma = /plasma/i.test(p.weapon) || /hazardous/i.test(weaponAbilities.join(' '));
        const isBolt = /bolt/i.test(p.weapon);
        if (isMelee) play('melee');
        else if (hasTorrent) play('flamer');
        else if (isMelta) play('melta');
        else if (isPlasma) play('plasma');
        else if (isBolt) play('bolt');
      }
      play('dice', Math.min(8, rolled - lastRolled.current));
      window.setTimeout(() => play('land'), 420);
    }
    lastRolled.current = rolled;
  }, [rolled, st, p, at.kind, weaponAbilities]);

  const hitCls = (d: Die) => d.o;
  const woundCls = (d: Die) => d.o;
  const saveCls = (d: Die) => (d.o === 'saved' ? 'saved' : d.o === 'fail' ? 'dmg' : '');

  // Theme & unit portrait lookups
  const pATheme = getPlayerFactionTheme(s, A.owner);
  const pTTheme = getPlayerFactionTheme(s, T.owner);
  const aLead = A.models.find((m) => m.isCharacter && !m.dead) ?? A.models.find((m) => !m.dead) ?? A.models[0];
  const tLead = T.models.find((m) => m.isCharacter && !m.dead) ?? T.models.find((m) => !m.dead) ?? T.models[0];
  const aPortraitKey = aLead ? (aLead.name && aLead.name !== aLead.source ? modelPortraitKey(aLead.source, aLead.name) : aLead.source) : '';
  const tPortraitKey = tLead ? (tLead.name && tLead.name !== tLead.source ? modelPortraitKey(tLead.source, tLead.name) : tLead.source) : '';

  const tRemainingModels = T.models.filter((m) => !m.dead).length;
  const tPctHealth = Math.round((tRemainingModels / Math.max(1, T.startingStrength)) * 100);

  return (
    <div className="tray-backdrop">
      <div className="tray dice-tray combat-modal">
        {/* Tactical Matchup Header */}
        <div className="combat-header">
          <div className="combat-side-tag">
            {aLead && (
              <Portrait
                kind={unitToken(A)}
                owner={A.owner}
                character={A.models.some((m) => m.isCharacter && !m.dead)}
                size={36}
                datasheet={aPortraitKey}
                fallback={aLead.source}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <div className="combat-unit-title" style={{ color: pATheme.primary }}>{A.name}</div>
              <div className="combat-faction-sub">{s.players[A.owner].name}</div>
            </div>
          </div>

          <div className="combat-phase-badge">
            <span className="combat-phase-title">
              {at.kind === 'fight' ? 'Melee' : at.kind === 'overwatch' ? 'Overwatch' : 'Ranged'}
            </span>
            {at.pools.length > 1 && (
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                Group {Math.min(at.idx + 1, at.pools.length)}/{at.pools.length}
              </span>
            )}
          </div>

          <div className="combat-side-tag right">
            <div style={{ minWidth: 0 }}>
              <div className="combat-unit-title" style={{ color: pTTheme.primary }}>{T.name}</div>
              <div className="combat-faction-sub">{s.players[T.owner].name}</div>
            </div>
            {tLead && (
              <Portrait
                kind={unitToken(T)}
                owner={T.owner}
                character={T.models.some((m) => m.isCharacter && !m.dead)}
                size={36}
                datasheet={tPortraitKey}
                fallback={tLead.source}
              />
            )}
          </div>

          {!done && (
            <button className="btn small primary" onClick={guarded(onSkip)} style={{ marginLeft: 6, background: '#d99b26', borderColor: '#f59e0b', color: '#0f172a', fontWeight: 800 }} title="Instantly resolve all rolls and calculate damage">
              1-Click Resolve
            </button>
          )}
        </div>

        {/* Combat Stage Stepper Pipeline */}
        <div className="combat-stepper">
          <div className={`combat-step ${st === 'hit' ? 'active' : p.hits.length || p.autoHit ? 'done' : ''}`}>
            {(p.hits.length > 0 || p.autoHit) && st !== 'hit' ? <Icon name="check" size={13} /> : null} 1. Hit
          </div>
          <div className={`combat-step ${st === 'wound' ? 'active' : p.wounds.length || p.autoWounds ? 'done' : ''}`}>
            {(p.wounds.length > 0 || p.autoWounds) && st !== 'wound' && st !== 'hit' ? <Icon name="check" size={13} /> : null} 2. Wound
          </div>
          <div className={`combat-step ${st === 'save' ? 'active' : p.saves.length ? 'done' : ''}`}>
            {p.saves.length > 0 && st === 'damage' ? <Icon name="check" size={13} /> : null} 3. Save
          </div>
          <div className={`combat-step ${st === 'damage' || done ? 'active' : ''}`}>
            {done ? <Icon name="check" size={13} /> : null} 4. Result
          </div>
        </div>

        {auto && !done && (
          <div className="tiny" style={{ padding: '0 14px', color: '#94a3b8' }}>
            <Icon name="bot" size={13} /> Bot attacking: it rolls its own attacks. You roll saving throws and Command Re-roll{hold ? ' (paused)' : ''}.
          </div>
        )}

        {onStrat && !done && at.idx === 0 && st === 'hit' && (
          <div className="combat-actions-dock">
            {stratFor.includes(A.owner) && (
              <button className="btn small" onClick={() => { setHold(true); onStrat(A.owner); }}>
                {s.players[A.owner].name}: Stratagem
              </button>
            )}
            {stratFor.includes(T.owner) && (
              <button className="btn small" onClick={() => { setHold(true); onStrat(T.owner); }}>
                {s.players[T.owner].name} (defender): Stratagem
              </button>
            )}
          </div>
        )}

        {pending && (
          <div className="tiny" style={{ padding: '0 14px', color: '#38bdf8' }}>
            <Icon name="dice" size={13} /> {pending.which === 'all' ? 'Re-roll all (ability)' : 'Re-roll 1s (ability)'}: tap dice to select/deselect (failed dice pre-selected).
          </div>
        )}

        {/* Active Weapon Profile Strip */}
        {!done && (
          <div className="combat-weapon-card">
            <div className="combat-weapon-name">
              {p.weapon}{p.profile.name !== p.weapon ? ` - ${p.profile.name}` : ''}
            </div>
            <div className="combat-stat-row">
              <span className="combat-stat-pill">RNG <b>{p.profile.range === 'Melee' ? 'Melee' : `${p.profile.range}"`}</b></span>
              <span className="combat-stat-pill">A <b>{p.profile.A}</b></span>
              <span className="combat-stat-pill">BS/WS <b>{p.profile.skill ? `${p.profile.skill}+` : 'N/A'}</b></span>
              <span className="combat-stat-pill">S <b>{p.profile.S}</b></span>
              <span className="combat-stat-pill">AP <b>{p.profile.AP}</b></span>
              <span className="combat-stat-pill">D <b>{p.damage}</b></span>
              {weaponAbilities.map((ab, idx) => (
                <span key={idx} className="combat-stat-pill accent">[{ab}]</span>
              ))}
            </div>
          </div>
        )}

        {/* Stage 1: Hit Resolution */}
        {!done && (
          <div className="combat-dice-section">
            <div className={`combat-dice-box ${st === 'hit' ? 'active-box' : ''}`}>
              <div className="combat-requirement-bar" style={{ margin: 0 }}>
                <span><b>1. Hit Stage</b></span>
                <span className="need">
                  {p.autoHit ? 'Torrent: Automatic Hit' : p.hitOn6Only ? 'Needs a 6' : `Needs ${p.skill}+${p.hitMod ? ` (${sign(p.hitMod)} hit)` : ''}`}
                </span>
              </div>
              <div className="tiny muted">{p.attackNote}{p.skillNote ? ` · ${p.skillNote}` : ''}{p.hitNote ? ` · ${p.hitNote}` : ''}</div>

              {st === 'hit' && !p.hits.length && !attackerBot && onCR && p.attackRolls?.some((r) => !r.rerolled) && (
                <button className="btn small" disabled={!!attackerCR} onClick={() => onCR('attacks')} style={{ alignSelf: 'flex-start' }}>
                  <Icon name="dice" size={16} /> Command Re-roll Attacks 1CP ({p.attackRolls.filter((r) => !r.rerolled).map((r) => `${r.expr}=${r.total}`).join(', ')}){attackerCR ? ` (${attackerCR})` : ''}
                </button>
              )}

              {hitShown && (
                <>
                  {pickRow('hit') ? (
                    <DiceRow dice={p.hits} cls={hitCls} {...pickRow('hit')!} />
                  ) : (
                    <DiceRow
                      dice={p.hits}
                      cls={hitCls}
                      pick={rr === 'hit' ? (d) => d.o === 'miss' && !d.rerolled : fdSpec?.stage === 'hit' && st === 'wound' ? freeCan : undefined}
                      onPick={(i) => {
                        if (rr === 'hit') { onReroll('hit', i); setRr(null); }
                        else if (fd) { onFree?.(fd, i); setFd(null); }
                      }}
                    />
                  )}
                  <div className="small" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span>Hits: <b>{p.hits.filter((h) => h.o !== 'miss').length}</b></span>
                    {p.hits.some((h) => h.o === 'crit') && (
                      <span style={{ color: '#fbbf24' }}>
                        Critical: <b>{p.hits.filter((h) => h.o === 'crit').length}</b>
                        {p.sustained ? ` (Sustained +${p.sustained})` : ''}
                        {p.lethal ? ' (Lethal Hits)' : ''}
                      </span>
                    )}
                  </div>
                  {st === 'wound' && !pending && !p.autoHit && !attackerBot && freeButtons('hit')}
                  {st === 'wound' && !pending && !p.autoHit && !p.noHitReroll && !attackerBot && (
                    <button
                      className={`btn small ${rr === 'hit' ? 'on' : ''}`}
                      disabled={!!attackerCR || !p.hits.some((d) => d.o === 'miss' && !d.rerolled)}
                      onClick={() => setRr(rr === 'hit' ? null : 'hit')}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      Command Re-roll 1CP {attackerCR ? `(${attackerCR})` : rr === 'hit' ? '- tap a failed die' : ''}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Stage 2: Wound Resolution */}
            {(st === 'wound' || st === 'save' || st === 'damage') && (
              <div className={`combat-dice-box ${st === 'wound' ? 'active-box' : ''}`}>
                <div className="combat-requirement-bar" style={{ margin: 0, borderLeftColor: '#f59e0b' }}>
                  <span><b>2. Wound Stage</b></span>
                  <span className="need">
                    Needs {p.woundNeed}+{p.woundMod ? ` (${sign(p.woundMod)})` : ''}{p.critWoundOn < 6 ? ` · Anti: ${p.critWoundOn}+ Critical` : ''}
                  </span>
                </div>
                <div className="tiny muted">{p.woundNote}{p.twinLinked ? ' · Twin-linked: re-roll failed dice' : ''}</div>

                {st !== 'wound' && (
                  <>
                    {pickRow('wound') ? (
                      <DiceRow dice={p.wounds} cls={woundCls} {...pickRow('wound')!} />
                    ) : (
                      <DiceRow
                        dice={p.wounds}
                        cls={woundCls}
                        pick={rr === 'wound' ? (d) => d.o === 'fail' && !d.rerolled : fdSpec?.stage === 'wound' && st === 'save' ? freeCan : undefined}
                        onPick={(i) => {
                          if (rr === 'wound') { onReroll('wound', i); setRr(null); }
                          else if (fd) { onFree?.(fd, i); setFd(null); }
                        }}
                      />
                    )}
                    <div className="small" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span>Wounds: <b>{p.wounds.filter((w) => w.o !== 'fail').length + p.autoWounds}</b>{p.autoWounds ? ` (incl. ${p.autoWounds} Lethal)` : ''}</span>
                      {p.devastating && p.wounds.some((w) => w.o === 'critWound') && (
                        <span style={{ color: '#c084fc' }}>
                          Devastating: <b>{p.wounds.filter((w) => w.o === 'critWound').length}</b> (Mortal Wounds)
                        </span>
                      )}
                    </div>
                    {st === 'save' && !pending && !attackerBot && freeButtons('wound')}
                    {st === 'save' && !pending && !attackerBot && (
                      <button
                        className={`btn small ${rr === 'wound' ? 'on' : ''}`}
                        disabled={!!attackerCR || !p.wounds.some((d) => d.o === 'fail' && !d.rerolled)}
                        onClick={() => setRr(rr === 'wound' ? null : 'wound')}
                        style={{ alignSelf: 'flex-start' }}
                      >
                        Command Re-roll 1CP {attackerCR ? `(${attackerCR})` : rr === 'wound' ? '- tap a failed die' : ''}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Stage 3: Saving Throws */}
            {(st === 'save' || st === 'damage') && !attackerBot && onCR && /d/i.test(p.damage) && (
              <button
                className={`btn small ${p.crDamage ? 'on' : ''}`}
                disabled={!!attackerCR && !p.crDamage}
                onClick={() => onCR('damage')}
                style={{ alignSelf: 'flex-start' }}
              >
                <Icon name="dice" size={16} /> Command Re-roll Damage 1CP: {p.crDamage ? 'Low damage roll will be re-rolled' : 'Re-roll low Damage roll'}{attackerCR && !p.crDamage ? ` (${attackerCR})` : ''}
              </button>
            )}

            {st === 'damage' && (
              <div className="combat-dice-box active-box">
                <div className="combat-requirement-bar" style={{ margin: 0, borderLeftColor: '#ef4444' }}>
                  <span><b>3. Saving Throws ({s.players[T.owner].name})</b></span>
                  <span className="need">AP{p.ap} · Wounded models first</span>
                </div>
                <div className="tiny muted">Saving throws resolved in casualty allocation order.</div>
                <DiceRow
                  dice={p.saves}
                  cls={saveCls}
                  pick={rr === 'save' ? (d) => !d.rerolled : undefined}
                  onPick={(i) => { onReroll('save', i); setRr(null); }}
                />
                {defenderBot ? (
                  <div className="tiny muted"><Icon name="bot" size={13} /> {s.players[T.owner].name} decides its own save re-rolls</div>
                ) : (
                  <button
                    className={`btn small ${rr === 'save' ? 'on' : ''}`}
                    disabled={!!defenderCR || !p.saves.length}
                    onClick={() => setRr(rr === 'save' ? null : 'save')}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {s.players[T.owner].name}: Command Re-roll Save 1CP {defenderCR ? `(${defenderCR})` : rr === 'save' ? '- tap a failed die' : ''}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Combat Outcome Breakdown */}
        {at.pools.filter((x) => x.done).length > 0 && (
          <div className="combat-dice-box" style={{ margin: '0 14px' }}>
            <div style={{ fontWeight: 800, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>
              Combat Casualties & Damage
            </div>
            {at.pools.filter((x) => x.done).map((x, i) => (
              <div key={i} className="small" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>{x.weapon}</b>
                  <span>Destroyed: <b style={{ color: '#ef4444' }}>{x.killed}</b></span>
                </div>
                <div className="tiny muted">
                  {x.attacks} attacks · {x.hits.filter((h) => h.o !== 'miss').length} hit · {x.wounds.filter((w) => w.o !== 'fail').length + x.autoWounds} wound
                  {x.damageLines.length > 0 && ` · ${x.damageLines.join(', ')}`}
                </div>
              </div>
            ))}
          </div>
        )}

        {done && (
          <div style={{ margin: '0 14px', padding: '12px', background: '#141b24', border: '1px solid #1e293b', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>{T.name} Status</span>
              <span style={{ fontWeight: 800, color: tRemainingModels === 0 ? '#ef4444' : '#4ade80' }}>
                {tRemainingModels} / {T.startingStrength} Models Alive ({tPctHealth}%)
              </span>
            </div>
            <div className="meter" style={{ width: '100%', maxWidth: 'none', height: 6 }}>
              <i style={{ width: `${tPctHealth}%`, background: tRemainingModels === 0 ? '#ef4444' : '#22c55e' }} />
            </div>
          </div>
        )}

        {/* Sticky Action Footer */}
        <div className="sticky-act tray-act" style={{ padding: '12px 14px' }}>
          <button
            className={`btn primary big wide ${cool ? 'cooling' : ''}`}
            onClick={guarded(done ? onClose : onStep)}
            style={{ fontWeight: 800, letterSpacing: '0.04em' }}
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
