import { useEffect, useMemo, useState } from 'react';
import { enhancementOptions, listPoints, newUid, pointsOptions, validateList } from '../engine/army';
import { RULES } from '../engine/config';
import type { ArmyList, FactionData } from '../engine/types';
import { loadFaction, loadIndex, type FactionIndex } from './data';
import { DatasheetView } from './Sheet';
import { Portrait, tokenKind } from './Tokens';

interface Props {
  list: ArmyList;
  onChange: (l: ArmyList) => void;
  onDone: () => void;
}

export function ArmyBuilder({ list, onChange, onDone }: Props) {
  const [index, setIndex] = useState<FactionIndex | null>(null);
  const [faction, setFaction] = useState<FactionData | null>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState<string | null>(null);
  useEffect(() => { loadIndex().then(setIndex); }, []);
  useEffect(() => { setFaction(null); loadFaction(list.factionId).then(setFaction); }, [list.factionId]);

  const size = RULES.battleSizes.find((b) => b.id === list.battleSize) ?? RULES.battleSizes[0];
  const errors = useMemo(() => (faction ? validateList(list, faction, size) : []), [list, faction, size]);
  const pts = listPoints(list);
  const dpUsed = faction ? list.detachments.reduce((a, n) => a + (faction.detachments.find((d) => d.name === n)?.dp ?? 0), 0) : 0;

  const set = (patch: Partial<ArmyList>) => onChange({ ...list, ...patch });
  const sheets = faction?.datasheets.filter((d) => !d.keywords.includes('AIRCRAFT') && d.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)) ?? [];

  return (
    <div className="screen">
      <div className="row">
        <button className="btn small" onClick={onDone}>กลับ</button>
        <h2 className="grow" style={{ margin: 0 }}>จัดทัพ</h2>
        <span className={pts > size.points ? 'err' : 'muted'}>{pts}/{size.points} pts</span>
      </div>

      <div className="card row">
        <select className="grow" value={list.factionId} onChange={(e) => set({ factionId: e.target.value, detachments: [], units: [] })}>
          {index?.factions.filter((f) => f.datasheets > 0).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={list.battleSize} onChange={(e) => set({ battleSize: e.target.value })}>
          {RULES.battleSizes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.points})</option>)}
        </select>
      </div>

      {!faction && <div className="muted">กำลังโหลดข้อมูล…</div>}
      {faction && (
        <>
          <div className="card">
            <h3>Detachments <span className="muted small">({dpUsed}/{size.dp} DP)</span></h3>
            {faction.detachments.filter((d) => d.forceDisposition).map((d) => {
              const on = list.detachments.includes(d.name);
              return (
                <label key={d.id} className="list-item" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => set({ detachments: on ? list.detachments.filter((x) => x !== d.name) : [...list.detachments, d.name] })} />
                  <div className="grow">
                    <div>{d.name}</div>
                    <div className="tiny muted">{d.dp} DP · {d.forceDisposition} · {d.stratagems.length} stratagems · {d.enhancements.length} enhancements</div>
                    {on && (
                      <details onClick={(e) => e.stopPropagation()}>
                        <summary className="tiny">ดูกฎ / enhancements / stratagems</summary>
                        {d.rules.map((r) => <div key={r.name} className="sheet tiny"><b>{r.name}</b>{'\n'}{r.text}</div>)}
                        {d.enhancements.map((e) => <div key={e.name} className="sheet tiny"><b>{e.name}</b> ({e.pts} pts{e.upgrade ? ', Upgrade' : ''}){'\n'}{e.text}</div>)}
                        {d.stratagems.map((st) => <div key={st.name} className="sheet tiny"><b>{st.name}</b> ({st.cp}CP · {st.type}){'\n'}{st.text}</div>)}
                      </details>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="card">
            <h3>หน่วยในกองทัพ ({list.units.length})</h3>
            {list.units.map((u) => {
              const sheet = faction.datasheets.find((d) => d.name === u.datasheet);
              const bodyguards = list.units.filter((b) => b.uid !== u.uid && !b.attachTo && sheet?.leads.includes(b.datasheet));
              return (
                <div key={u.uid} className="list-item" style={{ flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 150 }}>
                    <div style={{ fontWeight: 600 }} onClick={() => setView(u.datasheet)}>{u.datasheet}{u.warlord ? ' · Warlord' : ''}</div>
                    <div className="tiny muted">{u.models} models · {u.pts + (u.enhancementPts ?? 0)} pts{u.enhancement ? ` · ${u.enhancement}` : ''}</div>
                  </div>
                  {sheet && pointsOptions(sheet).length > 1 && (
                    <select value={u.models} onChange={(e) => {
                      const o = pointsOptions(sheet).find((x) => x.models === +e.target.value)!;
                      set({ units: list.units.map((x) => (x.uid === u.uid ? { ...x, models: o.models, pts: o.pts } : x)) });
                    }}>
                      {pointsOptions(sheet).map((o) => <option key={o.models} value={o.models}>{o.models} ({o.pts})</option>)}
                    </select>
                  )}
                  {sheet && sheet.leads.length > 0 && (
                    <select value={u.attachTo ?? ''} onChange={(e) => set({ units: list.units.map((x) => (x.uid === u.uid ? { ...x, attachTo: e.target.value || undefined } : x)) })}>
                      <option value="">ไม่ผูก</option>
                      {bodyguards.map((b) => <option key={b.uid} value={b.uid}>นำ {b.datasheet}</option>)}
                    </select>
                  )}
                  {enhancementOptions(list, faction, u).length > 0 && (
                    <select value={u.enhancement ?? ''} style={{ maxWidth: 170 }} onChange={(e) => {
                      const enh = enhancementOptions(list, faction, u).find((x) => x.name === e.target.value);
                      set({ units: list.units.map((x) => (x.uid === u.uid ? { ...x, enhancement: enh?.name, enhancementPts: enh?.pts } : x)) });
                    }}>
                      <option value="">Enhancement</option>
                      {enhancementOptions(list, faction, u).map((e) => <option key={e.detachment + e.name} value={e.name}>{e.name} (+{e.pts}){e.upgrade ? ' [Upgrade]' : ''}</option>)}
                    </select>
                  )}
                  {sheet?.keywords.includes('CHARACTER') && (
                    <button className={`btn small ${u.warlord ? 'on' : ''}`} onClick={() => set({ units: list.units.map((x) => ({ ...x, warlord: x.uid === u.uid })) })}>Warlord</button>
                  )}
                  <button className="btn small danger" onClick={() => set({ units: list.units.filter((x) => x.uid !== u.uid).map((x) => (x.attachTo === u.uid ? { ...x, attachTo: undefined } : x)) })}>✕</button>
                </div>
              );
            })}
            {errors.map((e) => <div key={e} className="err">{e}</div>)}
          </div>

          <div className="card">
            <h3>เพิ่มหน่วย</h3>
            <input placeholder="ค้นหา datasheet…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
            <div className="scroll" style={{ maxHeight: 320 }}>
              {sheets.map((d) => {
                const opt = pointsOptions(d)[0];
                return (
                  <div key={d.id} className="list-item">
                    <Portrait kind={tokenKind(d.keywords, d.factionKeywords)} owner={0} character={d.keywords.includes('CHARACTER')} size={34} datasheet={d.name} />
                    <div className="grow" onClick={() => setView(d.name)}>
                      <div>{d.name}</div>
                      <div className="tiny muted">{d.keywords.includes('EPIC HERO') ? 'Epic Hero · ' : ''}{d.role} · {pointsOptions(d).map((o) => `${o.models}: ${o.pts}`).join(' / ')}</div>
                    </div>
                    <button className="btn small" disabled={!opt} onClick={() => set({ units: [...list.units, { uid: newUid('e'), datasheet: d.name, models: opt.models, pts: opt.pts }] })}>+</button>
                  </div>
                );
              })}
            </div>
          </div>
          <button className="btn primary" onClick={onDone}>เสร็จ</button>
        </>
      )}
      {view && faction && (
        <div className="tray-backdrop" onClick={() => setView(null)}>
          <div className="tray" onClick={(e) => e.stopPropagation()}>
            <DatasheetView sheet={faction.datasheets.find((d) => d.name === view)!} />
            <button className="btn" onClick={() => setView(null)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
