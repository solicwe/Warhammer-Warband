import { useEffect, useMemo, useState } from 'react';
import { hasFactionRules } from '../rules-engine/effects';
import { addonLines, supportIn, attachOptions, buildUnits, canLeaderAttach, CHAOS_MARKS, markable, chapterRules, defaultWargear, dupTaxes, embarkCheck, extremisPoints, forChapter, enhancementFits, enhancementOptions, listPoints, newUid, optPerItem, optRequires, optRequiresNot, parseTransport, pointsOptions, splitRuleOf, syncList, syncWargear, transportLoads, unitPoints, validateList, wargearMax, wargearSummary, wkey } from '../engine/army';
import { RuleText } from './RuleText';
import { ALLIES, detachmentAllyOf } from '../engine/allies';
import { Em } from './Em';
import { dispositionById, dispositionId, RULES } from '../engine/config';
import type { ArmyList, ArmyUnitEntry, DatasheetData, FactionData, SubfactionData, WargearOption, WargearPick } from '../engine/types';
import { Icon } from './Icon';
import { loadFaction, loadIndex, type FactionIndex } from './data';
import { listDisposition, listDispositionOptions } from '../engine/game';
import { DET_RULES } from '../rules-engine/detachments';
import { armyColor, dsColor, DatasheetView } from './Sheet';
import { datasheetVariants } from './loadout';
import { tokenKind } from './Tokens';
import { getPortrait, setPortrait, usePortraitsVersion } from './portraits';

interface Props {
  list: ArmyList;
  onChange: (l: ArmyList) => void;
  onDone: () => void;
  /** a brand-new army: open on the faction chooser */
  startPicker?: boolean;
}

export type Section = 'epic_characters' | 'characters' | 'battleline' | 'others' | 'transports' | 'allies';
export const SECTIONS: { id: Section; title: string }[] = [
  { id: 'epic_characters', title: 'Epic Characters' },
  { id: 'characters', title: 'Characters' },
  { id: 'battleline', title: 'Battleline' },
  { id: 'others', title: 'Others' },
  { id: 'transports', title: 'Dedicated Transports' },
  { id: 'allies', title: 'Allied Units' },
];

/** Units listed under Others although they carry the CHARACTER keyword (bodyguard-style Epic Heroes). */
const OTHERS = new Set(['Victrix Honour Guard']);

export function sectionOf(d: DatasheetData | undefined, factionId?: string): Section {
  if (d?.ally || (d && detachmentAllyOf(factionId, d))) return 'allies';
  if (!d || OTHERS.has(d.name)) return 'others';
  if (d.keywords.includes('EPIC HERO') || d.role === 'Epic Hero') return 'epic_characters';
  if (d.keywords.includes('CHARACTER') || /Character/.test(d.role)) return 'characters';
  if (d.keywords.includes('BATTLELINE') || d.role === 'Battleline') return 'battleline';
  if (d.role === 'Dedicated Transports' || d.keywords.includes('DEDICATED TRANSPORT')) return 'transports';
  return 'others';
}

/** Groups of the add-unit list, in the order they show. */
export const KINDS = ['Epic Hero', 'Character', 'Infantry', 'Fast Infantry', 'Heavy Infantry', 'Mounted', 'Walker', 'Vehicle', 'Aircraft', 'Other'] as const;
export function unitKind(d: DatasheetData): (typeof KINDS)[number] {
  const k = (w: string) => d.keywords.includes(w);
  if (k('EPIC HERO')) return 'Epic Hero';
  if (k('CHARACTER')) return 'Character';
  if (k('AIRCRAFT')) return 'Aircraft';
  if (k('WALKER')) return 'Walker';
  if (k('VEHICLE')) return 'Vehicle';
  if (k('MOUNTED')) return 'Mounted';
  if (k('INFANTRY')) return k('GRAVIS') || k('TERMINATOR') ? 'Heavy Infantry' : k('JUMP PACK') || k('FLY') ? 'Fast Infantry' : 'Infantry';
  return 'Other';
}

/** Original faction emblems (not official marks). */
export const titleCase = (k: string) => k.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

export const emblemKey = (factionId: string, sub?: string) => `emblem:${factionId}:${sub ?? ''}`;

export function Emblem({ factionId, color, sub }: { factionId: string; color?: string; sub?: string }) {
  usePortraitsVersion();
  // a picture uploaded for this army (its chapter first, then the whole faction), kept on the site for everyone
  const img = getPortrait(emblemKey(factionId, sub)) ?? getPortrait(emblemKey(factionId));
  if (img) return <img className="ab-emblem ab-emblem-img" src={img} alt="" />;
  return (
    <svg className="ab-emblem" viewBox="0 0 64 64" aria-hidden="true">
      <circle className="emb-ring" cx="32" cy="32" r="30" strokeWidth="3" />
      {factionId === 'ORK' ? (
        <g fill="#8fc04a" stroke="#0d1a05" strokeWidth="2" strokeLinejoin="round">
          <path d="M14 26 L22 18 L28 24 L32 14 L36 24 L42 18 L50 26 L46 44 L32 52 L18 44 Z" />
          <path d="M22 32 L29 35 L22 38 Z M42 32 L35 35 L42 38 Z" fill="#c62828" />
          <path d="M24 44 L26 40 L28 44 L30 40 L32 44 L34 40 L36 44 L38 40 L40 44" fill="none" stroke="#f3f3f3" />
        </g>
      ) : factionId === 'SM' ? (
        <g>
          <path d="M32 12 L48 18 L46 38 Q44 48 32 54 Q20 48 18 38 L16 18 Z" fill={color ?? '#1f4a8f'} stroke="#d9b44a" strokeWidth="2.5" />
          <path d="M32 20 L40 34 L35 34 L35 46 L29 46 L29 34 L24 34 Z" fill="#d9b44a" />
        </g>
      ) : factionId === 'TS' ? (
        <g>
          <circle cx="32" cy="32" r="20" fill="#1d6f86" stroke="#d9b44a" strokeWidth="2.5" />
          <path d="M14 34 Q32 18 50 34 Q32 46 14 34 Z" fill="#0e3b48" stroke="#d9b44a" strokeWidth="2" />
          <circle cx="32" cy="33" r="6" fill="#d9b44a" /><circle cx="32" cy="33" r="2.5" fill="#0e3b48" />
          <path d="M32 12 V18 M22 15 L25 20 M42 15 L39 20" stroke="#d9b44a" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      ) : factionId === 'LoV' ? (
        <g fill="#c07a2a" stroke="#2a1805" strokeWidth="2" strokeLinejoin="round">
          <path d="M16 20 L32 14 L48 20 L44 34 L32 40 L20 34 Z" fill="#c07a2a" />
          <path d="M24 24 L32 20 L40 24 L38 32 L32 35 L26 32 Z" fill="#ffd700" />
          <path d="M32 40 L32 50 M26 48 L38 48" stroke="#ffd700" strokeWidth="2.5" />
        </g>
      ) : factionId === 'AdM' ? (
        <g fill="#c0392b" stroke="#1a0a05" strokeWidth="2" strokeLinejoin="round">
          <circle cx="32" cy="32" r="16" fill="#1a1a1a" stroke="#d9b44a" strokeWidth="2" />
          <path d="M32 10 L35 14 L42 12 L43 17 L49 18 L48 23 L54 26 L51 31 L55 36 L50 40 L52 45 L46 48 L46 53 L40 54 L38 59 L32 58 L26 59 L24 54 L18 53 L18 48 L12 45 L14 40 L9 36 L13 31 L10 26 L16 23 L15 18 L21 17 L22 12 L29 14 Z" fill="#b82010" stroke="#f39c12" strokeWidth="1.5" />
          <circle cx="32" cy="32" r="7" fill="#ffffff" />
          <path d="M32 25 V39 M25 32 H39" stroke="#1a1a1a" strokeWidth="2" />
        </g>
      ) : factionId === 'DRU' ? (
        <g fill="#113a35" stroke="#041210" strokeWidth="2" strokeLinejoin="round">
          <path d="M32 10 L44 26 L38 28 L48 44 L32 54 L16 44 L26 28 L20 26 Z" fill="#1b524b" />
          <path d="M32 18 L36 32 L32 46 L28 32 Z" fill="#2dd4bf" />
          <circle cx="32" cy="32" r="3" fill="#ffffff" />
        </g>
      ) : factionId === 'CD' ? (
        <g fill="#991b1b" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round">
          <circle cx="32" cy="32" r="8" fill="#450a0a" stroke="#f59e0b" strokeWidth="2" />
          <path d="M32 8 L35 18 L32 16 L29 18 Z M32 56 L35 46 L32 48 L29 46 Z M8 32 L18 35 L16 32 L18 29 Z M56 32 L46 35 L48 32 L46 29 Z M15 15 L25 21 L23 19 L21 25 Z M49 15 L43 25 L41 23 L47 21 Z M15 49 L21 39 L23 41 L17 43 Z M49 49 L39 43 L41 41 L43 47 Z" fill="#ef4444" />
          <path d="M32 16 V48 M16 32 H48 M21 21 L43 43 M21 43 L43 21" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
          <circle cx="32" cy="32" r="3" fill="#fef08a" />
        </g>
      ) : factionId === 'GC' ? (
        <g fill="#581c87" stroke="#c084fc" strokeWidth="2" strokeLinejoin="round">
          <circle cx="32" cy="32" r="14" fill="#3b0764" stroke="#c084fc" strokeWidth="2" />
          <path d="M32 14 C42 14 48 24 46 36 C44 46 34 50 32 50 C30 50 20 46 18 36 C16 24 22 14 32 14 Z" fill="none" stroke="#e9d5ff" strokeWidth="2.5" />
          <path d="M32 18 C38 22 40 30 38 38 C36 44 32 46 32 46 C32 46 28 44 26 38 C24 30 26 22 32 18 Z" fill="#a855f7" />
          <circle cx="32" cy="28" r="3" fill="#fbcfe8" />
          <path d="M22 24 L14 18 M42 24 L50 18 M20 36 L12 38 M44 36 L52 38" stroke="#c084fc" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      ) : factionId === 'NEC' ? (
        <g fill="#052e16" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round">
          <circle cx="32" cy="22" r="8" fill="#14532d" stroke="#4ade80" strokeWidth="2" />
          <path d="M32 30 V52 M24 38 H40 M26 52 H38" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" />
          <path d="M22 22 L14 30 M42 22 L50 30" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
          <circle cx="32" cy="22" r="3" fill="#86efac" />
        </g>
      ) : factionId === 'GK' ? (
        <g fill="#1e293b" stroke="#38bdf8" strokeWidth="2" strokeLinejoin="round">
          <path d="M32 10 L46 16 L44 38 Q42 48 32 54 Q22 48 20 38 L18 16 Z" fill="#0f172a" stroke="#94a3b8" strokeWidth="2" />
          <path d="M32 16 V46 M24 22 H40 M30 46 H34" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="32" cy="16" r="2.5" fill="#e0f2fe" />
        </g>
      ) : (
        <g fill="none" stroke="#b0b0b0" strokeWidth="3"><circle cx="32" cy="32" r="12" /><path d="M32 12 V20 M32 44 V52 M12 32 H20 M44 32 H52" /></g>
      )}
    </svg>
  );
}

/** Wide picture block for a unit row: the user's photo, or the token art. */
export function UnitArt({ sheet }: { sheet?: DatasheetData }) {
  usePortraitsVersion();
  const photo = sheet ? getPortrait(sheet.name) : undefined;
  const kind = sheet ? tokenKind(sheet.keywords, sheet.factionKeywords) : 'generic';
  return (
    <div className={`ab-art k-${kind}`}>
      {photo ? <img src={photo} alt="" /> : <svg viewBox="0 0 100 100" aria-hidden="true"><use href={`#tok-${kind}`} x="18" y="14" width="64" height="72" /></svg>}
    </div>
  );
}

/** "2× Fragstorm grenade launcher + Storm shield" */
const itemsLabel = (items: string[]) => [...new Set(items)].map((n) => { const k = items.filter((x) => x === n).length; return k > 1 ? `${k}× ${n}` : n; }).join(' + ');

function scopeLabel(o: WargearOption, max: number) {
  const perIt = optPerItem(o);
  if (perIt) return `1 per ${perIt} (max ${max})`;
  if (o.stack) return `up to ${max}`;
  if (o.scope === 'all') return 'whole unit';
  if (o.scope === 'perN') return `${max} per ${o.per} models`;
  if (o.scope === 'any') return `any number (${max})`;
  if (o.scope === 'upTo' && max > 1) return `up to ${max} models`;
  return '';
}

/** Wargear choices of one list entry: swaps, extra weapons, "pick two from the list", add-on models. */
export function WargearEditor({ sheet, u, onChange, scrapMode = false }: { sheet: DatasheetData; u: ArmyUnitEntry; onChange: (patch: Partial<ArmyUnitEntry>) => void; scrapMode?: boolean }) {
  const opts = sheet.wargearOptions ?? [];
  const addons = addonLines(sheet);
  if (!opts.length && !addons.length) return null;
  const picks = u.wargear ?? defaultWargear(sheet, u).wargear ?? [];
  const cost = (items: string[]) => items.reduce((a, n) => a + (sheet.wargearCosts?.find((c) => wkey(c.name) === wkey(n))?.pts ?? 0), 0);
  // what a swap changes per model: what it gains minus what it gives up (claws for hammer + shield: −5)
  const costTag = (items: string[], instead: string[] = []) => {
    const c = cost(items) - cost(instead);
    if (!c) return null;
    const tag = scrapMode ? (c > 0 ? `+${c} Scrap` : `−${-c} Scrap`) : (c > 0 ? `+${c}` : `−${-c}`);
    return <span className={`wg-cost ${c < 0 ? 'less' : ''}`}>{tag}/model</span>;
  };
  const put = (opt: number, next: WargearPick[]) => onChange({ wargear: [...picks.filter((p) => p.opt !== opt), ...next] });
  const single = sheet.models.length === 1 && (sheet.composition.length <= 1);
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span>Wargear {sheet.wargearCosts?.some((c) => !addons.some((a) => a.name === c.name)) ? <span className="tiny muted">· {scrapMode ? 'some weapons cost Scrap (shown as +Scrap each)' : 'some weapons cost points (shown as +pts each)'}</span> : null}</span>
      </div>
      {opts.map((o, i) => {
        const max = wargearMax(sheet, o, u.models, u.addons, picks);
        const mine = picks.filter((p) => p.opt === i);
        const used = mine.reduce((a, p) => a + p.count, 0);
        const who = o.who !== '*' && !single ? `${o.who}: ` : '';
        const head = `${who}${o.replace.length ? `${itemsLabel(o.replace)} →` : 'Add'}`;
        if (max <= 0) {
          const perIt = optPerItem(o);
          const req = optRequires(o);
          const notReq = optRequiresNot(o);
          const reqItem = perIt ?? req[0];
          const reason = reqItem
            ? `requires ${reqItem}`
            : notReq.length
            ? `unavailable with ${notReq.join('/')}`
            : o.minModels
            ? `needs ${o.minModels}+ models`
            : 'not available with current loadout';
          return (
            <div key={i} className="wg-opt off">
              <div className="wg-head">{head}</div>
              <div className="tiny muted">{reason}</div>
            </div>
          );
        }
        const pickSel = mine.find((p) => p.choice < 0);
        const pickDefault = (): string[] => (o.pickFrom ?? []).slice(0, o.pick ?? 2);
        const radio = (max === 1 && o.scope !== 'any') || o.scope === 'all';
        return (
          <div key={i} className="wg-opt">
            <div className="wg-head">{head} <span className="tiny muted">{scopeLabel(o, max)}</span></div>
            {radio ? (
              <div className="wg-chips">
                <button type="button" className={!mine.length ? 'on' : ''} onClick={() => put(i, [])}>{o.replace.length ? 'Keep' : 'None'}</button>
                {o.choices.map((c, ci) => {
                  const on = mine.some((p) => p.choice === ci);
                  return (
                    <button
                      type="button"
                      key={ci}
                      className={on ? 'on' : ''}
                      onClick={() => put(i, on ? [] : [{ opt: i, choice: ci, count: o.scope === 'all' ? max : 1 }])}
                    >
                      {itemsLabel(c)}{costTag(c, o.replace)}
                    </button>
                  );
                })}
                {o.pick && (
                  <button
                    type="button"
                    className={pickSel ? 'on' : ''}
                    onClick={() => put(i, pickSel ? [] : [{ opt: i, choice: -1, count: 1, picks: pickDefault() }])}
                  >
                    Select {o.pick} from the list
                  </button>
                )}
              </div>
            ) : (
              o.choices.map((c, ci) => {
                const cur = mine.find((p) => p.choice === ci)?.count ?? 0;
                const setN = (n: number) => put(i, [...mine.filter((p) => p.choice !== ci), ...(n > 0 ? [{ opt: i, choice: ci, count: n }] : [])]);
                const onAdd = () => {
                  if (used < max) {
                    setN(cur + 1);
                  } else if (max > 0) {
                    const other = mine.find((p) => p.choice !== ci && p.count > 0);
                    if (other) {
                      const nextMine = mine.map((p) => {
                        if (p.choice === other.choice) return { ...p, count: p.count - 1 };
                        if (p.choice === ci) return { ...p, count: p.count + 1 };
                        return p;
                      }).filter((p) => p.count > 0);
                      if (!mine.some((p) => p.choice === ci)) {
                        nextMine.push({ opt: i, choice: ci, count: 1 });
                      }
                      put(i, nextMine);
                    }
                  }
                };
                const canAdd = used < max || (max > 0 && cur < max && mine.some((p) => p.choice !== ci && p.count > 0));
                return (
                  <div key={ci} className="wg-step">
                    <span className="grow">{itemsLabel(c)}{costTag(c, o.replace)}</span>
                    <button type="button" aria-label={`Remove ${itemsLabel(c)}`} disabled={cur <= 0} onClick={() => setN(cur - 1)}>−</button>
                    <b>{cur}</b>
                    <button type="button" aria-label={`Add ${itemsLabel(c)}`} disabled={!canAdd} onClick={onAdd}>+</button>
                  </div>
                );
              })
            )}
            {pickSel && o.pickFrom && (
              <div className="wg-picks">
                {Array.from({ length: o.pick ?? 2 }, (_, k) => (
                  <select key={k} value={pickSel.picks?.[k] ?? ''} aria-label={`Weapon ${k + 1}`} onChange={(e) => {
                    const next = [...(pickSel.picks ?? pickDefault())];
                    next[k] = e.target.value;
                    put(i, [{ ...pickSel, picks: next }]);
                  }}>
                    {o.pickFrom!.map((n) => <option key={n} value={n}>{n}{cost([n]) ? ` (+${cost([n])})` : ''}</option>)}
                  </select>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {addons.map((a) => {
        const on = (u.addons ?? []).includes(a.name);
        return (
          <div key={a.name} className="wg-opt">
            <div className="wg-head">Additional models</div>
            <div className="wg-chips">
              <button type="button" className={!on ? 'on' : ''} onClick={() => onChange({ addons: (u.addons ?? []).filter((x) => x !== a.name) })}>None</button>
              <button type="button" className={on ? 'on' : ''} onClick={() => onChange({ addons: [...(u.addons ?? []).filter((x) => x !== a.name), a.name] })}>+1 {a.name}<span className="wg-cost">+{a.pts}</span></button>
            </div>
          </div>
        );
      })}
      <details>
        <summary className="tiny">Wargear options (datasheet text)</summary>
        {sheet.options.map((t, k) => <div key={k} className="tiny">• {t}</div>)}
      </details>
    </div>
  );
}

export function ArmyBuilder({ list, onChange, onDone, startPicker }: Props) {
  const [index, setIndex] = useState<FactionIndex | null>(null);
  const [rawFaction, setFaction] = useState<FactionData | null>(null);
  const faction = useMemo(() => rawFaction && forChapter(rawFaction, list.subfaction), [rawFaction, list.subfaction]);
  const [tab, setTab] = useState<'list' | 'detachment'>('list');
  const [adding, setAdding] = useState<Section | null>(null);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<string | null>(null); // uid of the unit whose datasheet + settings panel is open
  const [detPicker, setDetPicker] = useState(false);
  const [openDet, setOpenDet] = useState<string | null>(null);
  const [openSecs, setOpenSecs] = useState<string[]>([]);
  const [addSize, setAddSize] = useState<string | null>(null); // the datasheet whose unit size is being picked to add it
  const [pop, setPop] = useState<{ uid: string; x: number; y: number; mode?: 'squad' | 'leader' | 'support' | 'embark' | 'size' } | null>(null); // the ⋮ quick menu
  const [picker, setPicker] = useState<{ factionId: string | null } | null>(startPicker ? { factionId: null } : null); // faction → sub-faction chooser
  const [view, setView] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null); // a datasheet opened from the ⋮ pickers (its abilities)
  const [resetArmed, setResetArmed] = useState(false);
  const [panelCollapse, setPanelCollapse] = useState<{ [uid: string]: { sheet?: boolean; enh?: boolean; wargear?: boolean } }>({});
  const [sheetLimit, setSheetLimit] = useState(30);
  useEffect(() => setView(null), [adding]); // the datasheet opened under a row of the add list
  useEffect(() => setSheetLimit(30), [adding, q]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { loadIndex().then(setIndex).catch(() => setNote('Could not load the faction list')); }, []);
  useEffect(() => { setFaction(null); loadFaction(list.factionId).then(setFaction).catch(() => setNote('Could not load the faction data')); }, [list.factionId]);
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNote(null), 2400); return () => window.clearTimeout(t); }, [note]);
  useEffect(() => {
    if (!faction || faction.id !== list.factionId) return;
    const synced = syncList(list, faction);
    if (synced !== list) onChange(synced);
  }, [faction, list, onChange]);

  const size = RULES.battleSizes.find((b) => b.id === list.battleSize) ?? RULES.battleSizes[0];
  const errors = useMemo(() => (faction ? validateList(list, faction, size) : []), [list, faction, size]);
  const pts = listPoints(list, faction ?? undefined);
  const taxes = useMemo(() => (faction ? dupTaxes(list, faction) : new Map<string, number>()), [list, faction]);
  const ptsOf = (u: ArmyUnitEntry) => unitPoints(u) + (taxes.get(u.uid) ?? 0) + (faction ? extremisPoints(u, list, faction) : 0);
  const sheetOf = (name: string) => faction?.datasheets.find((d) => d.name === name);
  const factionName = index?.factions.find((f) => f.id === list.factionId)?.name ?? faction?.name ?? list.factionId;
  const subs = faction?.subfactions;
  const sub: SubfactionData | undefined = subs?.options.find((o) => o.keyword === list.subfaction);
  const allowed = (x: { subfaction?: string }) => !x.subfaction || x.subfaction === list.subfaction;
  // Mechanicus Allies / Wretched Thralls: listed only once their detachment is chosen
  const detAlly = (d: DatasheetData) => detachmentAllyOf(list.factionId, d);
  const offered = (d: DatasheetData) => { const a = detAlly(d); return allowed(d) && (!a || list.detachments.includes(a.det)); };
  const subTag = (k?: string) => (k ? subs?.options.find((o) => o.keyword === k)?.name ?? titleCase(k) : '');

  /** Switch faction (clears the list) or only the sub-faction (keeps what is still legal). */
  const choose = (factionId: string, subfaction?: string) => {
    setPicker(null);
    if (factionId !== list.factionId) {
      // a brand-new army starts empty, named after its faction
      const named = startPicker && (!list.name || list.name === 'New army') ? index?.factions.find((f) => f.id === factionId)?.name ?? list.name : list.name;
      onChange({ ...list, name: named, factionId, subfaction, detachments: [], units: [] });
      return;
    }
    if (!faction) return;
    const ok = (x: { subfaction?: string }) => !x.subfaction || x.subfaction === subfaction;
    const units = list.units.filter((u) => ok(faction.datasheets.find((d) => d.name === u.datasheet) ?? {}));
    const kept = new Set(units.map((u) => u.uid));
    const detachments = list.detachments.filter((n) => ok(faction.detachments.find((d) => d.name === n) ?? {}));
    const dropped = list.units.length - units.length + list.detachments.length - detachments.length;
    onChange({ ...list, subfaction, detachments, units: units.map((u) => (u.attachTo && !kept.has(u.attachTo) ? { ...u, attachTo: undefined } : u)) });
    if (dropped) setNote(`Removed ${dropped} unit(s)/detachment(s) of another ${subs?.label ?? 'sub-faction'}`);
  };

  const set = (patch: Partial<ArmyList>) => onChange({ ...list, ...patch });
  /** Change the detachments; an enhancement that none of them has any more comes off its unit. */
  const setDets = (detachments: string[]) => {
    const has = (n: string) => !!faction?.detachments.some((d) => detachments.includes(d.name) && d.enhancements.some((e) => e.name === n));
    set({ detachments, units: list.units.map((u) => (u.enhancement && !has(u.enhancement) ? { ...u, enhancement: undefined, enhancementPts: undefined } : u)) });
  };
  /** The player's own picture for the emblem, shrunk to a small square. */
  const pickEmblem = async (f: File) => {
    const url = URL.createObjectURL(f);
    try {
      const im = new Image();
      await new Promise((ok, bad) => { im.onload = ok; im.onerror = bad; im.src = url; });
      const n = 160, c = document.createElement('canvas');
      c.width = n; c.height = n;
      const k = Math.max(n / im.width, n / im.height);
      c.getContext('2d')!.drawImage(im, (n - im.width * k) / 2, (n - im.height * k) / 2, im.width * k, im.height * k);
      const ok = setPortrait(emblemKey(list.factionId, list.subfaction), c.toDataURL('image/png'));
      setNote(ok ? 'Emblem changed (uploaded: everyone with the link sees it)' : 'Could not save the image');
    } catch { setNote('Could not read the image'); } finally { URL.revokeObjectURL(url); }
  };
  /** Update one entry; wargear choices are re-checked for the new size and their points recomputed. */
  const setUnit = (uid: string, patch: Partial<ArmyUnitEntry>) => set({ units: list.units.map((x) => {
    if (x.uid !== uid) return x;
    const d = sheetOf(x.datasheet);
    // a new size keeps the best free loadout when the player hadn't changed it (more models, more special weapons)
    const untouched = patch.models !== undefined && patch.models !== x.models
      && JSON.stringify(x.wargear ?? []) === JSON.stringify(defaultWargear(d, { ...x, wargear: undefined }).wargear ?? []);
    const next = { ...x, ...patch };
    return syncWargear(d, untouched ? defaultWargear(d, { ...next, wargear: undefined }) : next);
  }) });
  const removeUnit = (uid: string) => set({ units: list.units.filter((x) => x.uid !== uid).map((x) => (x.attachTo === uid ? { ...x, attachTo: undefined } : x.embarkIn === uid ? { ...x, embarkIn: undefined } : x)) });
  const addUnit = (d: DatasheetData, chosen?: { models: number; pts: number }) => {
    const opt = chosen ?? pointsOptions(d)[0];
    if (!opt) return;
    set({ units: [...list.units, syncWargear(d, defaultWargear(d, { uid: newUid('e'), datasheet: d.name, models: opt.models, pts: opt.pts }))] });
    setNote(`Added ${d.name}`);
  };

  const share = async () => {
    const lines = [
      `${list.name || 'Army list'} — ${factionName}${sub ? ` (${sub.name})` : ''}`,
      `${list.detachments.join(', ') || 'No Detachment'} · ${pts}/${size.points} pts`,
      '',
      ...SECTIONS.flatMap((sec) => {
        const us = list.units.filter((u) => sectionOf(sheetOf(u.datasheet), list.factionId) === sec.id);
        if (!us.length) return [];
        return [`${sec.title.toUpperCase()}`, ...us.map((u) => {
          const wg = wargearSummary(sheetOf(u.datasheet), u);
          return `• ${u.datasheet} (${u.models}) — ${ptsOf(u)} pts${u.warlord ? ' · Warlord' : ''}${u.enhancement ? ` · ${u.enhancement}` : ''}${wg ? `\n   ${wg}` : ''}`;
        }), ''];
      }),
    ].join('\n');
    try {
      if (navigator.share) await navigator.share({ title: list.name || 'Army list', text: lines });
      else { await navigator.clipboard.writeText(lines); setNote('Army list copied'); }
    } catch { /* cancelled */ }
  };


  const unitRow = (u: ArmyUnitEntry, inGroup = false) => {
    const sheet = sheetOf(u.datasheet);
    const leads = u.attachTo ? list.units.find((b) => b.uid === u.attachTo) : undefined;
    const rides = u.embarkIn ? list.units.find((t) => t.uid === u.embarkIn) : undefined;
    const load = faction ? transportLoads(list, faction).find((t) => t.uid === u.uid) : undefined;
    const carried = load?.riders.map((r) => list.units.find((x) => x.uid === r)?.datasheet).filter(Boolean) ?? [];
    const line = [
      u.warlord && 'Warlord', leads && !inGroup && `${supportIn(list, sheet) ? 'Support for' : 'Leading'} ${leads.datasheet}`, leads && inGroup && (supportIn(list, sheet) ? 'Support' : 'Leader'), u.split && 'Split in two',
      rides && (inGroup ? 'Embarked' : `Starts embarked in ${rides.datasheet}`),
      load && (carried.length ? `Carrying ${carried.join(', ')} (${load.used}/${load.capacity})` : `Empty (0/${load.capacity})`),
    ].filter(Boolean).join(' · ');
    const wg = wargearSummary(sheet, u);
    const wrong = sheet && !allowed(sheet);
    const row = (
      <div key={u.uid} className={`ab-row ${inGroup ? 'in-group' : ''} ${menu === u.uid ? 'open' : ''}`}>
        <button type="button" className="ab-row-main" onClick={() => setMenu(menu === u.uid ? null : u.uid)}>
          <span className="ab-art-wrap"><UnitArt sheet={sheet} /></span>
          <span className="ab-row-text">
            <span className="ab-name">{u.datasheet} <span className="ab-count">({u.models})</span></span>
            <span className="ab-pts">{ptsOf(u)} pts{taxes.get(u.uid) ? <span className="tiny muted"> (duplicate +{taxes.get(u.uid)})</span> : null}{u.enhancement && <span className="ab-enh"> {u.enhancement}</span>}{sheet?.subfaction && <span className={`ab-chip ${wrong ? 'bad' : ''}`}>{subTag(sheet.subfaction)}</span>}{!sheet && faction && <span className="ab-chip bad">Not in 11th edition</span>}</span>
            {line && <span className="ab-sub">{line}</span>}
            {wg && <span className="ab-sub ab-wg"><Icon name="wargear" size={13} /> {wg}</span>}
          </span>
        </button>
        <button type="button" className="ab-kebab" aria-label={`Options for ${u.datasheet}`} onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPop({ uid: u.uid, x: r.right, y: r.bottom });
        }}><Icon name="more" size={22} /></button>
      </div>
    );
    return menu === u.uid ? [row, unitPanel(u)] : row;
  };

  const listTab = () => (
    <>
      {errors.length > 0 && <div className="ab-errors">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
      {SECTIONS.filter((sec) => sec.id !== 'allies' || faction?.datasheets.some((d) => d.ally || (detAlly(d) && offered(d))) || list.units.some((u) => sectionOf(sheetOf(u.datasheet), list.factionId) === 'allies')).map((sec) => {
        // a unit with its Leader / Support shows as one card, in the section of its (first) character
        const joined = (b: ArmyUnitEntry) => list.units.filter((c) => c.attachTo === b.uid);
        const homeOf = (u: ArmyUnitEntry): string => {
          const body = u.attachTo ? list.units.find((b) => b.uid === u.attachTo) : undefined;
          if (body) return homeOf(body);
          const first = joined(u)[0];
          return sectionOf(sheetOf((first ?? u).datasheet), list.factionId);
        };
        const inRide = (u: ArmyUnitEntry) => !!u.embarkIn && list.units.some((t) => t.uid === u.embarkIn);
        const us = list.units.filter((u) => (!u.attachTo || !list.units.some((b) => b.uid === u.attachTo)) && !inRide(u) && homeOf(u) === sec.id);
        const bySupport = (a: ArmyUnitEntry, b: ArmyUnitEntry) => Number(!!supportIn(list, sheetOf(a.datasheet))) - Number(!!supportIn(list, sheetOf(b.datasheet)));
        // a squad with its characters: Leader, Support, then the squad
        const squadRows = (u: ArmyUnitEntry, inGroup: boolean) => [...joined(u).sort(bySupport).map((c) => unitRow(c, true)), unitRow(u, inGroup || joined(u).length > 0)];
        return (
          <section key={sec.id} className="ab-section">
            <div className="ab-section-head">
              <span>{sec.title}</span>
              <button type="button" className="ab-add" aria-label={`Add ${sec.title}`} onClick={() => { setQ(''); setAdding(sec.id); }}>+</button>
            </div>
            {us.map((u) => {
              // a transport shows the units that start the battle inside it in its own card
              const riders = list.units.filter((r) => r.embarkIn === u.uid && !r.attachTo);
              if (!joined(u).length && !riders.length) return unitRow(u);
              return (
                <div key={u.uid} className="ab-group">
                  {squadRows(u, true)}
                  {riders.map((r) => <div key={`ride-${r.uid}`} className="ab-ride">{squadRows(r, true)}</div>)}
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );

  const toggleSec = (k: string) => setOpenSecs((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));
  /** One collapsible block of the Detachment tab (Detachment Rule, Enhancements …). */
  const dSection = (k: string, title: string, body: React.ReactNode, count?: number) => (
    <div key={k} className="dt-sec">
      <button type="button" className="dt-sec-head" onClick={() => toggleSec(k)}>
        <span className="grow">{title}{count !== undefined && <span className="muted"> ({count})</span>}</span>
        <span className={`dt-chev ${openSecs.includes(k) ? 'up' : ''}`}><Icon name="down" size={18} /></span>
      </button>
      {openSecs.includes(k) && <div className="dt-sec-body">{body}</div>}
    </div>
  );
  const ruleCard = (key: string, name: string, right: string, text: string) => (
    <div key={key} className="dt-card">
      <div className="dt-card-head"><b>{name}</b><span>{right}</span></div>
      <div className="dt-card-text"><Em text={text} names={ruleNames} /></div>
    </div>
  );
  const ruleNames = useMemo(() => (faction ? [...faction.datasheets.map((d) => d.name), ...faction.detachments.flatMap((d) => [...d.stratagems.map((st) => st.name), ...d.enhancements.map((e) => e.name), ...d.rules.map((r) => r.name)]), ...faction.armyRules.map((r) => r.name)] : []), [faction]);
  const chosenDets = faction ? list.detachments.map((n) => faction.detachments.find((d) => d.name === n)).filter((d): d is NonNullable<typeof d> => !!d) : [];
  /** Force Disposition: the detachments may offer more than one — tap one to play it (the mission and map follow it). */
  const dispositionChips = () => {
    if (!faction || !chosenDets.length) return null;
    const opts = listDispositionOptions(list, faction);
    const cur = listDisposition(list, faction);
    if (opts.length < 2) return <span className="ab-disp">Force Disposition: <b>{dispositionById(cur).name}</b></span>;
    return (
      <span className="ab-disp ab-disp-pick"><span className="ab-disp-label">Force Disposition</span>
        {opts.map((d) => (
          <button key={d} type="button" className={`disp-chip ${cur === d ? '' : 'off'}`} style={{ background: dispositionById(d).color }} aria-pressed={cur === d}
            onClick={() => set({ disposition: dispositionById(d).name })}>{dispositionById(d).name}</button>
        ))}
      </span>
    );
  };

  const detachmentTab = () => faction && (
    <>
      <div className="dt-top">
        <label className="dt-emblem" aria-label="Change emblem">
          <Emblem factionId={list.factionId} color={sub?.color} sub={list.subfaction} />
          <span className="dt-emblem-cam"><Icon name="camera" size={14} /></span>
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickEmblem(f); }} />
        </label>
        <div className="grow dt-top-text">
          <input className="ab-title dt-name" aria-label="Army name" value={list.name} placeholder="Army name" onChange={(e) => set({ name: e.target.value })} />
          <button type="button" className="dt-faction linkish" onClick={() => setPicker({ factionId: subs ? list.factionId : null })}>{factionName}{subs ? ` · ${sub?.name ?? `Select ${subs.label}`}` : ''} <Icon name="next" size={14} /></button>
          <div className="dt-det">{chosenDets.map((d) => d.name).join(' + ') || (list.factionId === 'TL' ? 'Towering Example (No Detachment)' : 'No Detachment selected')}</div>
          {chosenDets.length > 0 ? <div className="tiny">{dispositionChips()} {chosenDets.reduce((x, d) => x + d.dp, 0)}/{size.dp} DP</div> : (list.factionId === 'TL' ? <div className="tiny">{dispositionChips()}</div> : null)}
          <div className="tiny muted">{size.name} · {pts}/{size.points} pts</div>
        </div>
        {faction.detachments.length > 0 && <button type="button" className="dt-gear" aria-label="Change Detachment" onClick={() => setDetPicker(true)}><Icon name="gear" size={26} /></button>}
      </div>
      {chosenDets.length > 0 && dSection('rule', 'Detachment Rule', chosenDets.flatMap((d) => d.rules.map((r) => ruleCard(d.name + r.name, r.name, chosenDets.length > 1 ? d.name : '', r.text))))}
      {chosenDets.length > 0 && dSection('enh', 'Enhancements', chosenDets.flatMap((d) => d.enhancements.map((e) => ruleCard(d.name + e.name, e.name, `${e.pts}pts`, e.text))), chosenDets.reduce((a, d) => a + d.enhancements.length, 0))}
      {chosenDets.length > 0 && dSection('strat', 'Stratagems', chosenDets.flatMap((d) => d.stratagems.map((st) => ruleCard(d.name + st.name, st.name, `${st.cp}CP`, st.text))), chosenDets.reduce((a, d) => a + d.stratagems.length, 0))}
      {dSection('core', 'Core Stratagems', RULES.coreStratagems.map((st) => ruleCard(st.id, st.name, `${st.cp}CP`, `${st.when}\n${st.text}`)))}
      {dSection('army', 'Army Rule', chapterRules(faction.armyRules, list.subfaction).map((r) => (
        <div key={r.name} className="dt-card">
          <div className="dt-card-head"><b>{r.name}</b></div>
          <div className="dt-card-text rt-wrap"><RuleText text={r.text} names={ruleNames} /></div>
        </div>
      )))}
      <div className="dt-actions">
      </div>
    </>
  );

  /** The Detachments page: every detachment of the faction, open one to read it, tick one to use it. */
  const detPickerPage = () => {
    if (!detPicker || !faction) return null;
    const dets = faction.detachments.filter((d) => d.forceDisposition && (allowed(d) || list.detachments.includes(d.name)))
      .sort((a, b) => Number(!!b.subfaction) - Number(!!a.subfaction));
    // Detachment Points: picks add up to the battle size's DP (one detachment alone may cost more)
    const dpOf = (n: string) => faction.detachments.find((x) => x.name === n)?.dp ?? 0;
    const used = list.detachments.reduce((a, n) => a + dpOf(n), 0);
    const fits = (d: { dp: number }) => !list.detachments.length || used + d.dp <= size.dp;
    return (
      <div className="tray-backdrop" onClick={() => setDetPicker(false)}>
        <div className="tray dt-picker" onClick={(e) => e.stopPropagation()}>
          <div className="row">
            <div className="sheet-title grow">Army Detachment</div>
            <button className="btn small ghost" onClick={() => setDetPicker(false)}>Close</button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="ab-pick-btn grow" onClick={() => setPicker({ factionId: subs ? list.factionId : null })}>
              <span className="grow">{factionName}{subs ? ` · ${sub?.name ?? `No ${subs.label}`}` : ''}</span><span className="muted">Change <Icon name="next" size={14} /></span>
            </button>
            <select value={list.battleSize} onChange={(e) => set({ battleSize: e.target.value })}>
              {RULES.battleSizes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.points} pts)</option>)}
            </select>
          </div>
          <div className="dt-dp-bar">Detachment Points: <b>{used}/{size.dp} DP</b> · pick as many as fit the DP{list.detachments.length > 1 && <> · the army's Force Disposition is the one marked <Icon name="leader" size={14} /> (tap a disposition to change it)</>}</div>
          {subs && !sub && <div className="small muted">No {subs.label} selected: only generic Detachments are shown <button type="button" className="linkish" onClick={() => setPicker({ factionId: list.factionId })}>Select {subs.label}</button></div>}
          {dets.map((d) => {
            const on = list.detachments.includes(d.name);
            const blocked = !on && !fits(d);
            const primary = on && list.detachments[0] === d.name;
            const open = openDet === d.name;
            const sec = (k: string) => openSecs.includes(`${d.name}:${k}`);
            return (
              <div key={d.id} className={`dt-item ${on ? 'on' : ''} ${blocked ? 'blocked' : ''}`}>
                <div className="dt-item-head">
                  <div className="grow">
                    <button type="button" className="dt-item-name" onClick={() => setOpenDet(open ? null : d.name)}>
                      {d.name}{d.subfaction && <span className={`ab-chip ${allowed(d) ? '' : 'bad'}`}>{subTag(d.subfaction)}</span>}
                    </button>
                    <button type="button" className={`dt-disp ${primary && list.detachments.length > 1 ? 'primary' : ''}`} style={{ background: dispositionById(dispositionId(d.forceDisposition) ?? 'take-and-hold').color, color: '#fff' }} disabled={!on || primary || list.detachments.length < 2}
                      onClick={() => setDets([d.name, ...list.detachments.filter((n) => n !== d.name)])}>
                      {primary && list.detachments.length > 1 && <Icon name="leader" size={13} />}{d.forceDisposition}{blocked ? ` · over the DP (${Math.max(0, size.dp - used)} left): tick to switch to this one instead` : ''}
                    </button>
                  </div>
                  <span className="dt-dp">{d.dp} DP</span>
                  <button type="button" className={`dt-chev ${open ? 'up' : ''}`} aria-label="Details" onClick={() => setOpenDet(open ? null : d.name)}><Icon name="down" size={18} /></button>
                  <button type="button" className={`dt-box ${on ? 'on' : ''}`} aria-label={on ? 'Selected' : 'Select'} onClick={() => setDets(on ? list.detachments.filter((n) => n !== d.name) : blocked ? [d.name] : [...list.detachments, d.name])}>{on && <Icon name="check" size={18} />}</button>
                </div>
                {open && (
                  <div className="dt-item-body">
                    {d.rules.map((r) => (
                      <div key={r.name}><div className="dt-rule-name">{r.name.toUpperCase()}</div><div className="dt-card-text"><Em text={r.text} names={ruleNames} /></div></div>
                    ))}
                    <div className="tiny">Force Disposition: <b>{d.forceDisposition}</b> · <span className={`det-auto ${DET_RULES[d.name]?.auto ?? 'none'}`}>{{ full: 'Fully automated', partial: 'Mostly automated', manual: 'Manual' }[DET_RULES[d.name]?.auto ?? 'manual'] ?? 'Read only'}</span></div>
                    <button type="button" className="dt-sub" onClick={() => toggleSec(`${d.name}:enh`)}>Enhancements ({d.enhancements.length})<span className={`dt-chev ${sec('enh') ? 'up' : ''}`}><Icon name="down" size={16} /></span></button>
                    {sec('enh') && d.enhancements.map((e) => ruleCard(e.name, e.name, `${e.pts}pts`, e.text))}
                    <button type="button" className="dt-sub" onClick={() => toggleSec(`${d.name}:strat`)}>Stratagems ({d.stratagems.length})<span className={`dt-chev ${sec('strat') ? 'up' : ''}`}><Icon name="down" size={16} /></span></button>
                    {sec('strat') && d.stratagems.map((st) => ruleCard(st.name, st.name, `${st.cp}CP`, st.text))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const addSheet = () => {
    if (!adding || !faction) return null;
    const title = SECTIONS.find((x) => x.id === adding)!.title;
    const sheets = faction.datasheets
      .filter((d) => offered(d) && sectionOf(d, list.factionId) === adding && d.name.toLowerCase().includes(q.toLowerCase()) && pointsOptions(d).length)
      .sort((a, b) => (a.allyName ?? '').localeCompare(b.allyName ?? '') || KINDS.indexOf(unitKind(a)) - KINDS.indexOf(unitKind(b)) || Number(!!b.subfaction) - Number(!!a.subfaction) || a.name.localeCompare(b.name));
    const totalSheets = sheets.length;
    const visibleSheets = sheets.slice(0, sheetLimit);
    // the allied list is grouped by the book each unit comes from
    const groupOf = (d: DatasheetData) => (d.ally ? `${d.allyName} · ${unitKind(d)}` : detAlly(d) ? `${detAlly(d)!.rule} · ${unitKind(d)}` : unitKind(d));
    return (
      <div className="tray-backdrop" onClick={() => setAdding(null)}>
        <div className="tray" onClick={(e) => e.stopPropagation()}>
          <div className="row">
            <div className="sheet-title grow">Add {title}</div>
            <button className="btn small ghost" onClick={() => setAdding(null)}>Close</button>
          </div>
          <input placeholder="Search datasheets…" value={q} onChange={(e) => setQ(e.target.value)} />
          {adding === 'allies' && (
            <div className="tiny muted">
              Allowed for this army: {[...[...new Map(faction.datasheets.filter((d) => d.ally).map((d) => [d.ally!, d])).values()].map((d) => `${d.allyName} (${ALLIES.find((a) => a.id === d.ally)?.rule})`),
                ...new Set(faction.datasheets.filter((d) => detAlly(d) && offered(d)).map((d) => `${detAlly(d)!.rule} (${detAlly(d)!.det}, up to 500 pts)`))].join(' · ')}. Allies are never the Warlord.
            </div>
          )}
          <div className="ab-pick">
            {visibleSheets.map((d, i) => {
              const count = list.units.filter((u) => u.datasheet === d.name).length;
              const open = view === d.name;
              const kind = groupOf(d);
              return [
                (i === 0 || groupOf(visibleSheets[i - 1]) !== kind) && <div key={`kind-${kind}`} className="ab-kind">{kind}</div>,
                <div key={d.id} className={`ab-row ${open ? 'open' : ''}`}>
                  <button type="button" className="ab-row-main" onClick={() => setView(open ? null : d.name)}>
                    <UnitArt sheet={d} />
                    <span className="ab-row-text">
                      <span className="ab-name">{d.name}{count ? <span className="ab-count"> ×{count}</span> : null}</span>
                      <span className="ab-pts">{pointsOptions(d).map((o) => `${o.models}: ${o.pts}`).join(' / ')} pts</span>
                      <span className="ab-sub">{d.subfaction && <span className="ab-chip">{subTag(d.subfaction)}</span>}{d.keywords.includes('EPIC HERO') ? 'Epic Hero · ' : ''}{d.role}</span>
                      {(() => { const t = parseTransport(d.transport); return t ? <span className="ab-sub ab-cap"><Icon name="embark" size={13} /> Transport capacity {t.capacity}</span> : null; })()}
                    </span>
                  </button>
                  <button type="button" className="ab-add dark" aria-label={`Add ${d.name}`}
                    onClick={() => (pointsOptions(d).length > 1 ? setAddSize(addSize === d.name ? null : d.name) : addUnit(d))}>+</button>
                </div>,
                // more than one unit size: pick it now
                addSize === d.name && (
                  <div key={`size-${d.id}`} className="ab-add-size">
                    <div className="ab-pop-head">Unit size · {d.name}</div>
                    {pointsOptions(d).map((o) => (
                      <button key={o.models} type="button" className="ab-pop-size" onClick={() => { addUnit(d, o); setAddSize(null); }}>
                        <span className="ab-pop-models">{o.models} {o.models === 1 ? 'model' : 'models'}</span><span className="ab-pop-pts">{o.pts} pts</span><span className="ab-pop-plus">+ Add</span>
                      </button>
                    ))}
                  </div>
                ),
                // the datasheet opens under its row, like in the list
                open && (
                  <div className="ab-inline" key={`peek-${d.id}`}>
                    <div className="ab-inline-body">
                      <DatasheetView sheet={d} factionId={faction.id} />
                      <button type="button" className="ab-moreinfo" onClick={() => setView(null)}>Close <Icon name="down" size={18} /></button>
                    </div>
                  </div>
                ),
              ];
            })}
            {visibleSheets.length < totalSheets && (
              <div style={{ padding: '12px', textAlign: 'center' }}>
                <button type="button" className="btn small" onClick={() => setSheetLimit((c) => c + 30)}>
                  Show more ({totalSheets - visibleSheets.length} remaining)
                </button>
              </div>
            )}
            {!sheets.length && <div className="ab-empty">No datasheets found</div>}
          </div>
        </div>
      </div>
    );
  };

  const unitPanel = (u: ArmyUnitEntry) => {
    if (!faction) return null;
    const sheet = sheetOf(u.datasheet);
    const enh = enhancementOptions(list, faction, u);
    const dsCol = dsColor(faction.id);

    const isSheetOpen = panelCollapse[u.uid]?.sheet !== false;
    const isEnhOpen = panelCollapse[u.uid]?.enh !== false;
    const isWargearOpen = panelCollapse[u.uid]?.wargear !== false;

    const toggleSection = (section: 'sheet' | 'enh' | 'wargear') => {
      setPanelCollapse((prev) => ({
        ...prev,
        [u.uid]: {
          ...prev[u.uid],
          [section]: prev[u.uid]?.[section] !== undefined ? !prev[u.uid]?.[section] : false,
        },
      }));
    };

    return (
      <div className="ab-inline" key={`panel-${u.uid}`} style={{
        ['--accent' as string]: dsCol,
        ['--ds-band' as string]: dsCol,
        ['--accent-soft' as string]: `color-mix(in srgb, ${dsCol} 25%, transparent)`,
      }}>
        <div className="ab-inline-body">
          <div className="ab-collapsible-section">
            <button type="button" className="ab-section-toggle" onClick={() => toggleSection('sheet')}>
              <span className="row gap-2" style={{ alignItems: 'center' }}>
                <Icon name={isSheetOpen ? "down" : "next"} size={16} />
                <span>Datasheet Profile & Rules</span>
              </span>
              <span className="tiny muted">{isSheetOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
            </button>
            {isSheetOpen && sheet && (
              <DatasheetView sheet={sheet} factionId={faction.id} variants={(() => {
                try { return datasheetVariants(sheet, buildUnits({ ...list, units: [{ ...u, attachTo: undefined }] }, faction, 0).flatMap((x) => x.models)); } catch { return undefined; }
              })()} />
            )}
            {isSheetOpen && !sheet && <div className="sheet-title">{u.datasheet}</div>}
          </div>

          <div className="ab-panel-title">Unit settings · <span className="ab-pts">{ptsOf(u)} pts{u.wargearPts ? <span className="tiny muted"> (wargear +{u.wargearPts})</span> : null}</span></div>

          {(enh.length > 0 || u.enhancement) && (
            <div className="ab-collapsible-section field">
              <button type="button" className="ab-section-toggle" onClick={() => toggleSection('enh')}>
                <span className="row gap-2" style={{ alignItems: 'center' }}>
                  <Icon name={isEnhOpen ? "down" : "next"} size={16} />
                  <Icon name="enhancement" size={15} />
                  <span>Enhancement</span>
                  {u.enhancement && <span className="ab-badge-selected">{u.enhancement} (+{u.enhancementPts} pts)</span>}
                </span>
                <span className="tiny muted">{isEnhOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
              </button>
              {isEnhOpen && (
                <div className="enh-list">
                  {u.enhancement && !enh.some((o) => o.name === u.enhancement) && (
                    <button type="button" className="enh-card on" onClick={() => setUnit(u.uid, { enhancement: undefined, enhancementPts: undefined })}>
                      <span className="enh-head"><b>{u.enhancement}</b><span>not in the selected Detachments · tap to remove</span></span>
                    </button>
                  )}
                  {enh.map((o) => {
                    const on = u.enhancement === o.name;
                    const taken = list.units.find((x) => x.uid !== u.uid && x.enhancement === o.name);
                    const fit = sheet ? enhancementFits(o.text, [...sheet.keywords, ...sheet.factionKeywords, sheet.name, ...(u.mark ? [u.mark] : [])]) : null;
                    if (fit && !fit.ok && !on) return <div key={o.detachment + o.name} className="enh-card off"><span className="enh-head"><b>{o.name}</b><span>+{o.pts} pts</span></span><span className="enh-foot">Not allowed: {fit.need} only</span></div>;
                    return (
                      <button key={o.detachment + o.name} type="button" className={`enh-card ${on ? 'on' : ''} ${taken ? 'taken' : ''}`}
                        onClick={() => setUnit(u.uid, on ? { enhancement: undefined, enhancementPts: undefined } : { enhancement: o.name, enhancementPts: o.pts })}>
                        <span className="enh-head"><b>{o.name}</b><span>{on ? <><Icon name="check" size={15} /> Selected</> : `+${o.pts} pts`}</span></span>
                        {o.text && <span className="enh-text"><Em text={o.text} names={ruleNames} /></span>}
                        <span className="enh-foot">{o.detachment}{o.upgrade ? ' · Upgrade' : ''}{taken ? ` · taken by ${taken.datasheet} (one per army)` : ''}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {sheet && sheet.abilities.some((x) => x.name === 'Daemonic Allegiance') && (
            <div className="field"><span>Daemonic Allegiance <span className="tiny muted">the god this Daemon Prince serves (keyword + bonus)</span></span>
              <div className="wg-chips">
                {['NURGLE', 'KHORNE', 'TZEENTCH', 'SLAANESH'].map((k) => {
                  const on = (u.mark ?? 'NURGLE') === k;
                  return <button key={k} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => setUnit(u.uid, { mark: k })}>{on && <Icon name="check" size={16} />}{k.charAt(0) + k.slice(1).toLowerCase()}</button>;
                })}
              </div>
            </div>
          )}

          {sheet && list.detachments.includes('Pactbound Zealots') && markable(sheet) && !sheet.abilities.some((x) => x.name === 'Daemonic Allegiance') && (
            <div className="field"><span>Mark of Chaos <span className="tiny muted">Pactbound Zealots · after a passed Dark Pact</span></span>
              <div className="wg-chips">
                {CHAOS_MARKS.filter((k) => !(k === 'KHORNE' && sheet.keywords.includes('PSYKER'))).map((k) => {
                  const on = (u.mark ?? 'CHAOS UNDIVIDED') === k;
                  return <button key={k} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => setUnit(u.uid, { mark: k === 'CHAOS UNDIVIDED' ? undefined : k })}>{on && <Icon name="check" size={16} />}{k.charAt(0) + k.slice(1).toLowerCase()}</button>;
                })}
              </div>
            </div>
          )}

          {sheet && (
            <div className="ab-collapsible-section field">
              <button type="button" className="ab-section-toggle" onClick={() => toggleSection('wargear')}>
                <span className="row gap-2" style={{ alignItems: 'center' }}>
                  <Icon name={isWargearOpen ? "down" : "next"} size={16} />
                  <Icon name="wargear" size={15} />
                  <b>Wargear Options</b>
                  {u.wargearPts ? <span className="ab-badge-selected">+{u.wargearPts} pts</span> : null}
                </span>
                <span className="tiny muted">{isWargearOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
              </button>
              {isWargearOpen && <WargearEditor sheet={sheet} u={u} onChange={(patch) => setUnit(u.uid, patch)} />}
            </div>
          )}

          {(() => {
            const sp = splitRuleOf(sheet, list.detachments);
            if (!sp) return null;
            return sp.must
              ? <div className="tiny muted">{sp.name}: {sp.label}</div>
              : <button className={`btn ${u.split ? 'on' : ''}`} onClick={() => setUnit(u.uid, { split: !u.split })}>{u.split && <Icon name="check" size={16} />}{sp.name}: {sp.label}</button>;
          })()}
          <button type="button" className="ab-moreinfo" onClick={() => setMenu(null)}>Close <Icon name="down" size={18} /></button>
        </div>
      </div>
    );
  };

  /** Add a new unit from a datasheet (with a chosen size) and return its uid. */
  const newEntry = (d: DatasheetData, models?: number, patch: Partial<ArmyUnitEntry> = {}): ArmyUnitEntry | null => {
    const opt = pointsOptions(d).find((o) => o.models === models) ?? pointsOptions(d)[0];
    if (!opt) return null;
    return syncWargear(d, defaultWargear(d, { uid: newUid('e'), datasheet: d.name, models: opt.models, pts: opt.pts, ...patch }));
  };

  /**
   * The ⋮ quick menu: Add Squad (characters) / Add Leader / Add Support (squads), Leave Squad, Embark / Disembark,
   * Unit size, Warlord, Duplicate, Delete. The unit's other settings open under it when the row is tapped.
   */
  const quickMenu = () => {
    const u = pop ? list.units.find((x) => x.uid === pop.uid) : undefined;
    if (!pop || !u || !faction) return null;
    const sheet = sheetOf(u.datasheet);
    const body = u.attachTo ? list.units.find((b) => b.uid === u.attachTo) : undefined;
    const joined = list.units.filter((c) => c.attachTo === u.uid).map((c) => ({ c, d: sheetOf(c.datasheet) }));
    const rider = body ?? u; // a Leader rides with the unit it leads
    const rideIn = rider.embarkIn ? list.units.find((t) => t.uid === rider.embarkIn) : undefined;
    const isTransport = !!parseTransport(sheet?.transport) || !!sheet?.keywords.includes('TRANSPORT');
    // transports this unit could ride (a full one still shows, in red) / units this transport could carry
    const rides = isTransport ? [] : list.units.filter((t) => t.uid !== rider.uid && parseTransport(sheetOf(t.datasheet)?.transport))
      .map((t) => ({ t, c: embarkCheck(list, faction, rider.uid, t.uid) })).filter(({ c }) => !c.why || c.full);
    const myLoad = transportLoads(list, faction).find((t) => t.uid === u.uid);
    const cargo = !myLoad ? [] : list.units.filter((r) => r.uid !== u.uid && !r.attachTo)
      .filter((r) => !r.embarkIn || r.embarkIn === u.uid || !list.units.some((t) => t.uid === r.embarkIn))
      .map((r) => ({ r, c: embarkCheck(list, faction, r.uid, u.uid) })).filter(({ c }) => !c.why || c.full);
    // once units are aboard, only they and what still fits show; an empty transport lists everything it can carry
    const aboard = cargo.some(({ r }) => r.embarkIn === u.uid);
    const cargoShown = aboard ? cargo.filter(({ r, c }) => r.embarkIn === u.uid || !c.full) : cargo;
    const opts = sheet ? pointsOptions(sheet) : [];
    const isChar = !!sheet?.keywords.includes('CHARACTER')
      || (list.detachments.includes('Houndpack Lance') && !!sheet?.keywords.includes('WAR DOG'))
      || list.factionId === 'TL'
      || !!sheet?.keywords.includes('ADEPTUS TITANICUS')
      || !!sheet?.factionKeywords.includes('ADEPTUS TITANICUS');
    // characters that could join this squad: Leader slot, then Support slot
    const leadersFor = (support: boolean) => faction.datasheets.filter((d) => allowed(d) && sheet && canLeaderAttach(d, sheet) && supportIn(list, d) === support && pointsOptions(d).length);
    const hasLeader = joined.some((x) => x.d && !supportIn(list, x.d));
    const hasSupport = joined.some((x) => supportIn(list, x.d));
    const canLeader = !u.attachTo && !hasLeader && leadersFor(false).length > 0;
    const canSupport = !u.attachTo && !hasSupport && leadersFor(true).length > 0;
    // a Leader in a squad: Add Support works on the squad it leads
    const bodySheet = body ? sheetOf(body.datasheet) : undefined;
    const bodySupport = body && bodySheet && !supportIn(list, sheet) && !list.units.some((c) => c.attachTo === body.uid && supportIn(list, sheetOf(c.datasheet)))
      && faction.datasheets.some((d) => allowed(d) && supportIn(list, d) && canLeaderAttach(d, bodySheet) && pointsOptions(d).length);
    const squadsFor = sheet?.leads.length && !body ? faction.datasheets.filter((d) => allowed(d) && pointsOptions(d).length > 0 && canLeaderAttach(sheet, d)) : [];
    const close = () => { setPop(null); setPeek(null); };
    const w = pop.mode && pop.mode !== 'size' ? Math.min(340, window.innerWidth - 16) : 260;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, pop.x - w));
    const top = pop.mode && pop.mode !== 'size' ? Math.max(8, Math.min(pop.y + 4, window.innerHeight * 0.15)) : Math.max(8, Math.min(pop.y + 4, window.innerHeight * 0.45));
    const maxHeight = window.innerHeight - top - 8;
    const attach = (charUid: string, bodyUid: string, msg: string) => { setUnit(charUid, { attachTo: bodyUid, embarkIn: undefined }); setNote(msg); close(); };

    /** The unit picture: tap it to read the datasheet (abilities) before adding. */
    const peekArt = (name: string) => (
      <span className="ab-pop-art" role="button" tabIndex={0} aria-label={`${name} datasheet`} onClick={(e) => { e.stopPropagation(); setPeek(name); }}>
        <UnitArt sheet={sheetOf(name)} />
      </span>
    );
    /** Who this roster unit is already joined with ("with Chaos Lord", "led by Master of Executions"). */
    const joinedNote = (x: ArmyUnitEntry) => {
      const host = x.attachTo ? list.units.find((c) => c.uid === x.attachTo) : undefined;
      const led = list.units.filter((c) => c.attachTo === x.uid).map((c) => c.datasheet);
      return host ? `Joined with ${host.datasheet}` : led.length ? `Led by ${led.join(' + ')}` : 'Not joined yet';
    };
    /** A unit already in the roster (white): tap to use it. */
    const rosterCard = (x: ArmyUnitEntry, onPick: (x: ArmyUnitEntry) => void) => (
      <button key={`has-${x.uid}`} type="button" className="ab-pop-card has" onClick={() => onPick(x)}>
        <span className="ab-pop-card-head">
          {peekArt(x.datasheet)}
          <span className="ab-pop-card-text">
            <span className="ab-pop-name">{x.datasheet}</span>
            <span className="ab-pop-line"><span className="ab-pop-pts">{unitPoints(x)} pts</span> <span className="muted">({x.models})</span></span>
            <span className="ab-pop-sub">{joinedNote(x)}</span>
          </span>
        </span>
      </button>
    );
    /** A datasheet to add new (grey), one + per size. */
    const newCard = (d: DatasheetData, onNew: (models: number) => void) => (
      <div key={`new-${d.name}`} className="ab-pop-card">
        <div className="ab-pop-card-head">
          {peekArt(d.name)}
          <div className="ab-pop-card-text">
            <div className="ab-pop-name">{d.name}</div>
            {pointsOptions(d).map((o) => (
              <button key={o.models} type="button" className="ab-pop-size" onClick={() => onNew(o.models)}>
                <span className="ab-pop-pts">{o.pts} pts</span> <span className="muted">({o.models})</span><span className="ab-pop-plus">+</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
    /** A unit card for the embark lists: picture, names, a note under them. */
    const rideCard = (key: string, sheetName: string, title: string, note: string, cls: string, disabled: boolean, onClick: () => void, val?: string, r?: ArmyUnitEntry) => {
      // the leaders riding with it (small pictures) and every enhancement in the group, so two alike squads tell apart
      const group = r ? [...list.units.filter((c) => c.attachTo === r.uid), r] : [];
      const leaders = group.slice(0, -1);
      const enh = group.filter((x) => x.enhancement).map((x) => `${x.enhancement} (${x.datasheet})`);
      return (
      <button key={key} type="button" className={`ab-pop-ride ${cls}`} disabled={disabled} onClick={onClick}>
        <span className="ab-ride-art">
          <UnitArt sheet={sheetOf(sheetName)} />
          {leaders.length > 0 && <span className="ab-ride-leads">{leaders.map((c) => <UnitArt key={c.uid} sheet={sheetOf(c.datasheet)} />)}</span>}
        </span>
        <span className="grow">{title}{enh.length > 0 && <span className="ab-pop-sub ab-ride-enh">{enh.join(' · ')}</span>}{note && <span className="ab-pop-sub">{note}</span>}</span>
        {val && <span className="ab-pop-val">{val}</span>}
        {cls === 'on' && <Icon name="check" size={20} />}
      </button>
      );
    };

    let content: React.ReactNode;
    if (pop.mode === 'squad') {
      content = (
        <>
          <div className="ab-pop-head">{supportIn(list, sheet) ? 'Add Squad (as Support)' : 'Add Squad (as Leader)'}</div>
          {attachOptions(list, faction, u).filter((b) => squadsFor.some((d) => d.name === b.datasheet))
            .map((b) => rosterCard(b, () => attach(u.uid, b.uid, `${u.datasheet} joined ${b.datasheet}`)))}
          {squadsFor.map((d) => newCard(d, (models) => {
            const b = newEntry(d, models);
            if (!b) return;
            set({ units: [...list.units.map((x) => (x.uid === u.uid ? { ...x, attachTo: b.uid, embarkIn: undefined } : x)), b] });
            setNote(`Added ${d.name}; ${u.datasheet} joined it`); close();
          }))}
        </>
      );
    } else if (pop.mode === 'leader' || pop.mode === 'support') {
      const support = pop.mode === 'support';
      content = (
        <>
          <div className="ab-pop-head">{support ? 'Add Support' : 'Add Leader'} · {u.datasheet}</div>
          {list.units.filter((c) => leadersFor(support).some((d) => d.name === c.datasheet) && attachOptions(list, faction, c).some((b) => b.uid === u.uid))
            .map((c) => rosterCard(c, () => attach(c.uid, u.uid, `${c.datasheet} joined ${u.datasheet}`)))}
          {leadersFor(support).map((d) => newCard(d, (models) => {
            const c = newEntry(d, models, { attachTo: u.uid });
            if (!c) return;
            set({ units: [...list.units, c] });
            setNote(`Added ${d.name} to ${u.datasheet}`); close();
          }))}
        </>
      );
    } else if (pop.mode === 'embark' && myLoad) {
      // the transport's own menu: tick the units that start the battle inside it
      const names = (r: ArmyUnitEntry) => [...list.units.filter((c) => c.attachTo === r.uid).map((c) => c.datasheet), r.datasheet].join(' + ');
      content = (
        <>
          <div className="ab-pop-head">Embark · {u.datasheet} <span className="ab-pop-val">{myLoad.used}/{myLoad.capacity}</span></div>
          {cargoShown.map(({ r, c }) => {
            const on = r.embarkIn === u.uid;
            return rideCard(r.uid, r.datasheet, names(r), on ? `${c.need} slots · tap to disembark` : c.full ? `No room: needs ${c.need}, ${Math.max(0, c.capacity - c.used)} left` : `${c.need} slots`,
              on ? 'on' : c.full ? 'full' : '', !on && c.full,
              () => { setUnit(r.uid, { embarkIn: on ? undefined : u.uid }); setNote(on ? `${r.datasheet} left ${u.datasheet}` : `${r.datasheet} starts embarked in ${u.datasheet}`); }, undefined, r);
          })}
        </>
      );
    } else if (pop.mode === 'embark') {
      content = (
        <>
          <div className="ab-pop-head">Start embarked{body ? ` (whole unit with ${body.datasheet})` : ''}</div>
          {rides.map(({ t, c }) => rideCard(t.uid, t.datasheet, t.datasheet, c.full ? `Full: needs ${c.need}, ${Math.max(0, c.capacity - c.used)} left` : '',
            rider.embarkIn === t.uid ? 'on' : c.full ? 'full' : '', c.full,
            () => { setUnit(rider.uid, { embarkIn: t.uid }); setNote(`${rider.datasheet} starts embarked in ${t.datasheet}`); close(); }, `${c.used}/${c.capacity}`))}
        </>
      );
    } else if (pop.mode === 'size') {
      content = (
        <>
          <div className="ab-pop-head">Unit size · {u.datasheet}</div>
          {opts.map((o) => (
            <button key={o.models} type="button" className={`ab-pop-size ${u.models === o.models ? 'on' : ''}`} onClick={() => { setUnit(u.uid, { models: o.models, pts: o.pts }); close(); }}>
              <span className="ab-pop-pts">{o.pts} pts</span> <span className="muted">({o.models})</span><span className="ab-pop-plus">{u.models === o.models ? <Icon name="check" size={18} /> : '+'}</span>
            </button>
          ))}
        </>
      );
    } else {
      content = (
        <>
          {squadsFor.length > 0 && <button type="button" onClick={() => setPop({ ...pop, mode: 'squad' })}><Icon name="plus" size={22} />Add Squad</button>}
          {canLeader && <button type="button" onClick={() => setPop({ ...pop, mode: 'leader' })}><Icon name="plus" size={22} />Add Leader</button>}
          {canSupport && <button type="button" onClick={() => setPop({ ...pop, mode: 'support' })}><Icon name="plus" size={22} />Add Support</button>}
          {bodySupport && <button type="button" onClick={() => setPop({ ...pop, uid: body!.uid, mode: 'support' })}><Icon name="plus" size={22} />Add Support <span className="ab-pop-val">{body!.datasheet}</span></button>}
          {body && (
            <button type="button" onClick={() => { setUnit(u.uid, { attachTo: undefined }); setNote(`${u.datasheet} left ${body.datasheet}`); close(); }}>
              <Icon name="leave" size={22} />Leave Squad
            </button>
          )}
          {myLoad && cargo.length > 0 && (
            <button type="button" onClick={() => setPop({ ...pop, mode: 'embark' })}><Icon name="embark" size={22} />Embark <span className="ab-pop-val">{myLoad.used}/{myLoad.capacity}</span></button>
          )}
          {!isTransport && (rideIn ? (
            <button type="button" onClick={() => { setUnit(rider.uid, { embarkIn: undefined }); setNote(`${rider.datasheet} left ${rideIn.datasheet}`); close(); }}>
              <Icon name="leave" size={22} />Disembark <span className="ab-pop-val">{rideIn.datasheet}</span>
            </button>
          ) : rides.length > 0 && (
            <button type="button" onClick={() => setPop({ ...pop, mode: 'embark' })}><Icon name="embark" size={22} />Embark</button>
          ))}
          {opts.length > 1 && <button type="button" onClick={() => setPop({ ...pop, mode: 'size' })}><Icon name="size" size={22} />Unit size <span className="ab-pop-val">{u.models}</span></button>}
          {isChar && (
            <button type="button" className={u.warlord ? 'on' : ''} onClick={() => { set({ units: list.units.map((x) => ({ ...x, warlord: x.uid === u.uid ? !u.warlord : false })) }); close(); }}>
              <Icon name={u.warlord ? 'check' : 'leader'} size={22} />{u.warlord ? 'Warlord' : 'Make Warlord'}
            </button>
          )}
          <button type="button" onClick={() => { set({ units: [...list.units, { ...u, uid: newUid('e'), warlord: false, enhancement: undefined, enhancementPts: undefined, attachTo: undefined }] }); setNote(`Added another ${u.datasheet}`); close(); }}>
            <Icon name="duplicate" size={22} />Duplicate
          </button>
          <button type="button" onClick={() => { removeUnit(u.uid); close(); }}>
            <Icon name="delete" size={22} />Delete
          </button>
        </>
      );
    }
    return (
      <div className="ab-pop-backdrop" onClick={close}>
        <div className="ab-pop" style={{ left, top, width: w, maxHeight }} onClick={(e) => e.stopPropagation()}>{content}</div>
        {peek && sheetOf(peek) && (
          <div className="tray-backdrop" onClick={(e) => { e.stopPropagation(); setPeek(null); }}>
            <div className="tray" role="dialog" aria-label={`${peek} datasheet`} onClick={(e) => e.stopPropagation()}>
              <div className="tray-head"><span className="sheet-title grow">{peek}</span><button className="btn small ghost" onClick={() => setPeek(null)}>Close</button></div>
              <DatasheetView sheet={sheetOf(peek)!} factionId={faction.id} />
            </div>
          </div>
        )}
      </div>
    );
  };

  const pickerSheet = () => {
    if (!picker || !index) return null;
    const step = picker.factionId ? index.factions.find((f) => f.id === picker.factionId) : null;
    const opts = step?.id === list.factionId ? subs?.options : undefined;
    const groups = ['Imperium', 'Chaos', 'Xenos', 'Other'];
    return (
      <div className="tray-backdrop" onClick={() => setPicker(null)}>
        <div className="tray" onClick={(e) => e.stopPropagation()}>
          <div className="row">
            {step && <button className="btn small ghost" onClick={() => setPicker({ factionId: null })}><Icon name="back" size={16} /> Faction</button>}
            <div className="sheet-title grow">{step ? `${step.name}: select ${subs?.label ?? 'sub-faction'}` : 'Select Faction'}</div>
            <button className="btn small ghost" onClick={() => setPicker(null)}>Close</button>
          </div>
          {!step && groups.map((g) => {
            // factions whose rules are all written up first; the rest (rules read from the card text only) greyed out
            const fs = index.factions.filter((f) => (f.group ?? 'Other') === g && f.datasheets > 0 && f.detachments > 0)
              .sort((a, b) => Number(hasFactionRules(b.id)) - Number(hasFactionRules(a.id)));
            if (!fs.length) return null;
            return (
              <div key={g} className="ab-fgroup">
                <div className="ab-fgroup-title">{g}</div>
                <div className="ab-fgrid">
                  {fs.map((f) => (
                    <button key={f.id} type="button" className={`ab-fcard ${f.id === list.factionId ? 'on' : ''} ${hasFactionRules(f.id) ? '' : 'wip'}`}
                      onClick={() => (f.subfactions?.length ? (f.id === list.factionId ? setPicker({ factionId: f.id }) : (choose(f.id), setPicker({ factionId: f.id }))) : choose(f.id))}>
                      <Emblem factionId={f.id} color={f.id === list.factionId ? sub?.color : undefined} sub={f.id === list.factionId ? list.subfaction : undefined} />
                      <span className="ab-fname">{f.name}</span>
                      {f.subfactions?.length ? <span className="ab-sub">{f.subfactions.length} sub-factions <Icon name="next" size={13} /></span> : null}
                      {!hasFactionRules(f.id) && <span className="ab-sub">Rules not finished</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {step && !opts && <div className="ab-empty">Loading…</div>}
          {step && opts && (
            <>
              {list.units.length > 0 && <div className="small muted">Changing {subs!.label} removes units and Detachments of other {subs!.label}s; generic units stay</div>}
              <div className="ab-fgrid">
                <button type="button" className={`ab-fcard ${!list.subfaction ? 'on' : ''}`} onClick={() => choose(step.id, undefined)}>
                  <Emblem factionId={step.id} />
                  <span className="ab-fname">No {subs!.label}</span>
                  <span className="ab-sub">Generic units only</span>
                </button>
                {opts.map((o) => {
                  const nU = faction!.datasheets.filter((d) => d.subfaction === o.keyword).length;
                  const nD = faction!.detachments.filter((d) => d.subfaction === o.keyword).length;
                  return (
                    <button key={o.keyword} type="button" className={`ab-fcard ${list.subfaction === o.keyword ? 'on' : ''}`} onClick={() => choose(step.id, o.keyword)}>
                      <Emblem factionId={step.id} color={o.color} sub={o.keyword} />
                      <span className="ab-fname">{o.name}</span>
                      <span className="ab-sub">{nU} specific units · {nD} Detachments</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="ab" style={{ ['--accent' as string]: armyColor(list.factionId, list.subfaction), ['--accent-2' as string]: armyColor(list.factionId, list.subfaction) }}>
      <header className="ab-top">
        <button type="button" className="appbar-back-btn" aria-label="Back" onClick={onDone}>&lt;</button>
        <div className="ab-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>List</button>
          <button role="tab" aria-selected={tab === 'detachment'} className={tab === 'detachment' ? 'on' : ''} onClick={() => setTab('detachment')}>Detachment</button>
        </div>
        <div className={`ab-total ${pts > size.points ? 'over' : ''}`}>{pts}/{size.points}<small> pts</small></div>
        <button type="button" className="ab-icon" aria-label="Share army list" onClick={share}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
          </svg>
        </button>
      </header>
      <div className="ab-body">
        {tab === 'list' && (
          <div className="ab-head slate">
           <div className="slate-in">
            <div className="ab-head-main">
              <Emblem factionId={list.factionId} color={sub?.color} sub={list.subfaction} />
              <span className="grow ab-head-text">
                <input className="ab-title ab-name-input" aria-label="Army name" value={list.name} placeholder="Army name" onChange={(e) => set({ name: e.target.value })} />
                <span className="ab-faction">{factionName}{sub ? ` · ${sub.name}` : ''}</span>
                <span className="ab-det-name">{list.detachments.join(' · ') || 'No Detachment selected'}</span>
              </span>
              {list.units.length > 0 && (
                // the page runs where confirm() dialogs are blocked: tap once to arm, again to clear
                <button type="button" className={`ab-reset ${resetArmed ? 'armed' : ''}`} onClick={() => {
                  if (!resetArmed) { setResetArmed(true); window.setTimeout(() => setResetArmed(false), 3000); return; }
                  setResetArmed(false);
                  set({ units: [], detachments: [] });
                  setNote('Roster reset');
                }}><Icon name="delete" size={15} /> {resetArmed ? 'Tap again' : 'Reset'}</button>
              )}
            </div>
            {dispositionChips()}
           </div>
          </div>
        )}
        {!faction && <div className="ab-empty">Loading…</div>}
        {faction && (tab === 'list' ? listTab() : detachmentTab())}
      </div>
      {note && <div className="toast ab-toast">{note}</div>}
      {addSheet()}
      {quickMenu()}
      {detPickerPage()}
      {pickerSheet()}
    </div>
  );
}
