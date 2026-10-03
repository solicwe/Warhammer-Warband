import { useEffect, useRef, useState } from 'react';
import { freeDiceNow } from '../engine/activations';
import { canUseStratagem, unitById } from '../engine/state';
import type { Die, GameState, Pool } from '../engine/types';
import { abilityLabel, abilitiesOf } from '../engine/weapons';
import { rerollable } from '../engine/attack';

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
}

const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '');

function DiceRow({ dice, cls, pick, onPick, picked }: { dice: Die[]; cls: (d: Die) => string; pick?: (d: Die) => boolean; onPick?: (i: number) => void; picked?: number[] }) {
  if (!dice.length) return <div className="muted small">—</div>;
  return (
    <div className="dice">
      {dice.map((d, i) => {
        const can = pick?.(d);
        return (
          <button key={i} type="button" className={`die ${cls(d)} ${d.rerolled ? 'rr' : ''} ${can ? 'pick' : ''} ${picked?.includes(i) ? 'picked' : ''}`} onClick={() => can && onPick?.(i)} title={d.rerolled ? `ทอยใหม่จาก ${d.orig}` : undefined}>
            {d.o === 'auto' ? '✓' : d.v}
          </button>
        );
      })}
    </div>
  );
}

function poolHeader(p: Pool) {
  const abil = abilitiesOf(p.profile).map(abilityLabel);
  return (
    <div>
      <div style={{ fontWeight: 800 }}>{p.weapon}{p.profile.name !== p.weapon ? ` – ${p.profile.name}` : ''}</div>
      <div className="tiny muted">
        {p.profile.range === 'Melee' ? 'Melee' : `${p.profile.range}"`} · A{p.profile.A} · {p.profile.skill ? `${p.profile.skill}+` : 'N/A'} · S{p.profile.S} · AP{p.profile.AP} · D{p.damage}
        {abil.length ? ` · [${abil.join(', ')}]` : ''}
      </div>
    </div>
  );
}

export function DiceTray({ s, onStep, onReroll, onSkip, onClose, onStrat, stratFor = [0, 1], onFree, onPick, auto }: Props) {
  const at = s.attack!;
  const [rr, setRr] = useState<null | 'hit' | 'wound' | 'save'>(null);
  const [fd, setFd] = useState<string | null>(null); // free die being used: tap the die
  const free = onFree ? freeDiceNow(s) : [];
  const freeOf = (stage: 'hit' | 'wound') => free.filter((f) => f.stage === stage);
  const fdSpec = free.find((f) => f.key === fd);
  const freeCan = (d: Die) => (fdSpec?.kind === 'setSix' ? d.v !== 6 && d.o !== 'auto' : fdSpec?.stage === 'hit' ? d.o === 'miss' && !d.rerolled : d.o === 'fail' && !d.rerolled);
  const freeButtons = (stage: 'hit' | 'wound') => freeOf(stage).map((f) => (
    <button key={f.key} className={`btn small ${fd === f.key ? 'on' : ''}`} onClick={() => { setRr(null); setFd(fd === f.key ? null : f.key); }}>
      ✨ {f.label}{fd === f.key ? ' — แตะลูกเต๋า' : ''}
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

  const stageOf = (pool: Pool) => (pool !== p ? 'done' : at.stage);
  const st = stageOf(p);
  const hitShown = p.hits.length > 0 || p.autoHit && st !== 'hit';
  // an ability re-roll waits for the attacker to pick the dice (the failures are picked to begin with)
  const pending = !done ? p.reroll : undefined;
  const nextLabel = done ? 'ปิด' : pending ? `ทอยใหม่ ${pending.picks.length} ลูกที่เลือก` : st === 'hit' ? `ทอย Hit (${p.attacks} ลูก)` : st === 'wound' ? 'ทอย Wound' : st === 'save' ? `${s.players[T.owner].name} ทอย Save` : 'คิดดาเมจ';
  const pickRow = (stage: 'hit' | 'wound') => (pending?.stage === stage && onPick
    ? { pick: (d: Die) => rerollable(p, d), picked: pending.picks, onPick: (i: number) => onPick(i) }
    : null);
  // the bot's own dice (hits, wounds, its re-rolls) roll by themselves; the player rolls the saves
  const [hold, setHold] = useState(false);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const botDice = !!auto && !done && (st === 'hit' || st === 'wound' || !!pending);
  useEffect(() => {
    if (!botDice || hold) return;
    const t = window.setTimeout(() => stepRef.current(), st === 'hit' && at.idx === 0 && !p.hits.length ? 1800 : 900);
    return () => window.clearTimeout(t);
  }, [botDice, hold, st, at.idx, p.hits.length, pending?.stage]);

  const hitCls = (d: Die) => d.o;
  const woundCls = (d: Die) => d.o;
  const saveCls = (d: Die) => (d.o === 'saved' ? 'saved' : d.o === 'fail' ? 'dmg' : '');

  return (
    <div className="tray-backdrop">
      <div className="tray">
        <div className="row">
          <div className="grow">
            <div className="small muted">{at.kind === 'fight' ? 'Fight' : at.kind === 'overwatch' ? 'Fire Overwatch' : 'Shooting'}</div>
            <div style={{ fontWeight: 800 }}>
              <span className={A.owner ? 'p1' : 'p0'}>{A.name}</span> <span className="muted">›</span> <span className={T.owner ? 'p1' : 'p0'}>{T.name}</span>
            </div>
          </div>
          {!done && <button className="btn small" onClick={guarded(onSkip)}>ข้าม</button>}
        </div>
        {auto && !done && <div className="tiny">🤖 บอทโจมตี — ลูกเต๋าของบอททอยเอง · คุณกดทอย Save เอง และใช้ Command Re-roll ได้{hold ? ' (หยุดรอ)' : ''}</div>}
        {onStrat && !done && at.idx === 0 && st === 'hit' && (
          <div className="row">
            {stratFor.includes(A.owner) && <button className="btn small" onClick={() => { setHold(true); onStrat(A.owner); }}>{s.players[A.owner].name}: Stratagem</button>}
            {stratFor.includes(T.owner) && <button className="btn small" onClick={() => { setHold(true); onStrat(T.owner); }}>{s.players[T.owner].name} (ฝ่ายรับ): Stratagem</button>}
          </div>
        )}
        {pending && (
          <div className="tiny">🎲 {pending.which === 'all' ? 'Re-roll ได้ (ability)' : 'Re-roll ลูกที่ได้ 1 ได้ (ability)'}: แตะลูกเต๋าเพื่อเลือก/เอาออก — เลือกลูกที่พลาดไว้ให้แล้ว (ทอยใหม่ได้ลูกละครั้ง)</div>
        )}
        {at.pools.length > 1 && <div className="tiny muted">อาวุธชุดที่ {Math.min(at.idx + 1, at.pools.length)} / {at.pools.length}</div>}

        {!done && (
          <>
            {poolHeader(p)}
            <div className={`stage ${st === 'hit' ? 'active' : ''}`}>
              <div className="stage-head"><span>1. Hit</span><span className="need">{p.autoHit ? 'Torrent: โดนอัตโนมัติ' : p.hitOn6Only ? 'ต้องได้ 6' : `ต้องได้ ${p.skill}+${p.hitMod ? ` (${sign(p.hitMod)} hit)` : ''}`}</span></div>
              <div className="tiny muted">{p.attackNote}{p.skillNote ? ` · ${p.skillNote}` : ''}{p.hitNote ? ` · ${p.hitNote}` : ''}</div>
              {hitShown && (
                <>
                  {pickRow('hit') ? <DiceRow dice={p.hits} cls={hitCls} {...pickRow('hit')!} /> : (
                    <DiceRow dice={p.hits} cls={hitCls}
                      pick={rr === 'hit' ? (d) => d.o === 'miss' && !d.rerolled : fdSpec?.stage === 'hit' && st === 'wound' ? freeCan : undefined}
                      onPick={(i) => { if (rr === 'hit') { onReroll('hit', i); setRr(null); } else if (fd) { onFree?.(fd, i); setFd(null); } }} />
                  )}
                  <div className="small">
                    โดน <b>{p.hits.filter((h) => h.o !== 'miss').length}</b>
                    {p.hits.some((h) => h.o === 'crit') && <> · Critical <b>{p.hits.filter((h) => h.o === 'crit').length}</b>{p.sustained ? ` (Sustained ${p.sustained})` : ''}{p.lethal ? ' (Lethal Hits)' : ''}</>}
                  </div>
                  {st === 'wound' && !pending && !p.autoHit && freeButtons('hit')}
                  {st === 'wound' && !pending && !p.autoHit && !p.noHitReroll && !auto && (
                    <button className={`btn small ${rr === 'hit' ? 'on' : ''}`} disabled={!!attackerCR || !p.hits.some((d) => d.o === 'miss' && !d.rerolled)} onClick={() => setRr(rr === 'hit' ? null : 'hit')}>
                      Command Re-roll 1CP {attackerCR ? `(${attackerCR})` : rr === 'hit' ? '— แตะลูกที่พลาด' : ''}
                    </button>
                  )}
                </>
              )}
            </div>

            {(st === 'wound' || st === 'save' || st === 'damage') && (
              <div className={`stage ${st === 'save' && !p.wounds.length && !p.autoWounds ? '' : st === 'save' ? 'active' : ''}`}>
                <div className="stage-head"><span>2. Wound</span><span className="need">ต้องได้ {p.woundNeed}+{p.woundMod ? ` (${sign(p.woundMod)})` : ''}{p.critWoundOn < 6 ? ` · Anti: ${p.critWoundOn}+ = critical` : ''}</span></div>
                <div className="tiny muted">{p.woundNote}{p.twinLinked ? ' · Twin-linked: ทอยใหม่ลูกที่พลาด' : ''}</div>
                {st !== 'wound' && (
                  <>
                    {pickRow('wound') ? <DiceRow dice={p.wounds} cls={woundCls} {...pickRow('wound')!} /> : (
                      <DiceRow dice={p.wounds} cls={woundCls}
                        pick={rr === 'wound' ? (d) => d.o === 'fail' && !d.rerolled : fdSpec?.stage === 'wound' && st === 'save' ? freeCan : undefined}
                        onPick={(i) => { if (rr === 'wound') { onReroll('wound', i); setRr(null); } else if (fd) { onFree?.(fd, i); setFd(null); } }} />
                    )}
                    <div className="small">
                      Wound <b>{p.wounds.filter((w) => w.o !== 'fail').length + p.autoWounds}</b>
                      {p.autoWounds ? ` (รวม Lethal Hits ${p.autoWounds})` : ''}
                      {p.devastating && p.wounds.some((w) => w.o === 'critWound') ? ` · Devastating ${p.wounds.filter((w) => w.o === 'critWound').length} (mortal wounds)` : ''}
                    </div>
                    {st === 'save' && !pending && freeButtons('wound')}
                    {st === 'save' && !pending && !auto && (
                      <button className={`btn small ${rr === 'wound' ? 'on' : ''}`} disabled={!!attackerCR || !p.wounds.some((d) => d.o === 'fail' && !d.rerolled)} onClick={() => setRr(rr === 'wound' ? null : 'wound')}>
                        Command Re-roll 1CP {attackerCR ? `(${attackerCR})` : rr === 'wound' ? '— แตะลูกที่พลาด' : ''}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {st === 'damage' && (
              <div className="stage active">
                <div className="stage-head"><span>3. Save ({s.players[T.owner].name})</span><span className="need">AP{p.ap} · ใช้ผลต่ำสุดก่อน</span></div>
                <div className="tiny muted">ผลทอยจะถูกใช้กับโมเดลตามลำดับ allocation (ตัวที่บาดเจ็บก่อน · CHARACTER ทีหลัง)</div>
                <DiceRow dice={p.saves} cls={saveCls} pick={rr === 'save' ? (d) => !d.rerolled : undefined} onPick={(i) => { onReroll('save', i); setRr(null); }} />
                <button className={`btn small ${rr === 'save' ? 'on' : ''}`} disabled={!!defenderCR || !p.saves.length} onClick={() => setRr(rr === 'save' ? null : 'save')}>
                  {s.players[T.owner].name}: Command Re-roll save 1CP {defenderCR ? `(${defenderCR})` : rr === 'save' ? '— แตะลูกที่จะทอยใหม่' : ''}
                </button>
              </div>
            )}
          </>
        )}

        {at.pools.filter((x) => x.done).length > 0 && (
          <div className="stage">
            <div className="stage-head"><span>ผลลัพธ์</span></div>
            {at.pools.filter((x) => x.done).map((x, i) => (
              <div key={i} className="small" style={{ marginBottom: 6 }}>
                <b>{x.weapon}</b>: {x.attacks} attacks {x.hits.filter((h) => h.o !== 'miss').length} hit {x.wounds.filter((w) => w.o !== 'fail').length + x.autoWounds} wound
                {x.saves.length ? <> · save <DiceRow dice={x.saves} cls={saveCls} /></> : null}
                {x.damageLines.length > 0 && <div className="tiny muted">{x.damageLines.join(' · ')}</div>}
                {x.mortalFromDev.some(Boolean) && <div className="tiny">Devastating Wounds: {x.mortalFromDev.join(', ')} MW</div>}
                <div>ตาย <b>{x.killed}</b></div>
              </div>
            ))}
          </div>
        )}
        {done && <div className="big-result">{T.name}: เหลือ {T.models.filter((m) => !m.dead).length}/{T.startingStrength}</div>}

        <button className={`btn primary ${cool ? 'cooling' : ''}`} onClick={guarded(done ? onClose : onStep)}>{nextLabel}</button>
      </div>
    </div>
  );
}
