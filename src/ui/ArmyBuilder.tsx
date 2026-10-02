import { useEffect, useMemo, useState } from 'react';
import { enhancementOptions, listPoints, newUid, pointsOptions, validateList } from '../engine/army';
import { RULES } from '../engine/config';
import type { ArmyList, ArmyUnitEntry, DatasheetData, FactionData } from '../engine/types';
import { loadFaction, loadIndex, type FactionIndex } from './data';
import { DatasheetView } from './Sheet';
import { tokenKind } from './Tokens';
import { fileToPortrait, getPortrait, matchDatasheet, setPortrait, usePortraitsVersion } from './portraits';

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
function Emblem({ factionId }: { factionId: string }) {
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
          <path d="M32 12 L48 18 L46 38 Q44 48 32 54 Q20 48 18 38 L16 18 Z" fill="#1f4a8f" stroke="#d9b44a" strokeWidth="2.5" />
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

export function ArmyBuilder({ list, onChange, onDone }: Props) {
  const [index, setIndex] = useState<FactionIndex | null>(null);
  const [faction, setFaction] = useState<FactionData | null>(null);
  const [tab, setTab] = useState<'list' | 'detachment'>('list');
  const [adding, setAdding] = useState<Section | null>(null);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<string | null>(null); // uid of the unit whose ⋮ menu is open
  const [view, setView] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [imported, setImported] = useState<{ ok: string[]; missed: { file: File; name: string }[] } | null>(null);

  useEffect(() => { loadIndex().then(setIndex).catch(() => setNote('โหลดรายชื่อ faction ไม่ได้')); }, []);
  useEffect(() => { setFaction(null); loadFaction(list.factionId).then(setFaction).catch(() => setNote('โหลดข้อมูล faction ไม่ได้')); }, [list.factionId]);
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNote(null), 2400); return () => window.clearTimeout(t); }, [note]);

  const size = RULES.battleSizes.find((b) => b.id === list.battleSize) ?? RULES.battleSizes[0];
  const errors = useMemo(() => (faction ? validateList(list, faction, size) : []), [list, faction, size]);
  const pts = listPoints(list);
  const dpUsed = faction ? list.detachments.reduce((a, n) => a + (faction.detachments.find((d) => d.name === n)?.dp ?? 0), 0) : 0;
  const sheetOf = (name: string) => faction?.datasheets.find((d) => d.name === name);
  const factionName = index?.factions.find((f) => f.id === list.factionId)?.name ?? faction?.name ?? list.factionId;

  const set = (patch: Partial<ArmyList>) => onChange({ ...list, ...patch });
  const setUnit = (uid: string, patch: Partial<ArmyUnitEntry>) => set({ units: list.units.map((x) => (x.uid === uid ? { ...x, ...patch } : x)) });
  const removeUnit = (uid: string) => set({ units: list.units.filter((x) => x.uid !== uid).map((x) => (x.attachTo === uid ? { ...x, attachTo: undefined } : x)) });
  const addUnit = (d: DatasheetData) => {
    const opt = pointsOptions(d)[0];
    if (!opt) return;
    set({ units: [...list.units, { uid: newUid('e'), datasheet: d.name, models: opt.models, pts: opt.pts }] });
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
      `${list.name || 'Army list'} — ${factionName}`,
      `${list.detachments.join(', ') || 'ไม่มี detachment'} · ${pts}/${size.points} pts`,
      '',
      ...SECTIONS.flatMap((sec) => {
        const us = list.units.filter((u) => sectionOf(sheetOf(u.datasheet)) === sec.id);
        if (!us.length) return [];
        return [`${sec.title.toUpperCase()}`, ...us.map((u) => `• ${u.datasheet} (${u.models}) — ${u.pts + (u.enhancementPts ?? 0)} pts${u.warlord ? ' · Warlord' : ''}${u.enhancement ? ` · ${u.enhancement}` : ''}`), ''];
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
    const sub = [u.warlord && 'Warlord', u.enhancement, leads && `นำ ${leads.datasheet}`].filter(Boolean).join(' · ');
    return (
      <div key={u.uid} className="ab-row">
        <button type="button" className="ab-row-main" onClick={() => setView(u.datasheet)}>
          <UnitArt sheet={sheet} />
          <span className="ab-row-text">
            <span className="ab-name">{u.datasheet} <span className="ab-count">({u.models})</span></span>
            <span className="ab-pts">{u.pts + (u.enhancementPts ?? 0)} pts</span>
            {sub && <span className="ab-sub">{sub}</span>}
          </span>
        </button>
        <button type="button" className="ab-kebab" aria-label={`ตัวเลือก ${u.datasheet}`} onClick={() => setMenu(u.uid)}>⋮</button>
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
        <label className="field">Faction
          <select value={list.factionId} onChange={(e) => set({ factionId: e.target.value, detachments: [], units: [] })}>
            {index?.factions.filter((f) => f.datasheets > 0).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="field">Battle size
          <select value={list.battleSize} onChange={(e) => set({ battleSize: e.target.value })}>
            {RULES.battleSizes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.points} pts · {b.dp} DP)</option>)}
          </select>
        </label>
      </div>
      <div className="card">
        <div className="card-title">Detachments <span className="muted small">{dpUsed}/{size.dp} DP</span></div>
        {faction.detachments.filter((d) => d.forceDisposition).map((d) => {
          const on = list.detachments.includes(d.name);
          return (
            <div key={d.id} className={`ab-det ${on ? 'on' : ''}`}>
              <button type="button" className="ab-det-head" onClick={() => set({ detachments: on ? list.detachments.filter((x) => x !== d.name) : [...list.detachments, d.name] })}>
                <span className="ab-check">{on ? '✓' : ''}</span>
                <span className="grow">
                  <span className="ab-name">{d.name}</span>
                  <span className="ab-sub">{d.dp} DP · {d.forceDisposition} · {d.enhancements.length} enhancements · {d.stratagems.length} stratagems</span>
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
        <label className="btn small" style={{ alignSelf: 'flex-start' }}>
          นำเข้ารูป
          <input type="file" accept="image/*" multiple hidden onChange={(e) => importPhotos(e.target.files)} />
        </label>
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
      .filter((d) => !d.keywords.includes('AIRCRAFT') && sectionOf(d) === adding && d.name.toLowerCase().includes(q.toLowerCase()) && pointsOptions(d).length)
      .sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div className="tray-backdrop" onClick={() => setAdding(null)}>
        <div className="tray" onClick={(e) => e.stopPropagation()}>
          <div className="row">
            <div className="sheet-title grow">เพิ่ม {title}</div>
            <button className="btn small ghost" onClick={() => setAdding(null)}>ปิด</button>
          </div>
          <input placeholder="ค้นหา datasheet…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                      <span className="ab-sub">{d.keywords.includes('EPIC HERO') ? 'Epic Hero · ' : ''}{d.role}</span>
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
    const bodyguards = list.units.filter((b) => b.uid !== u.uid && !b.attachTo && sheet?.leads.includes(b.datasheet));
    return (
      <div className="tray-backdrop" onClick={() => setMenu(null)}>
        <div className="tray" onClick={(e) => e.stopPropagation()}>
          <div className="row">
            <UnitArt sheet={sheet} />
            <div className="grow">
              <div className="sheet-title">{u.datasheet}</div>
              <div className="ab-pts">{u.pts + (u.enhancementPts ?? 0)} pts</div>
            </div>
          </div>
          {opts.length > 1 && (
            <div className="field">จำนวนโมเดล
              <div className="seg">
                {opts.map((o) => <button key={o.models} className={u.models === o.models ? 'on' : ''} onClick={() => setUnit(u.uid, { models: o.models, pts: o.pts })}>{o.models} · {o.pts}</button>)}
              </div>
            </div>
          )}
          {sheet && sheet.leads.length > 0 && (
            <label className="field">นำหน่วย (Leader)
              <select value={u.attachTo ?? ''} onChange={(e) => setUnit(u.uid, { attachTo: e.target.value || undefined })}>
                <option value="">ไม่ผูก</option>
                {bodyguards.map((b) => <option key={b.uid} value={b.uid}>{b.datasheet} ({b.models})</option>)}
              </select>
            </label>
          )}
          {(enh.length > 0 || u.enhancement) && (
            <label className="field">Enhancement
              <select value={u.enhancement ?? ''} onChange={(e) => {
                const x = enh.find((o) => o.name === e.target.value);
                setUnit(u.uid, { enhancement: x?.name, enhancementPts: x?.pts });
              }}>
                <option value="">ไม่มี</option>
                {u.enhancement && !enh.some((o) => o.name === u.enhancement) && <option value={u.enhancement}>{u.enhancement}</option>}
                {enh.map((o) => <option key={o.detachment + o.name} value={o.name}>{o.name} (+{o.pts}){o.upgrade ? ' [Upgrade]' : ''}</option>)}
              </select>
            </label>
          )}
          {sheet?.keywords.includes('CHARACTER') && (
            <button className={`btn ${u.warlord ? 'on' : ''}`} onClick={() => set({ units: list.units.map((x) => ({ ...x, warlord: x.uid === u.uid ? !u.warlord : false })) })}>
              {u.warlord ? 'Warlord ✓' : 'ตั้งเป็น Warlord'}
            </button>
          )}
          <div className="row">
            <button className="btn grow" onClick={() => { setView(u.datasheet); }}>ดู datasheet</button>
            <button className="btn grow" onClick={() => { set({ units: [...list.units, { ...u, uid: newUid('e'), warlord: false, enhancement: undefined, enhancementPts: undefined, attachTo: undefined }] }); setMenu(null); setNote(`เพิ่ม ${u.datasheet} อีก 1`); }}>ทำซ้ำ</button>
          </div>
          <button className="btn danger" onClick={() => { removeUnit(u.uid); setMenu(null); }}>ลบหน่วยนี้</button>
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
          <Emblem factionId={list.factionId} />
          <div className="grow">
            <input className="ab-title" aria-label="ชื่อกองทัพ" value={list.name} placeholder="ตั้งชื่อกองทัพ" onChange={(e) => set({ name: e.target.value })} />
            <div className="ab-det-name">{list.detachments.join(' · ') || <button type="button" className="linkish" onClick={() => setTab('detachment')}>เลือก detachment</button>}</div>
            <div className="ab-faction">{factionName}</div>
          </div>
          <div className={`ab-total ${pts > size.points ? 'over' : ''}`}>{pts}/{size.points}<small> pts</small></div>
        </div>
        {!faction && <div className="ab-empty">กำลังโหลดข้อมูล…</div>}
        {faction && (tab === 'list' ? listTab() : detachmentTab())}
      </div>
      {note && <div className="toast ab-toast">{note}</div>}
      {addSheet()}
      {unitMenu()}
      {view && faction && sheetOf(view) && (
        <div className="tray-backdrop" onClick={() => setView(null)}>
          <div className="tray" onClick={(e) => e.stopPropagation()}>
            <DatasheetView sheet={sheetOf(view)!} />
            <button className="btn" onClick={() => setView(null)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
