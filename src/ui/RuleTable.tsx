import { useState } from 'react';
import { Em } from './Em';

/** Rules shown the way you look them up mid-game: which phase, whose turn, what it gives. Phase colours come from
 *  the --ph-* tokens in styles.css. */
export type PhaseKey = 'command' | 'movement' | 'shooting' | 'charge' | 'fight' | 'any';
export const PHASE_ORDER: PhaseKey[] = ['command', 'movement', 'shooting', 'charge', 'fight', 'any'];
export const PHASE_LABEL: Record<PhaseKey, string> = { command: 'Command', movement: 'Movement', shooting: 'Shooting', charge: 'Charge', fight: 'Fight', any: 'Any phase' };

const PHASE_WORDS: [PhaseKey, RegExp][] = [
  ['command', /\bcommand phase\b|\bbattle-shock step\b|\bstart of (?:your|the) (?:turn|battle round)\b/i],
  ['movement', /\bmovement phase\b|\b(?:normal move|advances?|falls? back|reinforcements step|set up .{0,30}(?:deep strike|reserves))\b/i],
  ['shooting', /\bshooting phase\b|\bselected to shoot\b|\branged attacks?\b/i],
  ['charge', /\bcharge phase\b|\bcharge (?:roll|move)\b|\bdeclares? a charge\b|\bmakes? a charge\b/i],
  ['fight', /\bfight phase\b|\bselected to fight\b|\bmelee attacks?\b|\bpiles? in\b|\bconsolidat/i],
];

/** Phases a rule belongs to: from a stratagem's phase field when it has one, else from words in its text. */
export function phasesOf(phase?: string, text?: string): PhaseKey[] {
  if (phase) {
    if (/any phase/i.test(phase)) return ['any'];
    const got = PHASE_ORDER.filter((k) => k !== 'any' && new RegExp(`\\b${k}\\b`, 'i').test(phase));
    if (got.length) return got;
  }
  if (!text) return [];
  const when = /WHEN:\s*([^\n]*?)(?=\s*TARGET:|\n|$)/i.exec(text)?.[1];
  const src = when ?? text;
  if (/\bany phase\b/i.test(src)) return ['any'];
  return PHASE_WORDS.filter(([, re]) => re.test(src)).map(([k]) => k);
}

/** "WHEN: … TARGET: … EFFECT: … RESTRICTIONS: …" split into rows; text without the headings is one plain row. */
export function stratRows(text: string): { label: string; text: string }[] {
  const parts = text.split(/\b(WHEN|TARGET|EFFECT|RESTRICTIONS?):\s*/);
  if (parts.length < 3) return [{ label: '', text: text.trim() }];
  const rows: { label: string; text: string }[] = [];
  if (parts[0].trim()) rows.push({ label: '', text: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) rows.push({ label: parts[i], text: (parts[i + 1] ?? '').trim() });
  return rows;
}

const typeOf = (t?: string) => {
  const m = /(Battle Tactic|Strategic Ploy|Epic Deed|Wargear)/i.exec(t ?? '');
  return m ? m[1] : t?.replace(/^.*–\s*/, '').replace(/\s*Stratagem$/i, '') || '';
};
const typeKey = (t: string) => t.toLowerCase().replace(/\s+/g, '-');
const turnKey = (t?: string) => (/opponent/i.test(t ?? '') ? 'theirs' : /your/i.test(t ?? '') ? 'yours' : 'either');
const turnLabel = (t?: string) => ({ theirs: "Opponent's turn", yours: 'Your turn', either: 'Either turn' })[turnKey(t)];

export function PhaseChips({ phases }: { phases: PhaseKey[] }) {
  if (!phases.length) return <span className="ph-chip ph-passive">Always on</span>;
  return <>{phases.map((p) => <span key={p} className={`ph-chip ph-${p}`}>{PHASE_LABEL[p]}</span>)}</>;
}

/** The WHEN / TARGET / EFFECT table of one stratagem. */
export function StratRows({ text, names }: { text: string; names?: string[] }) {
  return (
    <div className="rt-rows">
      {stratRows(text).map((r, i) => (
        <div key={i} className={`rt-row ${r.label ? `rt-${r.label.toLowerCase().replace(/s$/, '')}` : ''}`}>
          {r.label && <span className="rt-label">{r.label}</span>}
          <span className="rt-text"><Em text={r.text} names={names} /></span>
        </div>
      ))}
    </div>
  );
}

export interface StratLike { id?: string; name: string; cp: number; type?: string; turn?: string; phase?: string; text: string; when?: string }

/** Every stratagem as a colour-coded row, filterable by phase and listed in phase order. */
export function StratTable({ strats, names, source }: { strats: StratLike[]; names?: string[]; source?: (s: StratLike) => string }) {
  const [only, setOnly] = useState<PhaseKey | null>(null);
  const rows = strats.map((st) => ({ st, ph: phasesOf(st.phase, st.text || st.when) }));
  const first = (ph: PhaseKey[]) => (ph.length ? PHASE_ORDER.indexOf(ph[0]) : PHASE_ORDER.length);
  const shown = rows.filter((r) => !only || r.ph.includes(only)).sort((a, b) => first(a.ph) - first(b.ph));
  const present = PHASE_ORDER.filter((p) => rows.some((r) => r.ph.includes(p)));
  return (
    <div className="rt-table">
      {present.length > 1 && (
        <div className="rt-filter">
          <button type="button" className={!only ? 'on' : ''} onClick={() => setOnly(null)}>All {rows.length}</button>
          {present.map((p) => (
            <button key={p} type="button" className={`ph-chip ph-${p} ${only === p ? 'on' : only ? 'dim' : ''}`} onClick={() => setOnly(only === p ? null : p)}>
              {PHASE_LABEL[p]} {rows.filter((r) => r.ph.includes(p)).length}
            </button>
          ))}
        </div>
      )}
      {shown.map(({ st, ph }) => {
        const type = typeOf(st.type);
        return (
          <div key={(st.id ?? '') + st.name} className={`rt-card ph-edge-${ph[0] ?? 'passive'}`}>
            <div className="rt-head">
              <b className="rt-name">{st.name}</b>
              <span className="rt-cp">{st.cp}CP</span>
            </div>
            <div className="rt-meta">
              <PhaseChips phases={ph} />
              {st.turn && <span className={`turn-chip turn-${turnKey(st.turn)}`}>{turnLabel(st.turn)}</span>}
              {type && <span className={`type-chip type-${typeKey(type)}`}>{type}</span>}
              {source && <span className="rt-src">{source(st)}</span>}
            </div>
            <StratRows text={st.when && !/WHEN:/i.test(st.text) ? `WHEN: ${st.when}\nEFFECT: ${st.text}` : st.text} names={names} />
          </div>
        );
      })}
    </div>
  );
}

/** Enhancements: who can take it, the points, when it matters, and what it gives. */
export function EnhTable({ enh, names }: { enh: { name: string; pts: number; text: string }[]; names?: string[] }) {
  return (
    <div className="rt-table">
      {enh.map((e) => {
        const m = /^([^.\n]*?\bonly)\.\s*/i.exec(e.text);
        const ph = phasesOf(undefined, e.text);
        return (
          <div key={e.name} className={`rt-card ph-edge-${ph[0] ?? 'passive'}`}>
            <div className="rt-head">
              <b className="rt-name">{e.name}</b>
              <span className="rt-cp">{e.pts} pts</span>
            </div>
            <div className="rt-meta">
              {m && <span className="who-chip">{m[1]}</span>}
              <PhaseChips phases={ph} />
            </div>
            <div className="rt-rows">
              <div className="rt-row rt-effect"><span className="rt-label">EFFECT</span><span className="rt-text"><Em text={m ? e.text.slice(m[0].length) : e.text} names={names} /></span></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Detachment and army rules with the phases they touch. */
export function RuleCards({ rules, names, source }: { rules: { name: string; text: string }[]; names?: string[]; source?: string }) {
  return (
    <div className="rt-table">
      {rules.map((r) => {
        const ph = phasesOf(undefined, r.text);
        return (
          <div key={r.name} className={`rt-card ph-edge-${ph[0] ?? 'passive'}`}>
            <div className="rt-head"><b className="rt-name">{r.name}</b>{source && <span className="rt-src">{source}</span>}</div>
            <div className="rt-meta"><PhaseChips phases={ph} /></div>
            <div className="rt-rows"><div className="rt-row"><span className="rt-text"><Em text={r.text} names={names} /></span></div></div>
          </div>
        );
      })}
    </div>
  );
}
