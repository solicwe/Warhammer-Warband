import { useEffect, useMemo, useState } from 'react';
import { addonLines, attachOptions, enhancementFits, enhancementOptions, listPoints, newUid, parseTransport, pointsOptions, splitRuleOf, syncList, syncWargear, transportLoads, unitPoints, validateList, wargearMax, wargearSummary, wkey } from '../engine/army';
import { RULES } from '../engine/config';
import type { ArmyList, ArmyUnitEntry, DatasheetData, FactionData, SubfactionData, WargearOption, WargearPick } from '../engine/types';
import { Icon } from './Icon';
import { loadFaction, loadIndex, type FactionIndex } from './data';
import { DET_RULES } from '../engine/detachments';
import { DatasheetView } from './Sheet';
import { tokenKind } from './Tokens';
import { cloudMode, cloudPortraitCount, download, exportablePortraitCount, exportPortraitsJson, exportPortraitsZip, fileToPortrait, getPortrait, hasOwnPortrait, importPortraitsJson, matchDatasheet, ownPortraitCount, cloudPhotosNotIn, removeUnusedCloudFiles, servedPortraitCount, setPortrait, cloudErrorNow, uploadAllLocal, uploadsPending, usePortraitsVersion } from './portraits';

interface Props {
  list: ArmyList;
  onChange: (l: ArmyList) => void;
  onDone: () => void;
}

type Section = 'characters' | 'battleline' | 'transports' | 'others';
const SECTIONS: { id: Section; title: string }[] = [
  { id: 'characters', title: 'Characters' },
  { id: 'battleline', title: 'Battleline' },
  { id: 'transports', title: 'Dedicated Transports' },
  { id: 'others', title: 'Others' },
];

function sectionOf(d: DatasheetData | undefined): Section {
  if (!d) return 'others';
  if (d.keywords.includes('CHARACTER') || /Character|Epic Hero/.test(d.role)) return 'characters';
  if (d.keywords.includes('BATTLELINE') || d.role === 'Battleline') return 'battleline';
  if (d.role === 'Dedicated Transports' || d.keywords.includes('DEDICATED TRANSPORT')) return 'transports';
  return 'others';
}

/** Original faction emblems (not official marks). */
export const titleCase = (k: string) => k.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

export function Emblem({ factionId, color }: { factionId: string; color?: string }) {
  return (
    <svg className="ab-emblem" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="#1a1a1a" stroke="#7a0c0c" strokeWidth="3" />
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
      ) : (
        <g fill="none" stroke="#b0b0b0" strokeWidth="3"><circle cx="32" cy="32" r="12" /><path d="M32 12 V20 M32 44 V52 M12 32 H20 M44 32 H52" /></g>
      )}
    </svg>
  );
}

/** Wide picture block for a unit row: the user's photo, or the token art. */
function UnitArt({ sheet }: { sheet?: DatasheetData }) {
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
  if (o.stack) return `สูงสุด ${max}`;
  if (o.scope === 'all') return 'ทั้งหน่วย';
  if (o.scope === 'perN') return `${max} ตัว (ทุก ${o.per} โมเดล)`;
  if (o.scope === 'any') return `ได้ทุกตัว (${max})`;
  if (o.scope === 'upTo' && max > 1) return `ไม่เกิน ${max} ตัว`;
  return '';
}

/** Wargear choices of one list entry: swaps, extra weapons, "pick two from the list", add-on models. */
function WargearEditor({ sheet, u, onChange }: { sheet: DatasheetData; u: ArmyUnitEntry; onChange: (patch: Partial<ArmyUnitEntry>) => void }) {
  const opts = sheet.wargearOptions ?? [];
  const addons = addonLines(sheet);
  if (!opts.length && !addons.length) return null;
  const picks = u.wargear ?? [];
  const cost = (items: string[]) => items.reduce((a, n) => a + (sheet.wargearCosts?.find((c) => wkey(c.name) === wkey(n))?.pts ?? 0), 0);
  const costTag = (items: string[]) => { const c = cost(items); return c ? <span className="wg-cost">+{c}</span> : null; };
  const put = (opt: number, next: WargearPick[]) => onChange({ wargear: [...picks.filter((p) => p.opt !== opt), ...next] });
  const single = sheet.models.length === 1 && (sheet.composition.length <= 1);
  return (
    <div className="field">
      <span>Wargear {sheet.wargearCosts?.some((c) => !addons.some((a) => a.name === c.name)) ? <span className="tiny muted">· บางอาวุธบวกแต้ม (แสดง +แต้ม/ชิ้น)</span> : null}</span>
      {opts.map((o, i) => {
        const max = wargearMax(sheet, o, u.models, u.addons);
        const mine = picks.filter((p) => p.opt === i);
        const used = mine.reduce((a, p) => a + p.count, 0);
        const who = o.who !== '*' && !single ? `${o.who}: ` : '';
        const head = `${who}${o.replace.length ? `${itemsLabel(o.replace)} →` : 'เพิ่ม'}`;
        if (max <= 0) {
          return (
            <div key={i} className="wg-opt off">
              <div className="wg-head">{head}</div>
              <div className="tiny muted">{o.minModels ? `ต้องมี ${o.minModels} โมเดลขึ้นไป` : 'ใช้ไม่ได้กับขนาดหน่วยนี้'}</div>
            </div>
          );
        }
        const pickSel = mine.find((p) => p.choice < 0);
        const pickDefault = (): string[] => (o.pickFrom ?? []).slice(0, o.pick ?? 2);
        const radio = max === 1 || o.scope === 'all' || o.scope === 'one';
        return (
          <div key={i} className="wg-opt">
            <div className="wg-head">{head} <span className="tiny muted">{scopeLabel(o, max)}</span></div>
            {radio ? (
              <div className="wg-chips">
                <button type="button" className={!mine.length ? 'on' : ''} onClick={() => put(i, [])}>{o.replace.length ? 'ไม่เปลี่ยน' : 'ไม่ใส่'}</button>
                {o.choices.map((c, ci) => (
                  <button type="button" key={ci} className={mine.some((p) => p.choice === ci) ? 'on' : ''} onClick={() => put(i, [{ opt: i, choice: ci, count: o.scope === 'all' ? max : 1 }])}>
                    {itemsLabel(c)}{costTag(c)}
                  </button>
                ))}
                {o.pick && (
                  <button type="button" className={pickSel ? 'on' : ''} onClick={() => put(i, [{ opt: i, choice: -1, count: 1, picks: pickSel?.picks ?? pickDefault() }])}>
                    เลือก {o.pick} ชิ้นจากรายการ
                  </button>
                )}
              </div>
            ) : (
              o.choices.map((c, ci) => {
                const cur = mine.find((p) => p.choice === ci)?.count ?? 0;
                const setN = (n: number) => put(i, [...mine.filter((p) => p.choice !== ci), ...(n > 0 ? [{ opt: i, choice: ci, count: n }] : [])]);
                return (
                  <div key={ci} className="wg-step">
                    <span className="grow">{itemsLabel(c)}{costTag(c)}</span>
                    <button type="button" aria-label={`ลด ${itemsLabel(c)}`} disabled={cur <= 0} onClick={() => setN(cur - 1)}>−</button>
                    <b>{cur}</b>
                    <button type="button" aria-label={`เพิ่ม ${itemsLabel(c)}`} disabled={used >= max} onClick={() => setN(cur + 1)}>+</button>
                  </div>
                );
              })
            )}
            {pickSel && o.pickFrom && (
              <div className="wg-picks">
                {Array.from({ length: o.pick ?? 2 }, (_, k) => (
                  <select key={k} value={pickSel.picks?.[k] ?? ''} aria-label={`อาวุธชิ้นที่ ${k + 1}`} onChange={(e) => {
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
            <div className="wg-head">เพิ่มโมเดล</div>
            <div className="wg-chips">
              <button type="button" className={!on ? 'on' : ''} onClick={() => onChange({ addons: (u.addons ?? []).filter((x) => x !== a.name) })}>ไม่เพิ่ม</button>
              <button type="button" className={on ? 'on' : ''} onClick={() => onChange({ addons: [...(u.addons ?? []).filter((x) => x !== a.name), a.name] })}>+1 {a.name}<span className="wg-cost">+{a.pts}</span></button>
            </div>
          </div>
        );
      })}
      <details>
        <summary className="tiny">ข้อความ wargear ต้นฉบับ</summary>
        {sheet.options.map((t, k) => <div key={k} className="tiny">• {t}</div>)}
      </details>
    </div>
  );
}

export function ArmyBuilder({ list, onChange, onDone }: Props) {
  const [index, setIndex] = useState<FactionIndex | null>(null);
  const [faction, setFaction] = useState<FactionData | null>(null);
  const [tab, setTab] = useState<'list' | 'detachment'>('list');
  const [adding, setAdding] = useState<Section | null>(null);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<string | null>(null); // uid of the unit whose ⋮ menu is open
  const [picker, setPicker] = useState<{ factionId: string | null } | null>(null); // faction → sub-faction chooser
  const [view, setView] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [imported, setImported] = useState<{ ok: string[]; missed: { file: File; name: string }[] } | null>(null);

  useEffect(() => { loadIndex().then(setIndex).catch(() => setNote('โหลดรายชื่อ faction ไม่ได้')); }, []);
  useEffect(() => { setFaction(null); loadFaction(list.factionId).then(setFaction).catch(() => setNote('โหลดข้อมูล faction ไม่ได้')); }, [list.factionId]);
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNote(null), 2400); return () => window.clearTimeout(t); }, [note]);
  useEffect(() => {
    if (!faction || faction.id !== list.factionId) return;
    const synced = syncList(list, faction);
    if (synced !== list) onChange(synced);
  }, [faction, list, onChange]);

  const size = RULES.battleSizes.find((b) => b.id === list.battleSize) ?? RULES.battleSizes[0];
  const errors = useMemo(() => (faction ? validateList(list, faction, size) : []), [list, faction, size]);
  const pts = listPoints(list);
  const dpUsed = faction ? list.detachments.reduce((a, n) => a + (faction.detachments.find((d) => d.name === n)?.dp ?? 0), 0) : 0;
  const sheetOf = (name: string) => faction?.datasheets.find((d) => d.name === name);
  const factionName = index?.factions.find((f) => f.id === list.factionId)?.name ?? faction?.name ?? list.factionId;
  const subs = faction?.subfactions;
  const sub: SubfactionData | undefined = subs?.options.find((o) => o.keyword === list.subfaction);
  const allowed = (x: { subfaction?: string }) => !x.subfaction || x.subfaction === list.subfaction;
  const subTag = (k?: string) => (k ? subs?.options.find((o) => o.keyword === k)?.name ?? titleCase(k) : '');

  /** Switch faction (clears the list) or only the sub-faction (keeps what is still legal). */
  const choose = (factionId: string, subfaction?: string) => {
    setPicker(null);
    if (factionId !== list.factionId) {
      onChange({ ...list, factionId, subfaction, detachments: [], units: [] });
      return;
    }
    if (!faction) return;
    const ok = (x: { subfaction?: string }) => !x.subfaction || x.subfaction === subfaction;
    const units = list.units.filter((u) => ok(faction.datasheets.find((d) => d.name === u.datasheet) ?? {}));
    const kept = new Set(units.map((u) => u.uid));
    const detachments = list.detachments.filter((n) => ok(faction.detachments.find((d) => d.name === n) ?? {}));
    const dropped = list.units.length - units.length + list.detachments.length - detachments.length;
    onChange({ ...list, subfaction, detachments, units: units.map((u) => (u.attachTo && !kept.has(u.attachTo) ? { ...u, attachTo: undefined } : u)) });
    if (dropped) setNote(`เอาหน่วย/detachment ของ ${subs?.label ?? 'sub-faction'} อื่นออก ${dropped} รายการ`);
  };

  const set = (patch: Partial<ArmyList>) => onChange({ ...list, ...patch });
  /** Update one entry; wargear choices are re-checked for the new size and their points recomputed. */
  const setUnit = (uid: string, patch: Partial<ArmyUnitEntry>) => set({ units: list.units.map((x) => (x.uid === uid ? syncWargear(sheetOf(x.datasheet), { ...x, ...patch }) : x)) });
  const removeUnit = (uid: string) => set({ units: list.units.filter((x) => x.uid !== uid).map((x) => (x.attachTo === uid ? { ...x, attachTo: undefined } : x.embarkIn === uid ? { ...x, embarkIn: undefined } : x)) });
  const addUnit = (d: DatasheetData) => {
    const opt = pointsOptions(d)[0];
    if (!opt) return;
    set({ units: [...list.units, syncWargear(d, { uid: newUid('e'), datasheet: d.name, models: opt.models, pts: opt.pts })] });
    setNote(`เพิ่ม ${d.name}`);
  };

  const importPhotos = async (files: FileList | null) => {
    if (!files || !faction) return;
    const names = faction.datasheets.map((d) => d.name);
    const ok: string[] = [];
    const missed: { file: File; name: string }[] = [];
    for (const f of [...files]) {
      const name = matchDatasheet(f.name, names);
      if (!name) { missed.push({ file: f, name: f.name }); continue; }
      try { setPortrait(name, await fileToPortrait(f)); ok.push(name); } catch { missed.push({ file: f, name: f.name }); }
    }
    setImported({ ok, missed });
  };

  const share = async () => {
    const lines = [
      `${list.name || 'Army list'} — ${factionName}${sub ? ` (${sub.name})` : ''}`,
      `${list.detachments.join(', ') || 'ไม่มี detachment'} · ${pts}/${size.points} pts`,
      '',
      ...SECTIONS.flatMap((sec) => {
        const us = list.units.filter((u) => sectionOf(sheetOf(u.datasheet)) === sec.id);
        if (!us.length) return [];
        return [`${sec.title.toUpperCase()}`, ...us.map((u) => {
          const wg = wargearSummary(sheetOf(u.datasheet), u);
          return `• ${u.datasheet} (${u.models}) — ${unitPoints(u)} pts${u.warlord ? ' · Warlord' : ''}${u.enhancement ? ` · ${u.enhancement}` : ''}${wg ? `\n   ${wg}` : ''}`;
        }), ''];
      }),
    ].join('\n');
    try {
      if (navigator.share) await navigator.share({ title: list.name || 'Army list', text: lines });
      else { await navigator.clipboard.writeText(lines); setNote('คัดลอกรายชื่อกองทัพแล้ว'); }
    } catch { /* cancelled */ }
  };

  const menuUnit = menu ? list.units.find((u) => u.uid === menu) : undefined;
  const menuSheet = menuUnit ? sheetOf(menuUnit.datasheet) : undefined;

  const unitRow = (u: ArmyUnitEntry) => {
    const sheet = sheetOf(u.datasheet);
    const leads = u.attachTo ? list.units.find((b) => b.uid === u.attachTo) : undefined;
    const rides = u.embarkIn ? list.units.find((t) => t.uid === u.embarkIn) : undefined;
    const load = faction ? transportLoads(list, faction).find((t) => t.uid === u.uid) : undefined;
    const carried = load?.riders.map((r) => list.units.find((x) => x.uid === r)?.datasheet).filter(Boolean) ?? [];
    const line = [
      u.warlord && 'Warlord', leads && `${sheet?.isSupport ? 'Support ของ' : 'นำ'} ${leads.datasheet}`, u.split && 'แยก 2 หน่วย',
      rides && `เริ่มเกมบน ${rides.datasheet}`,
      load && (carried.length ? `บรรทุก ${carried.join(', ')} (${load.used}/${load.capacity} ที่)` : `ว่าง (0/${load.capacity} ที่)`),
    ].filter(Boolean).join(' · ');
    const wg = wargearSummary(sheet, u);
    const wrong = sheet && !allowed(sheet);
    return (
      <div key={u.uid} className="ab-row">
        <button type="button" className="ab-row-main" onClick={() => (sheet ? setView(u.datasheet) : setMenu(u.uid))}>
          <UnitArt sheet={sheet} />
          <span className="ab-row-text">
            <span className="ab-name">{u.datasheet} <span className="ab-count">({u.models})</span></span>
            <span className="ab-pts">{unitPoints(u)} pts{u.enhancement && <span className="ab-enh"> {u.enhancement}</span>}{sheet?.subfaction && <span className={`ab-chip ${wrong ? 'bad' : ''}`}>{subTag(sheet.subfaction)}</span>}{!sheet && faction && <span className="ab-chip bad">ไม่มีใน 11e</span>}</span>
            {line && <span className="ab-sub">{line}</span>}
            {wg && <span className="ab-sub ab-wg"><Icon name="wargear" size={13} /> {wg}</span>}
          </span>
        </button>
        <button type="button" className="ab-kebab" aria-label={`ตัวเลือก ${u.datasheet}`} onClick={() => setMenu(u.uid)}><Icon name="more" size={22} /></button>
      </div>
    );
  };

  const listTab = () => (
    <>
      {errors.length > 0 && <div className="ab-errors">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
      {SECTIONS.map((sec) => {
        const us = list.units.filter((u) => sectionOf(sheetOf(u.datasheet)) === sec.id);
        if (sec.id === 'transports' && !us.length) return null;
        return (
          <section key={sec.id} className="ab-section">
            <div className="ab-section-head">
              <span>{sec.title}</span>
              <button type="button" className="ab-add" aria-label={`เพิ่ม ${sec.title}`} onClick={() => { setQ(''); setAdding(sec.id); }}>+</button>
            </div>
            {us.map(unitRow)}
            {!us.length && <div className="ab-empty">ยังไม่มีหน่วย — กด + เพื่อเพิ่ม</div>}
          </section>
        );
      })}
    </>
  );

  const detachmentTab = () => faction && (
    <>
      <div className="card">
        <div className="field">Faction{subs ? ` / ${subs.label}` : ''}
          <button type="button" className="ab-pick-btn" onClick={() => setPicker({ factionId: null })}>
            <span className="grow">{factionName}{subs ? ` · ${sub?.name ?? `ไม่ระบุ ${subs.label}`}` : ''}</span>
            <span className="muted">เปลี่ยน ›</span>
          </button>
        </div>
        <label className="field">Battle size
          <select value={list.battleSize} onChange={(e) => set({ battleSize: e.target.value })}>
            {RULES.battleSizes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.points} pts · {b.dp} DP)</option>)}
          </select>
        </label>
      </div>
      <div className="card">
        <div className="card-title">Detachments <span className="muted small">{dpUsed}/{size.dp} DP</span></div>
        {subs && !sub && <div className="small muted">ยังไม่ได้เลือก {subs.label} — แสดงเฉพาะ detachment ทั่วไป <button type="button" className="linkish" onClick={() => setPicker({ factionId: list.factionId })}>เลือก {subs.label}</button></div>}
        {faction.detachments.filter((d) => d.forceDisposition && (allowed(d) || list.detachments.includes(d.name)))
          .sort((a, b) => Number(!!b.subfaction) - Number(!!a.subfaction))
          .map((d) => {
          const on = list.detachments.includes(d.name);
          return (
            <div key={d.id} className={`ab-det ${on ? 'on' : ''}`}>
              <button type="button" className="ab-det-head" onClick={() => set({ detachments: on ? list.detachments.filter((x) => x !== d.name) : [...list.detachments, d.name] })}>
                <span className="ab-check">{on && <Icon name="check" size={16} />}</span>
                <span className="grow">
                  <span className="ab-name">{d.name}{d.subfaction && <span className={`ab-chip ${allowed(d) ? '' : 'bad'}`}>{subTag(d.subfaction)}</span>}</span>
                  <span className="ab-sub">{d.dp} DP · {d.forceDisposition} · {d.enhancements.length} enhancements · {d.stratagems.length} stratagems</span>
                  <span className={`det-auto ${DET_RULES[d.name]?.auto ?? 'none'}`}>{{ full: 'กฎ detachment: ระบบทำให้ครบ', partial: 'กฎ detachment: ระบบทำส่วนหลัก', manual: 'กฎ detachment: ทำเอง' }[DET_RULES[d.name]?.auto ?? 'manual'] ?? 'กฎ detachment: อ่านเอง'}{!DET_RULES[d.name] ? ' (ยังไม่รองรับ)' : ''}</span>
                </span>
              </button>
              {on && (
                <details>
                  <summary className="tiny">กฎ / enhancements / stratagems</summary>
                  {d.rules.map((r) => <div key={r.name} className="sheet tiny"><b>{r.name}</b>{'\n'}{r.text}</div>)}
                  {d.enhancements.map((e) => <div key={e.name} className="sheet tiny"><b>{e.name}</b> ({e.pts} pts{e.upgrade ? ', Upgrade' : ''}){'\n'}{e.text}</div>)}
                  {d.stratagems.map((st) => <div key={st.name} className="sheet tiny"><b>{st.name}</b> ({st.cp}CP · {st.type}){'\n'}{st.text}</div>)}
                </details>
              )}
            </div>
          );
        })}
      </div>
      <div className="card">
        <div className="card-title">รูปตัวละคร</div>
        <div className="small muted">เลือกหลายรูปพร้อมกันได้ ตั้งชื่อไฟล์ตามชื่อ datasheet (เช่น <i>Intercessor Squad.jpg</i>) ระบบจะจับคู่ให้เอง หรือแตะรูปในหน้า datasheet เพื่อเปลี่ยนทีละหน่วย</div>
        {cloudMode === 'write' && <div className="hint"><span><Icon name="cloud" size={15} /> เปิดจากลิงก์เว็บ: รูปที่ใส่จะอัปขึ้นเว็บนี้เลย ทุกคนที่เปิดลิงก์เห็นรูปเดียวกัน</span></div>}
        {cloudMode === 'read' && <div className="small muted"><Icon name="cloud" size={14} /> รูปบนเว็บนี้ ({cloudPortraitCount()}) — คุณดูได้อย่างเดียว ใส่รูปเพิ่มจะเก็บไว้แค่ในเครื่องนี้</div>}
        <div className="small muted">
          {cloudMode !== 'off' ? `บนเว็บ ${cloudPortraitCount()} รูป · ` : ''}ในเครื่องนี้ {ownPortraitCount()} รูป · จากโฟลเดอร์เซิร์ฟเวอร์ {servedPortraitCount()} รูป
        </div>
        {cloudErrorNow() && <div className="err">{cloudErrorNow()}</div>}
        {uploadsPending() > 0 && <div className="small"><b><Icon name="cloud" size={15} /> กำลังอัปขึ้นเว็บ… เหลือ {uploadsPending()} รูป</b></div>}
        {cloudMode === 'write' && ownPortraitCount() > 0 && (
          <button className="btn primary" disabled={uploadsPending() > 0} onClick={async () => { const n = await uploadAllLocal(); setNote(`อัปขึ้นเว็บแล้ว ${n} รูป`); }}>
            <Icon name="cloud" /> {uploadsPending() > 0 ? 'กำลังอัป…' : `อัปรูปในเครื่อง ${ownPortraitCount()} รูป ขึ้นเว็บ`}
          </button>
        )}
        {cloudMode === 'write' && cloudPortraitCount() > 0 && (
          <button className="btn ghost" disabled={uploadsPending() > 0} onClick={async () => {
            setNote('กำลังเช็กรูปบนเว็บ…');
            try {
              // every datasheet of every army: a photo whose unit is in none of them (moved to Legends …) can go
              const idx = await loadIndex();
              const known = new Set((await Promise.all(idx.factions.map((f) => loadFaction(f.id)))).flatMap((f) => f.datasheets.map((d) => d.name)));
              const gone = cloudPhotosNotIn(known);
              if (!window.confirm(`ลบออกจากเว็บ:\n• ไฟล์รูปซ้ำที่ไม่มีหน่วยไหนใช้${gone.length ? `\n• รูปของหน่วยที่ไม่มีในเกมแล้ว (Legends): ${gone.join(', ')}` : ''}\nรูปของหน่วยที่ยังใช้อยู่ไม่หาย`)) { setNote(null); return; }
              const r = await removeUnusedCloudFiles(known);
              setNote(`ลบแล้ว: ไฟล์ซ้ำ ${r.files} ไฟล์${r.photos.length ? ` · รูปหน่วย Legends ${r.photos.length} รูป (${r.photos.join(', ')})` : ''}`);
            } catch { setNote('ลบไม่สำเร็จ ลองใหม่อีกครั้ง'); }
          }}><Icon name="clean" /> เก็บกวาดรูปบนเว็บ (ไฟล์ซ้ำ + หน่วย Legends)</button>
        )}
        <div className="btn-row">
          <label className="btn">
            <Icon name="camera" /> นำเข้ารูป
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { importPhotos(e.target.files); e.target.value = ''; }} />
          </label>
          <button className="btn ghost" disabled={!exportablePortraitCount()} onClick={async () => {
            const factionOf = (n: string) => (faction?.datasheets.some((d) => d.name === n) ? list.factionId : undefined);
            download('unit-images.zip', await exportPortraitsZip(factionOf), 'application/zip')
              .then((m) => setNote(`${m} — แตกไฟล์ลงโฟลเดอร์ public/images/ แล้วรัน npm run images`));
          }}><Icon name="download" /> ส่งออก (.zip สำหรับเซิร์ฟเวอร์)</button>
          <button className="btn ghost" disabled={!ownPortraitCount()} onClick={() => download('unit-images-backup.json', exportPortraitsJson(), 'application/json').then(setNote)}><Icon name="download" /> สำรอง (.json)</button>
          <label className="btn ghost">
            <Icon name="upload" /> กู้คืนจาก .json
            <input type="file" accept="application/json,.json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try { setNote(`กู้คืน ${importPortraitsJson(await f.text())} รูป`); } catch { setNote('ไฟล์นี้ไม่ใช่ไฟล์สำรองรูป'); }
            }} />
          </label>
        </div>
        {imported && (
          <div className="small">
            <div>จับคู่ได้ {imported.ok.length} รูป{imported.ok.length ? `: ${imported.ok.join(', ')}` : ''}</div>
            {imported.missed.map((m, i) => (
              <div key={i} className="row" style={{ marginTop: 4 }}>
                <span className="grow muted">{m.name}</span>
                <select defaultValue="" onChange={async (e) => {
                  const name = e.target.value;
                  if (!name) return;
                  setPortrait(name, await fileToPortrait(m.file));
                  setImported((x) => x && { ok: [...x.ok, name], missed: x.missed.filter((y) => y !== m) });
                }}>
                  <option value="">เลือก datasheet…</option>
                  {faction.datasheets.map((d) => d.name).sort().map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const addSheet = () => {
    if (!adding || !faction) return null;
    const title = SECTIONS.find((x) => x.id === adding)!.title;
    const sheets = faction.datasheets
      .filter((d) => !d.keywords.includes('AIRCRAFT') && allowed(d) && sectionOf(d) === adding && d.name.toLowerCase().includes(q.toLowerCase()) && pointsOptions(d).length)
      .sort((a, b) => Number(!!b.subfaction) - Number(!!a.subfaction) || a.name.localeCompare(b.name));
    return (
      <div className="tray-backdrop" onClick={() => setAdding(null)}>
        <div className="tray" onClick={(e) => e.stopPropagation()}>
          <div className="row">
            <div className="sheet-title grow">เพิ่ม {title}</div>
            <button className="btn small ghost" onClick={() => setAdding(null)}>ปิด</button>
          </div>
          <input placeholder="ค้นหา datasheet…" value={q} onChange={(e) => setQ(e.target.value)} />
          {subs && <div className="small muted">{sub ? `แสดงหน่วยของ ${sub.name} + หน่วยทั่วไป` : `ยังไม่ได้เลือก ${subs.label}: แสดงเฉพาะหน่วยทั่วไป`} · <button type="button" className="linkish" onClick={() => setPicker({ factionId: list.factionId })}>{sub ? `เปลี่ยน ${subs.label}` : `เลือก ${subs.label}`}</button></div>}
          <div className="ab-pick">
            {sheets.map((d) => {
              const count = list.units.filter((u) => u.datasheet === d.name).length;
              return (
                <div key={d.id} className="ab-row">
                  <button type="button" className="ab-row-main" onClick={() => setView(d.name)}>
                    <UnitArt sheet={d} />
                    <span className="ab-row-text">
                      <span className="ab-name">{d.name}{count ? <span className="ab-count"> ×{count}</span> : null}</span>
                      <span className="ab-pts">{pointsOptions(d).map((o) => `${o.models}: ${o.pts}`).join(' / ')} pts</span>
                      <span className="ab-sub">{d.subfaction && <span className="ab-chip">{subTag(d.subfaction)}</span>}{d.keywords.includes('EPIC HERO') ? 'Epic Hero · ' : ''}{d.role}</span>
                    </span>
                  </button>
                  <button type="button" className="ab-add dark" aria-label={`เพิ่ม ${d.name}`} onClick={() => addUnit(d)}>+</button>
                </div>
              );
            })}
            {!sheets.length && <div className="ab-empty">ไม่พบ datasheet</div>}
          </div>
        </div>
      </div>
    );
  };

  const unitMenu = () => {
    if (!menuUnit || !faction) return null;
    const u = menuUnit;
    const sheet = menuSheet;
    const opts = sheet ? pointsOptions(sheet) : [];
    const enh = enhancementOptions(list, faction, u);
    const bodyguards = attachOptions(list, faction, u);
    // the bodyguard's other character (a support beside a leader, or the leader beside a support)
    const partner = (b: ArmyUnitEntry) => list.units.find((o) => o.uid !== u.uid && o.attachTo === b.uid)?.datasheet;
    return (
      <div className="tray-backdrop" onClick={() => setMenu(null)}>
        <div className="tray" onClick={(e) => e.stopPropagation()}>
          <div className="row">
            <UnitArt sheet={sheet} />
            <div className="grow">
              <div className="sheet-title">{u.datasheet}</div>
              <div className="ab-pts">{unitPoints(u)} pts{u.wargearPts ? <span className="tiny muted"> (wargear +{u.wargearPts})</span> : null}</div>
            </div>
          </div>
          <div className="quick-acts">
            <button type="button" onClick={() => setView(u.datasheet)}><Icon name="hint" size={22} />Datasheet</button>
            {sheet?.keywords.includes('CHARACTER') && (
              <button type="button" className={u.warlord ? 'on' : ''} onClick={() => set({ units: list.units.map((x) => ({ ...x, warlord: x.uid === u.uid ? !u.warlord : false })) })}><Icon name="leader" size={22} />{u.warlord ? 'Warlord' : 'ตั้ง Warlord'}</button>
            )}
            <button type="button" onClick={() => { set({ units: [...list.units, { ...u, uid: newUid('e'), warlord: false, enhancement: undefined, enhancementPts: undefined, attachTo: undefined }] }); setMenu(null); setNote(`เพิ่ม ${u.datasheet} อีก 1`); }}><Icon name="duplicate" size={22} />ทำซ้ำ</button>
            <button type="button" className="danger" onClick={() => { removeUnit(u.uid); setMenu(null); }}><Icon name="delete" size={22} />ลบ</button>
          </div>
          {opts.length > 1 && (
            <div className="field"><span><Icon name="size" size={15} /> จำนวนโมเดล</span>
              <div className="seg">
                {opts.map((o) => <button key={o.models} className={u.models === o.models ? 'on' : ''} onClick={() => setUnit(u.uid, { models: o.models, pts: o.pts })}>{o.models} · {o.pts}</button>)}
              </div>
            </div>
          )}
          {(() => {
            // start the battle embarked: any transport in the list (leaders ride with the unit they lead)
            const rides = list.units.filter((t) => t.uid !== u.uid && parseTransport(sheetOf(t.datasheet)?.transport));
            if (!rides.length || u.attachTo || parseTransport(sheet?.transport) || sheet?.keywords.includes('TRANSPORT')) return null;
            const loads = faction ? transportLoads(list, faction) : [];
            return (
              <label className="field"><span><Icon name="embark" size={15} /> ขึ้นรถตอนเริ่มเกม</span>
                <select value={u.embarkIn ?? ''} onChange={(e) => setUnit(u.uid, { embarkIn: e.target.value || undefined })}>
                  <option value="">ไม่ขึ้นรถ (วางบนสนามเอง)</option>
                  {rides.map((t) => {
                    const l = loads.find((x) => x.uid === t.uid);
                    return <option key={t.uid} value={t.uid}>{t.datasheet} ({l ? `${l.used}/${l.capacity}` : '?'} ที่)</option>;
                  })}
                </select>
                <span className="tiny muted">ขึ้นรถตั้งแต่ Declare Battle Formations · ลงได้ใน Movement phase: Tactical (รถยังไม่เดิน ≤3" แล้วเดินต่อได้) / Rapid (รถเดินแล้ว ≤3" ชาร์จไม่ได้) / Combat (รถ engaged ≤6" hazard + battle-shock)</span>
              </label>
            );
          })()}
          {sheet && sheet.leads.length > 0 && (
            <label className="field"><span><Icon name="leader" size={15} /> {sheet.isSupport ? 'เข้าหน่วยเป็น Support (คู่กับ Leader อีกตัวได้)' : 'นำหน่วย (Leader)'}</span>
              <select value={u.attachTo ?? ''} onChange={(e) => setUnit(u.uid, { attachTo: e.target.value || undefined })}>
                <option value="">ไม่ผูก</option>
                {u.attachTo && !bodyguards.some((b) => b.uid === u.attachTo) && (() => { const b = list.units.find((x) => x.uid === u.attachTo); return b ? <option value={b.uid}>{b.datasheet} ({b.models})</option> : null; })()}
                {bodyguards.map((b) => <option key={b.uid} value={b.uid}>{b.datasheet} ({b.models}){partner(b) ? ` + ${partner(b)}` : ''}</option>)}
              </select>
            </label>
          )}
          {(enh.length > 0 || u.enhancement) && (
            <div className="field"><span><Icon name="enhancement" size={15} /> Enhancement <span className="tiny muted">แตะเพื่อใส่ / เอาออก</span></span>
              <div className="enh-list">
                {u.enhancement && !enh.some((o) => o.name === u.enhancement) && (
                  <button type="button" className="enh-card on" onClick={() => setUnit(u.uid, { enhancement: undefined, enhancementPts: undefined })}>
                    <span className="enh-head"><b>{u.enhancement}</b><span>ไม่มีใน detachment ที่เลือก · แตะเพื่อเอาออก</span></span>
                  </button>
                )}
                {enh.map((o) => {
                  const on = u.enhancement === o.name;
                  const taken = list.units.find((x) => x.uid !== u.uid && x.enhancement === o.name);
                  const fit = sheet ? enhancementFits(o.text, [...sheet.keywords, ...sheet.factionKeywords]) : null;
                  if (fit && !fit.ok && !on) return <div key={o.detachment + o.name} className="enh-card off"><span className="enh-head"><b>{o.name}</b><span>+{o.pts} pts</span></span><span className="enh-foot">ใช้ไม่ได้: เฉพาะ {fit.need}</span></div>;
                  return (
                    <button key={o.detachment + o.name} type="button" className={`enh-card ${on ? 'on' : ''} ${taken ? 'taken' : ''}`}
                      onClick={() => setUnit(u.uid, on ? { enhancement: undefined, enhancementPts: undefined } : { enhancement: o.name, enhancementPts: o.pts })}>
                      <span className="enh-head"><b>{o.name}</b><span>{on ? <><Icon name="check" size={15} /> ใช้อยู่</> : `+${o.pts} pts`}</span></span>
                      {o.text && <span className="enh-text">{o.text}</span>}
                      <span className="enh-foot">{o.detachment}{o.upgrade ? ' · Upgrade' : ''}{taken ? ` · ${taken.datasheet} ใช้อยู่ (ใช้ได้ครั้งเดียวต่อกองทัพ)` : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {sheet && <WargearEditor sheet={sheet} u={u} onChange={(patch) => setUnit(u.uid, patch)} />}
          {(() => {
            const sp = splitRuleOf(sheet, list.detachments);
            if (!sp) return null;
            return sp.must
              ? <div className="tiny muted">{sp.name}: {sp.label}</div>
              : <button className={`btn ${u.split ? 'on' : ''}`} onClick={() => setUnit(u.uid, { split: !u.split })}>{u.split && <Icon name="check" size={16} />}{sp.name}: {sp.label}</button>;
          })()}
          <div className="field"><span><Icon name="camera" size={15} /> รูปของหน่วยนี้</span>
            <div className="row">
              <label className="btn small">
                {sheet && getPortrait(sheet.name) ? 'เปลี่ยนรูป' : 'ใส่รูป'}
                <input type="file" accept="image/*" hidden onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f || !sheet) return;
                  try {
                    const ok = setPortrait(sheet.name, await fileToPortrait(f));
                    setNote(ok ? `ใส่รูปให้ ${sheet.name} แล้ว` : 'เก็บรูปถาวรไม่ได้ (พื้นที่เบราว์เซอร์เต็ม/ถูกบล็อก) — รูปจะหายเมื่อปิดหน้า');
                  } catch (err) { setNote(err instanceof Error ? err.message : 'อ่านรูปไม่ได้'); }
                }} />
              </label>
              {sheet && hasOwnPortrait(sheet.name) && <button className="btn small ghost" onClick={() => { setPortrait(sheet.name, null); setNote(getPortrait(sheet.name) ? 'ลบรูปของเครื่องนี้แล้ว (กลับไปใช้รูปจากเซิร์ฟเวอร์)' : 'ลบรูปแล้ว'); }}>ลบรูป</button>}
              <span className="tiny muted grow">ใช้กับทุกหน่วย {u.datasheet} (ทั้งการ์ดและ token บนสนาม)</span>
            </div>
          </div>
        </div>
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
            {step && <button className="btn small ghost" onClick={() => setPicker({ factionId: null })}>‹ Faction</button>}
            <div className="sheet-title grow">{step ? `${step.name}: เลือก ${subs?.label ?? 'sub-faction'}` : 'เลือก Faction'}</div>
            <button className="btn small ghost" onClick={() => setPicker(null)}>ปิด</button>
          </div>
          {!step && groups.map((g) => {
            const fs = index.factions.filter((f) => (f.group ?? 'Other') === g && f.datasheets > 0 && f.detachments > 0);
            if (!fs.length) return null;
            return (
              <div key={g} className="ab-fgroup">
                <div className="ab-fgroup-title">{g}</div>
                <div className="ab-fgrid">
                  {fs.map((f) => (
                    <button key={f.id} type="button" className={`ab-fcard ${f.id === list.factionId ? 'on' : ''}`}
                      onClick={() => (f.subfactions?.length ? (f.id === list.factionId ? setPicker({ factionId: f.id }) : (choose(f.id), setPicker({ factionId: f.id }))) : choose(f.id))}>
                      <Emblem factionId={f.id} color={f.id === list.factionId ? sub?.color : undefined} />
                      <span className="ab-fname">{f.name}</span>
                      {f.subfactions?.length ? <span className="ab-sub">{f.subfactions.length} sub-factions ›</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {step && !opts && <div className="ab-empty">กำลังโหลด…</div>}
          {step && opts && (
            <>
              {list.units.length > 0 && <div className="small muted">เปลี่ยน {subs!.label}: หน่วยและ detachment ของ {subs!.label} อื่นจะถูกเอาออก หน่วยทั่วไปอยู่ครบ</div>}
              <div className="ab-fgrid">
                <button type="button" className={`ab-fcard ${!list.subfaction ? 'on' : ''}`} onClick={() => choose(step.id, undefined)}>
                  <Emblem factionId={step.id} />
                  <span className="ab-fname">ไม่ระบุ {subs!.label}</span>
                  <span className="ab-sub">หน่วยทั่วไปเท่านั้น</span>
                </button>
                {opts.map((o) => {
                  const nU = faction!.datasheets.filter((d) => d.subfaction === o.keyword).length;
                  const nD = faction!.detachments.filter((d) => d.subfaction === o.keyword).length;
                  return (
                    <button key={o.keyword} type="button" className={`ab-fcard ${list.subfaction === o.keyword ? 'on' : ''}`} onClick={() => choose(step.id, o.keyword)}>
                      <Emblem factionId={step.id} color={o.color} />
                      <span className="ab-fname">{o.name}</span>
                      <span className="ab-sub">{nU} หน่วยเฉพาะ · {nD} detachment</span>
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
    <div className="ab">
      <header className="ab-top">
        <button type="button" className="ab-icon" aria-label="กลับ" onClick={onDone}>‹</button>
        <div className="ab-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>List</button>
          <button role="tab" aria-selected={tab === 'detachment'} className={tab === 'detachment' ? 'on' : ''} onClick={() => setTab('detachment')}>Detachment</button>
        </div>
        <button type="button" className="ab-icon" aria-label="แชร์รายชื่อกองทัพ" onClick={share}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
          </svg>
        </button>
      </header>
      <div className="ab-body">
        <div className="ab-head">
          <button type="button" className="ab-emblem-btn" aria-label="เลือก faction" onClick={() => setPicker({ factionId: null })}><Emblem factionId={list.factionId} color={sub?.color} /></button>
          <div className="grow">
            <input className="ab-title" aria-label="ชื่อกองทัพ" value={list.name} placeholder="ตั้งชื่อกองทัพ" onChange={(e) => set({ name: e.target.value })} />
            <div className="ab-det-name">{list.detachments.join(' · ') || <button type="button" className="linkish" onClick={() => setTab('detachment')}>เลือก detachment</button>}</div>
            <button type="button" className="ab-faction" onClick={() => setPicker({ factionId: subs ? list.factionId : null })}>
              {factionName}{subs ? ` · ${sub?.name ?? `เลือก ${subs.label}`}` : ''} ›
            </button>
          </div>
          <div className={`ab-total ${pts > size.points ? 'over' : ''}`}>{pts}/{size.points}<small> pts</small></div>
        </div>
        {!faction && <div className="ab-empty">กำลังโหลดข้อมูล…</div>}
        {faction && (tab === 'list' ? listTab() : detachmentTab())}
      </div>
      {note && <div className="toast ab-toast">{note}</div>}
      {addSheet()}
      {unitMenu()}
      {pickerSheet()}
      {view && faction && sheetOf(view) && (
        <div className="tray-backdrop" onClick={() => setView(null)}>
          <div className="tray" onClick={(e) => e.stopPropagation()}>
            <DatasheetView sheet={sheetOf(view)!} factionId={faction?.id} />
            <button className="btn" onClick={() => setView(null)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
