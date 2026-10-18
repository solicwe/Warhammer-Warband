// Blessings of Khorne roll: the dice (tap to pick the ones to re-roll), the ways to use them, and what each Blessing does.
import { useState } from 'react';
import { BLESSINGS, blessingById, blessingNeed, blessingPicks, type BlessingPick } from '../factions/blessings';
import { Die } from './RollOverlay';

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
  const [open, setOpen] = useState<string | null>(null);
  const [list, setList] = useState(false);
  const [all, setAll] = useState(false); // the best three choices first, the rest on request
  const toggle = (i: number) => setSel((x) => (x.includes(i) ? x.filter((y) => y !== i) : x.length < rerolls ? [...x, i] : x));
  // which Blessings these dice can pay for on their own (the green ones in the list)
  const payable = new Set(blessingPicks(dice, 1).flatMap((p) => p.ids));
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
          <button type="button" className="btn small" disabled={!sel.length} onClick={() => { onReroll(sel); setSel([]); }}>Re-roll {sel.length || ''}</button>
        </div>
      )}
      {picks.length ? (all ? picks : picks.slice(0, 3)).map((pk, i) => (
        <button key={i} type="button" className={`btn bk-pick ${i === 0 ? 'primary' : ''}`} onClick={() => onPick(pk)}>
          {pk.reborn ? 'Reborn in Blood — Angron returns (three 6s)' : <>
            <span className="bk-pick-name">{pk.ids.map((id) => blessingById(id)!.name).join(' + ')}</span>
            <span className="bk-pick-fx">{pk.ids.map((id) => blessingById(id)!.short).join(' · ')}</span>
          </>}
        </button>
      )) : <div className="tiny muted">These dice pay for no Blessing{rerolls ? ' — re-roll some' : ''}.</div>}
      {picks.length > 3 && !all && <button type="button" className="bk-more" onClick={() => setAll(true)}>{picks.length - 3} more choices</button>}
      <button type="button" className="btn ghost" onClick={() => onPick(null)}>No Blessing</button>
      <button type="button" className="bk-more" onClick={() => setList(!list)} aria-expanded={list}>{list ? 'Hide the Blessings' : 'What each Blessing does'}</button>
      {list && BLESSINGS.map((b) => (
        <button key={b.id} type="button" className={`bk-row ${payable.has(b.id) ? 'ok' : ''}`} onClick={() => setOpen(open === b.id ? null : b.id)}>
          <span className="bk-name">{b.name}</span>
          <span className="bk-need">{blessingNeed(b)}</span>
          <span className="bk-short">{b.short}</span>
          {open === b.id && <span className="bk-text">{b.text}</span>}
        </button>
      ))}
    </div>
  );
}
