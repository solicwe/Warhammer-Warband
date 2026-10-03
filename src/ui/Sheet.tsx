import { abilityStatus, type AbilityStatus } from '../engine/effects';
import { strength } from '../engine/state';
import type { AbilityData, DatasheetData, ModelProfileData, UnitState, WeaponData } from '../engine/types';
import { abilitiesOf, abilityLabel } from '../engine/weapons';
import { Portrait, tokenKind } from './Tokens';
import { usePastePortrait } from './portraits';
import { Icon, type IconName } from './Icon';

/** The characteristics band, laid out like the printed datasheet: framed boxes, the invulnerable save as a shield. */
function Stats({ p }: { p: ModelProfileData }) {
  const cells: [string, string][] = [['M', p.M != null ? `${p.M}"` : '-'], ['T', String(p.T)], ['Sv', `${p.Sv}+`], ['W', String(p.W)], ['Ld', `${p.Ld}+`], ['OC', p.OC != null ? String(p.OC) : '-']];
  return (
    <div className="ds-stats">
      <div className="ds-statrow">
        {cells.map(([k, v]) => <div key={k} className="ds-stat"><span>{k}</span><b>{v}</b></div>)}
      </div>
      {p.InSv ? <div className="ds-inv"><span className="ds-shield">{p.InSv}+</span><span>INVULNERABLE SAVE</span></div> : null}
    </div>
  );
}

function WeaponTable({ rows, melee }: { rows: { w: WeaponData; p: WeaponData['profiles'][number]; n: number }[]; melee: boolean }) {
  if (!rows.length) return null;
  return (
    <table className="wtable ds-wt">
      <thead>
        <tr>
          <th><Icon name={melee ? 'fight' : 'shoot'} size={15} /> {melee ? 'MELEE WEAPONS' : 'RANGED WEAPONS'}</th>
          <th>RANGE</th><th>A</th><th>{melee ? 'WS' : 'BS'}</th><th>S</th><th>AP</th><th>D</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ w, p, n }, i) => (
          <tr key={i}>
            <td>
              {n > 1 ? `${n}× ` : ''}{w.name}{p.name !== w.name ? ` – ${p.name}` : ''}
              {p.abilities.length > 0 && <div className="ds-wkw">[{abilitiesOf(p).map(abilityLabel).join(', ').toUpperCase()}]</div>}
            </td>
            <td>{p.range === 'Melee' ? 'Melee' : `${p.range}"`}</td>
            <td>{p.A}</td>
            <td>{p.skill ? `${p.skill}+` : 'N/A'}</td>
            <td>{p.S}</td>
            <td>{p.AP}</td>
            <td>{p.D}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Weapons({ weapons }: { weapons: WeaponData[] }) {
  // a weapon carried twice (2 godhammer lascannons) shows once as "2×"
  const counted = [...new Map(weapons.map((w) => [w.name, w])).values()].map((w) => ({ w, n: weapons.filter((x) => x.name === w.name).length }));
  const rows = counted.flatMap(({ w, n }) => w.profiles.map((p) => ({ w, p, n })));
  return (
    <>
      <WeaponTable rows={rows.filter((r) => r.p.range !== 'Melee')} melee={false} />
      <WeaponTable rows={rows.filter((r) => r.p.range === 'Melee')} melee />
    </>
  );
}

const ST_LABEL: Record<AbilityStatus, string> = { auto: 'ระบบทำให้', partial: 'ระบบทำบางส่วน', manual: 'ทำเอง', info: 'ข้อมูล', none: 'ยังไม่อัตโนมัติ', core: '' };
const ST_ICON: Partial<Record<AbilityStatus, IconName>> = { auto: 'check', partial: 'partial', manual: 'hand', none: 'hand' };

/** Badge saying whether the app plays this ability by itself. */
function AbilityBadge({ u, a }: { u: UnitState; a: AbilityData }) {
  const st = abilityStatus(u, a);
  if (st.status === 'core') return null;
  const ic = ST_ICON[st.status];
  return (
    <>
      {' '}<span className={`ab-st ${st.status}`}>{ic && <Icon name={ic} size={12} />} {ST_LABEL[st.status]}</span>
      {st.note && <span className="tiny muted"> {st.note}</span>}
    </>
  );
}

export function DatasheetView({ sheet, factionId }: { sheet: DatasheetData; factionId?: string }) {
  const probe = { sources: [sheet.name], abilities: [] } as unknown as UnitState;
  usePastePortrait(sheet.name);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="ds-head">
        <Portrait kind={tokenKind(sheet.keywords, sheet.factionKeywords)} owner={0} character={sheet.keywords.includes('CHARACTER')} size={60} datasheet={sheet.name} editable />
        <div className="grow">
          <h2>{sheet.name}</h2>
          <div className="tiny">{sheet.role}{sheet.keywords.includes('EPIC HERO') ? ' · Epic Hero' : ''} · แตะรูปหรือวาง (Paste) เพื่อใส่รูป</div>
        </div>
      </div>
      {sheet.models.map((m) => (
        <div key={m.name}>
          {sheet.models.length > 1 && <div className="small muted">{m.name} · ฐาน {m.base.text}</div>}
          <Stats p={m} />
        </div>
      ))}
      <Weapons weapons={sheet.weapons} />
      <div className="ds-sec">ABILITIES</div>
      {(['Core', 'Faction'] as const).map((t) => {
        const xs = sheet.abilities.filter((a) => a.type === t);
        return xs.length ? <div key={t} className="ds-line">{t.toUpperCase()}: <b>{xs.map((a) => `${a.name}${a.param ? ` ${a.param}` : ''}`).join(', ')}</b></div> : null;
      })}
      {sheet.abilities.filter((a) => a.type !== 'Core' && a.type !== 'Faction').map((a, i) => (
        <div key={i} className="ds-ab"><b>{a.name}{a.param ? ` ${a.param}` : ''}:</b>{factionId && <AbilityBadge u={probe} a={{ ...a, sheet: sheet.name, faction: factionId }} />} {a.text}</div>
      ))}
      {sheet.damaged && <div className="ds-ab"><b>DAMAGED: 1-{sheet.damaged.w} WOUNDS REMAINING:</b> {sheet.damaged.text}</div>}
      <div className="ds-sec">UNIT COMPOSITION</div>
      <div className="ds-body">
        {sheet.composition.map((c) => <div key={c.text}>• <b>{c.text}</b></div>)}
        <div><b>This model is equipped with:</b> {sheet.loadoutText.replace(/^.*?equipped with:\s*/i, '')}</div>
      </div>
      {sheet.leads.length > 0 && (
        <>
          <div className="ds-sec">LEADER</div>
          <div className="ds-body">ผูกเข้ากับหน่วยเหล่านี้ได้:{sheet.leads.map((l) => <div key={l} className="ds-lead">• {l}</div>)}</div>
        </>
      )}
      <div className="ds-kw"><span>FACTION KEYWORDS:</span> {sheet.factionKeywords.join(', ')}</div>
      <div className="kw ds-kw2">KEYWORDS: {sheet.keywords.join(', ')}</div>
      {sheet.options.length > 0 && <details><summary className="small">Wargear options</summary>{sheet.options.map((o, i) => <div key={i} className="small">• {o}</div>)}</details>}
      <div className="tiny muted">Data: Wahapedia (<a href={sheet.link} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>ดูต้นฉบับ</a>)</div>
    </div>
  );
}

export function UnitView({ u }: { u: UnitState }) {
  usePastePortrait(u.models.find((m) => m.isCharacter)?.source ?? u.sources[0]);
  const groups = new Map<string, { p: ModelProfileData; n: number; weapons: WeaponData[]; name: string; gear: string[] }>();
  for (const m of u.models) {
    if (m.dead) continue;
    // models with different wargear are listed separately
    const k = [m.source, m.name, m.profile.W, m.profile.InSv, ...m.weapons.map((w) => w.name), ...(m.gear ?? [])].join('|');
    const g = groups.get(k) ?? { p: m.profile, n: 0, weapons: m.weapons, name: m.name, gear: m.gear ?? [] };
    g.n += 1;
    groups.set(k, g);
  }
  const st = strength(u);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="ds-head">
        {u.sources.map((src) => (
          <Portrait key={src} kind={tokenKind(u.models.find((m) => m.source === src)?.keywords ?? u.keywords, u.factionKeywords)} owner={u.owner} character={u.models.some((m) => m.source === src && m.isCharacter)} size={56} datasheet={src} editable />
        ))}
        <div className="grow">
          <h2>{u.name}</h2>
          <div className="tiny">แตะรูปหรือวาง (Paste) เพื่อใส่รูป · เก็บในเครื่องนี้</div>
        </div>
      </div>
      <div className="row small">
        <span className="chip">{u.models.filter((m) => !m.dead).length}/{u.startingStrength} models</span>
        {(st === 'half' || st === 'belowHalf') && <span className="chip warn">{st === 'half' ? 'Half-strength' : 'Below half'}</span>}
        {u.battleShocked && <span className="chip warn">Battle-shocked (OC −, ห้ามใช้ stratagem)</span>}
        {u.core.fnp && <span className="chip">FNP {u.core.fnp}+</span>}
        {u.core.stealth && <span className="chip">Stealth</span>}
        {u.core.deepStrike && <span className="chip">Deep Strike</span>}
        {u.buffs.map((b, i) => <span key={i} className="chip">{b.label ?? b.kind}</span>)}
      </div>
      {[...groups.values()].map((g, i) => (
        <div key={i}>
          <div className="small muted">{g.n}× {g.name}{g.gear.length ? ` · ${g.gear.join(', ')}` : ''}</div>
          <Stats p={g.p} />
          <Weapons weapons={g.weapons} />
        </div>
      ))}
      {u.enhancements.map((e) => (
        <div key={e.name} className="sheet"><b>Enhancement: {e.name}</b> <span className="tiny muted">({e.model})</span>{'\n'}{e.text}</div>
      ))}
      {u.abilities.map((a, i) => (
        <div key={i} className="sheet"><b>{a.name}{a.param ? ` ${a.param}` : ''}</b> <span className="tiny muted">({a.type}{a.model ? ` · ${a.model}` : ''})</span><AbilityBadge u={u} a={a} />{a.text ? `\n${a.text}` : ''}</div>
      ))}
      <div className="kw">{[...u.factionKeywords, ...u.keywords].join(', ')}</div>
    </div>
  );
}
