// Blessings of Khorne roll: re-roll dice, then select up to two Blessings individually.
import { useState } from 'react';
import { BLESSINGS, blessingNeed, type BlessingPick } from '../factions/blessings';
import { Die } from './RollOverlay';

export function findBlessingPick(picks: BlessingPick[], ids: string[]): BlessingPick | undefined {
  return picks.find((pick) => !pick.reborn && pick.ids.length === ids.length && pick.ids.every((id) => ids.includes(id)));
}

interface Props {
  title: string;
  dice: number[];
  picks: BlessingPick[];
  rerolls: number;
  rerollFrom?: string;
  onReroll: (idx: number[]) => void;
  onPick: (p: BlessingPick | null) => void;
}

export function BlessingsPanel({ title, dice, picks, rerolls, rerollFrom, onReroll, onPick }: Props) {
  const [sel, setSel] = useState<number[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reborn, setReborn] = useState(false);
  const toggle = (i: number) => setSel((x) => (x.includes(i) ? x.filter((y) => y !== i) : x.length < rerolls ? [...x, i] : x));
  const available = new Set(picks.flatMap((p) => p.ids));
  const selectedPick = reborn ? picks.find((p) => p.reborn) : findBlessingPick(picks, selectedIds);

  return (
    <div className="bk">
      <div className="bk-head">{title}</div>
      <div className="bk-dice">
        {dice.map((v, i) => (
          <button key={`${i}-${v}`} type="button" className={`bk-die ${sel.includes(i) ? 'sel' : ''}`} disabled={!rerolls} onClick={() => toggle(i)} aria-label={`Die ${v}${sel.includes(i) ? ', to re-roll' : ''}`}>
            <Die v={v} size={30} color={sel.includes(i) ? '#c8262a' : undefined} />
          </button>
        ))}
      </div>
      {rerolls > 0 && (
        <div className="bk-rr">
          <span className="tiny muted">{rerollFrom}: tap up to {rerolls} dice</span>
          <button type="button" className="btn small" disabled={!sel.length} onClick={() => { onReroll(sel); setSel([]); setSelectedIds([]); setReborn(false); }}>Re-roll {sel.length || ''}</button>
        </div>
      )}
      {picks.length ? (
        <>
          <div className="tiny muted">Choose up to two Blessings one at a time, then confirm.</div>
          {BLESSINGS.filter((b) => available.has(b.id)).map((b) => {
            const chosen = selectedIds.includes(b.id);
            return (
              <button key={b.id} type="button" className={`btn bk-pick ${chosen ? 'primary' : ''}`} aria-pressed={chosen}
                onClick={() => {
                  setReborn(false);
                  setSelectedIds((ids) => chosen ? ids.filter((id) => id !== b.id) : ids.length < 2 ? [...ids, b.id] : ids);
                }}>
                <span className="bk-pick-name">{b.name}</span>
                <span className="bk-pick-fx">{b.short} · {blessingNeed(b)}</span>
              </button>
            );
          })}
          {picks.some((p) => p.reborn) && (
            <button type="button" className={`btn bk-pick ${reborn ? 'primary' : ''}`} aria-pressed={reborn}
              onClick={() => { setSelectedIds([]); setReborn(true); }}>
              <span className="bk-pick-name">Reborn in Blood</span>
              <span className="bk-pick-fx">Angron returns · three 6s</span>
            </button>
          )}
          {selectedIds.length === 2 && !selectedPick && <div className="tiny muted">These two Blessings cannot be paid for by this roll.</div>}
          <button type="button" className="btn primary" disabled={!selectedPick} onClick={() => selectedPick && onPick(selectedPick)}>Choose Blessing</button>
        </>
      ) : <div className="tiny muted">These dice pay for no Blessing{rerolls ? ' — re-roll some' : ''}.</div>}
      <button type="button" className="btn ghost" onClick={() => onPick(null)}>No Blessing</button>
    </div>
  );
}
