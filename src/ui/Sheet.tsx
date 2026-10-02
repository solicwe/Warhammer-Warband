import { strength } from '../engine/state';
import type { DatasheetData, ModelProfileData, UnitState, WeaponData } from '../engine/types';
import { abilitiesOf, abilityLabel } from '../engine/weapons';
import { Portrait, tokenKind } from './Tokens';

function Stats({ p }: { p: ModelProfileData }) {
  return (
    <div className="stats">
      <div>M<b>{p.M ?? '-'}"</b></div>
      <div>T<b>{p.T}</b></div>
      <div>Sv<b>{p.Sv}+</b></div>
      <div>InSv<b>{p.InSv ? `${p.InSv}+` : '-'}</b></div>
      <div>W<b>{p.W}</b></div>
      <div>Ld<b>{p.Ld}+</b></div>
      <div>OC<b>{p.OC ?? '-'}</b></div>
    </div>
  );
}

function Weapons({ weapons }: { weapons: WeaponData[] }) {
  const rows = weapons.flatMap((w) => w.profiles.map((p) => ({ w, p })));
  return (
    <table className="wtable">
      <thead><tr><th>อาวุธ</th><th>R</th><th>A</th><th>BS/WS</th><th>S</th><th>AP</th><th>D</th></tr></thead>
      <tbody>
        {rows.map(({ w, p }, i) => (
          <tr key={i}>
            <td>
              {w.name}{p.name !== w.name ? ` – ${p.name}` : ''}
              {p.abilities.length > 0 && <div className="kw">[{abilitiesOf(p).map(abilityLabel).join(', ')}]</div>}
            </td>
            <td>{p.range === 'Melee' ? 'M' : `${p.range}"`}</td>
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

export function DatasheetView({ sheet }: { sheet: DatasheetData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <Portrait kind={tokenKind(sheet.keywords, sheet.factionKeywords)} owner={0} character={sheet.keywords.includes('CHARACTER')} size={56} />
        <h2 style={{ margin: 0 }}>{sheet.name}</h2>
      </div>
      {sheet.models.map((m) => (
        <div key={m.name}>
          {sheet.models.length > 1 && <div className="small muted">{m.name} · ฐาน {m.base.text}</div>}
          <Stats p={m} />
        </div>
      ))}
      <Weapons weapons={sheet.weapons} />
      <div className="small"><b>Loadout:</b> {sheet.loadoutText}</div>
      {sheet.composition.length > 0 && <div className="small"><b>Unit:</b> {sheet.composition.map((c) => c.text).join(', ')}</div>}
      {sheet.leads.length > 0 && <div className="small"><b>Leader ของ:</b> {sheet.leads.join(', ')}</div>}
      {sheet.abilities.map((a, i) => (
        <div key={i} className="sheet"><b>{a.name}{a.param ? ` ${a.param}` : ''}</b> <span className="tiny muted">({a.type})</span>{a.text ? `\n${a.text}` : ''}</div>
      ))}
      {sheet.damaged && <div className="sheet"><b>Damaged {sheet.damaged.w}:</b> {sheet.damaged.text}</div>}
      <div className="kw">{[...sheet.factionKeywords, ...sheet.keywords].join(', ')}</div>
      {sheet.options.length > 0 && <details><summary className="small">Wargear options</summary>{sheet.options.map((o, i) => <div key={i} className="small">• {o}</div>)}</details>}
      <div className="tiny muted">Data: Wahapedia (<a href={sheet.link} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>ดูต้นฉบับ</a>)</div>
    </div>
  );
}

export function UnitView({ u }: { u: UnitState }) {
  const groups = new Map<string, { p: ModelProfileData; n: number; weapons: WeaponData[] }>();
  for (const m of u.models) {
    if (m.dead) continue;
    const k = m.source + m.profile.name;
    const g = groups.get(k) ?? { p: m.profile, n: 0, weapons: m.weapons };
    g.n += 1;
    groups.set(k, g);
  }
  const st = strength(u);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2>{u.name}</h2>
      <div className="row small">
        <span className="chip">{u.models.filter((m) => !m.dead).length}/{u.startingStrength} models</span>
        {(st === 'half' || st === 'belowHalf') && <span className="chip warn">{st === 'half' ? 'Half-strength' : 'Below half'}</span>}
        {u.battleShocked && <span className="chip warn">⚠ Battle-shocked (OC −, ห้ามใช้ stratagem)</span>}
        {u.core.fnp && <span className="chip">FNP {u.core.fnp}+</span>}
        {u.core.stealth && <span className="chip">Stealth</span>}
        {u.core.deepStrike && <span className="chip">Deep Strike</span>}
        {u.buffs.map((b, i) => <span key={i} className="chip">{b.label ?? b.kind}</span>)}
      </div>
      {[...groups.values()].map((g, i) => (
        <div key={i}>
          <div className="small muted">{g.n}× {g.p.name}</div>
          <Stats p={g.p} />
          <Weapons weapons={g.weapons} />
        </div>
      ))}
      {u.enhancements.map((e) => (
        <div key={e.name} className="sheet"><b>✦ Enhancement: {e.name}</b> <span className="tiny muted">({e.model})</span>{'\n'}{e.text}</div>
      ))}
      {u.abilities.map((a, i) => (
        <div key={i} className="sheet"><b>{a.name}{a.param ? ` ${a.param}` : ''}</b> <span className="tiny muted">({a.type}{a.model ? ` · ${a.model}` : ''})</span>{a.text ? `\n${a.text}` : ''}</div>
      ))}
      <div className="kw">{[...u.factionKeywords, ...u.keywords].join(', ')}</div>
    </div>
  );
}
