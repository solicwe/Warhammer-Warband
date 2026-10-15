import { abilityRule, abilityStatus, type AbilityStatus } from '../engine/effects';
import { strength } from '../engine/state';
import type { AbilityData, DatasheetData, ModelProfileData, UnitState, WeaponData } from '../engine/types';
import { abilitiesOf, abilityLabel } from '../engine/weapons';
import { Portrait, tokenKind, type TokenKind } from './Tokens';
import { modelPortraitKey, usePastePortrait } from './portraits';
import { datasheetVariants, pictureVariants, type PictureVariant } from './loadout';
import { Icon } from './Icon';
import { useState, type ReactNode } from 'react';
import { Em } from './Em';

/** The characteristics band, laid out like the printed datasheet: framed boxes, the invulnerable save as a shield under Sv. */
function Stats({ p, noInv }: { p: ModelProfileData; noInv?: boolean }) {
  const cells: [string, string][] = [['M', p.M != null ? `${p.M}"` : '-'], ['T', String(p.T)], ['Sv', `${p.Sv}+`], ['W', String(p.W)], ['Ld', `${p.Ld}+`], ['OC', p.OC != null ? String(p.OC) : '-']];
  return (
    <div className="ds-stats">
      <div className="ds-statrow">
        {cells.map(([k, v]) => <div key={k} className="ds-stat"><span>{k}</span><b>{v}</b></div>)}
        {p.InSv && !noInv ? <div className="ds-inv" title="Invulnerable save"><span className="ds-shield">{p.InSv}+</span></div> : null}
      </div>
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
              {p.abilities.length > 0 && <span className="ds-wkw"> {abilitiesOf(p).map((a) => `[${abilityLabel(a).toUpperCase()}]`).join(', ')}</span>}
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

const ST_LABEL: Record<AbilityStatus, string> = { auto: 'Automated', partial: 'Partly automated', manual: 'Manual', info: 'Info', none: 'Not automated', core: '' };

/** Badge saying whether the app plays this ability by itself. */
function AbilityBadge({ u, a }: { u: UnitState; a: AbilityData }) {
  const st = abilityStatus(u, a);
  if (st.status === 'core') return null;
  // a small tick: green = the game does it, red = not (yet) automated; the full status and note on hover
  const ok = st.status === 'auto';
  return <>{' '}<span className={`ab-tick ${ok ? 'ok' : 'todo'}`} title={`${ST_LABEL[st.status]}${st.note ? ` — ${st.note}` : ''}`}><Icon name={ok ? 'check' : 'close'} size={11} /></span></>;
}

/** Model lines with the same characteristics show once ("Intercessor Sergeant / Intercessor"). */
export function statGroups(models: ModelProfileData[]) {
  const key = (m: ModelProfileData) => [m.M, m.T, m.Sv, m.W, m.Ld, m.OC, m.InSv ?? ''].join('|');
  const out: { names: string[]; base: string; p: ModelProfileData }[] = [];
  for (const m of models) {
    const baseText = m.base?.text ?? '';
    const g = out.find((x) => key(x.p) === key(m) && x.base === baseText);
    if (g) g.names.push(m.name); else out.push({ names: [m.name], base: baseText, p: m });
  }
  return out;
}

/** `variants`: the picture slots of a list entry (one per loadout once its wargear differs); else one per model name. */
/** Each army's datasheet colour (the band behind the characteristics and the table headings). */
const DS_COLOR: Record<string, string> = {
  TS: '#0f3f5e', SM: '#1b3768', AC: '#6e5112', ORK: '#2f5a1d', CSM: '#5e1717', DG: '#4b5a22', WE: '#6b1111', EC: '#5b1f55',
  CD: '#4e1a3d', AE: '#20545a', DRU: '#2d2240', NEC: '#1f4a2c', TYR: '#4a2348', GC: '#3c2f52', TAU: '#2e5a6b', LoV: '#5a3c1c',
  AM: '#3d4a2a', AS: '#6a1a1f', AdM: '#6b1d16', GK: '#3d4d5c', AoI: '#3a3f47', QI: '#1d3a5f', QT: '#3b2a2a', TL: '#3a3a3a', UA: '#3a3f47',
};
/** The army's own colour for highlights (Chapter colours for Space Marines), bright enough on dark and light grounds. */
const ARMY_COLOR: Record<string, string> = {
  SM: '#3b6fd1', ORK: '#5a9a2c', AC: '#c9a13b', TS: '#2a8fc0', CSM: '#c23a2e', DG: '#7f9a34', WE: '#c8262a', EC: '#b04aa6',
  CD: '#b03a7a', AE: '#2f9aa3', DRU: '#7a5fb8', NEC: '#2fa35a', TYR: '#9a4ab0', GC: '#7a5fb0', TAU: '#3aa0c0', LoV: '#c07a2a',
  AM: '#7a9a3a', AS: '#c0303a', AdM: '#c04a2a', GK: '#8aa0b8', AoI: '#8a93a3', QI: '#3a78c0', QT: '#a05a5a', TL: '#9a9a9a', UA: '#8a93a3',
};
const CHAPTER_COLOR: Record<string, string> = {
  ULTRAMARINES: '#2f63c9', 'BLOOD ANGELS': '#c8262f', 'DARK ANGELS': '#2e8a46', 'SPACE WOLVES': '#7d9bb3', 'BLACK TEMPLARS': '#9aa0a8',
  DEATHWATCH: '#8a93a3', 'IMPERIAL FISTS': '#e0b018', 'IRON HANDS': '#7f8a96', 'RAVEN GUARD': '#6f7a8c', SALAMANDERS: '#2f9a3a', 'WHITE SCARS': '#d23a3a',
};
export const armyColor = (factionId?: string, sub?: string) => (sub && CHAPTER_COLOR[sub]) || ARMY_COLOR[factionId ?? ''] || '#c9a13b';

export const dsColor = (factionId?: string) => DS_COLOR[factionId ?? ''] ?? '#2c4440';

interface ParsedBulletOption {
  name?: string;
  text: string;
}

function parseBulletChoices(text: string): { intro: string; options: ParsedBulletOption[] } | null {
  if (!/(?:select|choose) (?:one|two|three|\d+) of the following|one of the following abilities/i.test(text)) return null;
  const lines = text.split('\n');
  const bulletIdx = lines.findIndex((l) => /^[•\-\*]\s+/.test(l.trim()));
  if (bulletIdx <= 0) return null;
  const intro = lines.slice(0, bulletIdx).join(' ').trim();
  const rawBullets: string[] = [];
  for (let i = bulletIdx; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^[•\-\*]\s+/.test(l)) {
      rawBullets.push(l.replace(/^[•\-\*]\s+/, ''));
    } else if (rawBullets.length > 0 && l.length > 0) {
      rawBullets[rawBullets.length - 1] += ' ' + l;
    }
  }
  if (rawBullets.length < 2) return null;
  const options = rawBullets.map((b) => {
    const m = /^([^:]{2,45}):\s*(.*)$/.exec(b);
    if (m && !/^(?:Note|Designer's Note|Example)$/i.test(m[1])) {
      return { name: m[1].trim(), text: m[2].trim() };
    }
    return { text: b };
  });
  return { intro, options };
}

export function renderAbilitiesContent(
  abilities: AbilityData[],
  unit: UnitState,
  sheetName: string,
  rulesFaction?: string,
  names?: string[],
  damaged?: DatasheetData['damaged']
): ReactNode[] {
  const ab = (a: AbilityData, i: number) => (
    <div key={i} className="ds-ab">
      <b>{a.name}{a.param ? ` ${a.param}` : ''}:</b>
      {rulesFaction && <AbilityBadge u={unit} a={{ ...a, sheet: sheetName, faction: rulesFaction }} />}
      {' '}<Em text={a.text} names={names} />
    </div>
  );

  const out: ReactNode[] = [];
  const handledAbilityNames = new Set<string>();

  // 1a. Choice abilities defined via abilityRule choice (e.g. Unearthly Power, The Warmaster, Lord of the Death Guard)
  for (const a of abilities) {
    const ch = rulesFaction ? abilityRule(unit, { ...a, sheet: sheetName, faction: rulesFaction })?.choice : undefined;
    const opts = ch ? abilities.filter((x) => ch.options.includes(x.name)) : [];
    if (opts.length > 0) {
      out.push(
        <div key={`sec-c-${a.name}`} className="ds-sec">{a.name.toUpperCase()}</div>,
        ...opts.map(ab)
      );
      opts.forEach((o) => handledAbilityNames.add(o.name));
    }
  }

  // 1b. Any Primarch type abilities not yet handled (group under their parent or section)
  const primarchUnclaimed = abilities.filter((a) => a.type === 'Primarch' && !handledAbilityNames.has(a.name));
  if (primarchUnclaimed.length > 0) {
    const parentChoice = abilities.find((a) => a.type !== 'Primarch' && /(?:select|choose) one of the (?:following|abilities)/i.test(a.text));
    const title = parentChoice ? parentChoice.name : 'PRIMARCH ABILITIES';
    out.push(
      <div key="sec-primarch" className="ds-sec">{title.toUpperCase()}</div>,
      ...primarchUnclaimed.map(ab)
    );
    primarchUnclaimed.forEach((o) => handledAbilityNames.add(o.name));
  }

  // 1c. Abilities whose text contains bullet choices (e.g. Singular Purpose, Adaptive Instincts, Moment Shackle)
  for (const a of abilities) {
    if (a.type === 'Core' || a.type === 'Faction' || handledAbilityNames.has(a.name)) continue;
    const bc = parseBulletChoices(a.text);
    if (bc) {
      out.push(
        <div key={`sec-bc-${a.name}`} className="ds-sec">{a.name.toUpperCase()}</div>,
        <div key={`intro-${a.name}`} className="ds-ab small muted" style={{ fontStyle: 'italic', paddingBottom: 2 }}>
          {rulesFaction && <AbilityBadge u={unit} a={{ ...a, sheet: sheetName, faction: rulesFaction }} />}
          {' '}<Em text={bc.intro} names={names} />
        </div>,
        ...bc.options.map((opt, oi) => (
          <div key={`bco-${a.name}-${oi}`} className="ds-ab">
            {opt.name ? <b>{opt.name}: </b> : <span>• </span>}
            <Em text={opt.text} names={names} />
          </div>
        ))
      );
      handledAbilityNames.add(a.name);
    }
  }

  // 1d. Special section rules (e.g. SUPREME COMMANDER, DEPLOYMENT, etc.)
  for (const a of abilities.filter((x) => /^Special/.test(x.type))) {
    out.push(
      <div key={`sec-s-${a.name}`} className="ds-sec">{a.name.toUpperCase()}</div>,
      <div key={`st-${a.name}`} className="ds-ab"><Em text={a.text} names={names} /></div>
    );
    handledAbilityNames.add(a.name);
  }

  // 2. ABILITIES header
  out.push(<div key="sec-abilities" className="ds-sec">ABILITIES</div>);

  // 3. Core & Faction rules
  for (const t of ['Core', 'Faction'] as const) {
    const xs = abilities.filter((a) => a.type === t);
    if (xs.length > 0) {
      out.push(
        <div key={`rule-${t}`} className="ds-line ds-rule">
          {t.toUpperCase()}: <b>{xs.map((a) => `${a.name}${a.param ? ` ${a.param}` : ''}`).join(', ')}</b>
        </div>
      );
    }
  }

  // 4. Remaining datasheet abilities
  const remaining = abilities.filter((a) => a.type !== 'Core' && a.type !== 'Faction' && !handledAbilityNames.has(a.name));
  for (let i = 0; i < remaining.length; i++) {
    out.push(ab(remaining[i], i));
  }

  // 5. Damaged profile (if any)
  if (damaged) {
    out.push(
      <div key="sec-damaged" className="ds-ab">
        <b>DAMAGED: 1-{damaged.w} WOUNDS REMAINING:</b> <Em text={damaged.text} />
      </div>
    );
  }

  return out;
}

export function DatasheetView({ sheet, factionId, variants }: { sheet: DatasheetData; factionId?: string; variants?: PictureVariant[] }) {
  const probe = { sources: [sheet.name], abilities: [] } as unknown as UnitState;
  const rulesFaction = sheet.ally ?? factionId;
  const [more, setMore] = useState(false);
  usePastePortrait(sheet.name);
  const groups = statGroups(sheet.models);
  const names = [...sheet.abilities.map((a) => a.name), ...sheet.leads, sheet.name];
  return (
    <div className="ds-sheet" style={{ display: 'flex', flexDirection: 'column', gap: 8, ['--ds-band' as string]: dsColor(factionId) }}>
      <div className="ds-head">
        <Portrait kind={tokenKind(sheet.keywords, sheet.factionKeywords)} owner={0} character={sheet.keywords.includes('CHARACTER')} size={60} datasheet={sheet.name} editable />
        <div className="grow">
          <h2>{sheet.name}</h2>
          <div className="tiny">{sheet.role}{sheet.keywords.includes('EPIC HERO') ? ' · Epic Hero' : ''} · tap the picture or paste to set one</div>
        </div>
      </div>
      <div className="ds-statband">
        {groups.map((g, gi) => (
          <div key={g.names.join('|')} className="ds-statline">
            <Stats p={g.p} noInv={gi < groups.length - 1 && groups.every((x) => x.p.InSv === g.p.InSv)} />
            <div className="ds-mname">{(groups.length > 1 ? g.names.join(' / ') : sheet.models.length > 1 ? 'All models' : sheet.name).toUpperCase()}{g.base ? <small>base {g.base}</small> : null}</div>
          </div>
        ))}
      </div>
      <Weapons weapons={sheet.weapons} />
      {(sheet.options ?? []).length > 0 && <details><summary className="small">Wargear options</summary>{(sheet.options ?? []).map((o, i) => <div key={i} className="small">• <Em text={o} /></div>)}</details>}
      {renderAbilitiesContent(sheet.abilities, probe, sheet.name, rulesFaction, names, sheet.damaged)}
      {!more && <button type="button" className="ab-moreinfo ds-more" onClick={() => setMore(true)}>MORE INFO <Icon name="down" size={18} /></button>}
      {more && (
        <>
          <div className="ds-sec">UNIT COMPOSITION</div>
          <div className="ds-body">
            {sheet.composition.map((c) => <div key={c.text}>• <b>{c.text}</b></div>)}
            {(() => {
              // "Ancient: combat knife, …. Company Champion: …" → one row per model, its kit as a list
              // "Ephrael Stern is equipped with: …\nKyganil … is equipped with: …" → one row per named model
              const each = sheet.loadoutText.split('\n').map((l) => /^(?:The |Every |Each )?(.+?) (?:is|are) equipped with:\s*(.*)$/i.exec(l.trim())).filter((m): m is RegExpExecArray => !!m);
              const text = sheet.loadoutText.replace(/^.*?equipped with:\s*/i, '').trim();
              const rows = each.length > 1 ? each.map((m) => ({ who: m[1], kit: m[2].replace(/\.\s*$/, '').split(/;\s*/).map((x) => x.trim()).filter(Boolean) })) : text.split(/\.\s+(?=[A-Z][^:.]{1,60}:)/).map((r) => r.replace(/\.$/, '').trim()).filter(Boolean)
                .map((r) => { const i = r.indexOf(':'); return i > 0 && i < 60 ? { who: r.slice(0, i), kit: r.slice(i + 1).split(/,\s*/).map((x) => x.trim()).filter(Boolean) } : { who: '', kit: [r] }; });
              if (rows.length < 2 && !rows[0]?.who) return <div><b>This model is equipped with:</b> {text}</div>;
              return (
                <div className="ds-kit">
                  <b>{rows.length > 1 ? 'Each model is equipped with:' : 'This model is equipped with:'}</b>
                  {rows.map((r, k) => (
                    <div key={k} className="ds-kit-row">
                      {r.who && <div className="ds-kit-who">{r.who}</div>}
                      <div className="ds-kit-items">{r.kit.map((x) => <span key={x} className="ds-kit-item">{x}</span>)}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          {sheet.leads.length > 0 && (
            <>
              <div className="ds-sec">LEADER</div>
              <div className="ds-body">Can be attached to:{sheet.leads.map((l) => <div key={l} className="ds-lead">• {l}</div>)}</div>
            </>
          )}
          <div className="ds-kw"><span>FACTION KEYWORDS:</span> {sheet.factionKeywords.join(', ')}</div>
          <div className="kw ds-kw2">KEYWORDS: {sheet.keywords.join(', ')}</div>
          {(() => {
            // pictures per model (Wardens of Ultramar, a sergeant) and per loadout (Terminator with claws / with a hammer)
            // every model name counts, the one named like the unit too (Chaplain Grimaldus + Cenobyte Servitors): that one
            // uses the unit's own picture, as on the board
            const names = [...new Set(sheet.models.map((m) => m.name))].filter(Boolean);
            const all = variants ?? datasheetVariants(sheet);
            const v = all.length ? all : names.length > 1 ? names.map((n) => ({ key: n === sheet.name ? sheet.name : modelPortraitKey(sheet.name, n), fallback: [sheet.name], label: n })) : [];
            return <div className="ds-pics"><ModelPictures variants={v} kind={tokenKind(sheet.keywords, sheet.factionKeywords)} owner={0} /></div>;
          })()}
          {sheet.link && <div className="tiny muted">Data: Wahapedia (<a href={sheet.link} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>source</a>)</div>}
          <button type="button" className="ab-moreinfo ds-more" onClick={() => setMore(false)}>LESS <span className="dt-chev up"><Icon name="down" size={18} /></span></button>
        </>
      )}
    </div>
  );
}

/** `model`: the model tapped on the board, listed first with its own weapons. */
export function UnitView({ u, model }: { u: UnitState; model?: string }) {
  usePastePortrait(u.models.find((m) => m.isCharacter)?.source ?? u.sources[0]);
  const groups = new Map<string, { p: ModelProfileData; n: number; weapons: WeaponData[]; name: string; gear: string[]; tapped?: boolean }>();
  const tapped = u.models.find((m) => m.id === model && !m.dead);
  for (const m of tapped ? [tapped, ...u.models.filter((x) => x !== tapped)] : u.models) {
    if (m.dead) continue;
    // models with different wargear are listed separately
    const k = [m.source, m.name, m.profile.W, m.profile.InSv, ...m.weapons.map((w) => w.name), ...(m.gear ?? [])].join('|');
    const g = groups.get(k) ?? { p: m.profile, n: 0, weapons: m.weapons, name: m.name, gear: m.gear ?? [], tapped: m === tapped };
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
          <div className="tiny">Tap the picture or paste to set one · saved on this device</div>
        </div>
      </div>
      {u.sources.map((src) => {
        return <ModelPictures key={src} variants={pictureVariants(src, u.models)} kind={tokenKind(u.models.find((m) => m.source === src)?.keywords ?? u.keywords, u.factionKeywords)} owner={u.owner} />;
      })}
      <div className="row small">
        <span className="chip">{u.models.filter((m) => !m.dead).length}/{u.startingStrength} models</span>
        {(st === 'half' || st === 'belowHalf') && <span className="chip warn">{st === 'half' ? 'Half-strength' : 'Below half'}</span>}
        {u.battleShocked && <span className="chip warn">Battle-shocked (OC 0, no Stratagems)</span>}
        {u.core.fnp && <span className="chip">FNP {u.core.fnp}+</span>}
        {u.core.stealth && <span className="chip">Stealth</span>}
        {u.core.deepStrike && <span className="chip">Deep Strike</span>}
        {(u.timed ?? []).filter((t) => t.label.startsWith('Order: ')).map((t, i) => (
          <span key={`ord-${i}`} className="chip on" style={{ background: '#1c3d24', color: '#86efac', borderColor: '#22c55e', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="bullhorn" size={13} /> {t.label}</span>
        ))}
        {u.buffs.map((b, i) => <span key={i} className="chip">{b.label ?? b.kind}</span>)}
      </div>
      {[...groups.values()].map((g, i) => (
        <div key={i} className={g.tapped ? 'uv-tapped' : undefined}>
          <div className="small muted">{g.tapped ? <b>Tapped model · </b> : null}{g.n}× {g.name}{g.gear.length ? ` · ${g.gear.join(', ')}` : ''}</div>
          <Stats p={g.p} />
          <Weapons weapons={g.weapons} />
        </div>
      ))}
      {u.enhancements.map((e) => (
        <div key={e.name} className="sheet"><b>Enhancement: {e.name}</b> <span className="tiny muted">({e.model})</span>{'\n'}<Em text={e.text} /></div>
      ))}
      {(() => {
        const rulesFaction = u.abilities.find((a) => a.faction)?.faction
          ?? (u.factionKeywords.includes('THOUSAND SONS') ? 'TS'
          : u.factionKeywords.includes('WORLD EATERS') ? 'WE'
          : u.factionKeywords.includes('DEATH GUARD') ? 'DG'
          : u.factionKeywords.includes('EMPEROR’S CHILDREN') || u.factionKeywords.includes("EMPEROR'S CHILDREN") ? 'EC'
          : u.factionKeywords.includes('CHAOS SPACE MARINES') ? 'CSM'
          : u.factionKeywords.includes('TYRANIDS') ? 'TYR'
          : u.factionKeywords.includes('ADEPTUS CUSTODES') ? 'AC'
          : u.factionKeywords.includes('ASTRA MILITARUM') ? 'AM'
          : u.factionKeywords.includes('ORKS') ? 'ORK'
          : u.factionKeywords.includes('IMPERIAL KNIGHTS') ? 'QI'
          : u.factionKeywords.includes('CHAOS KNIGHTS') ? 'QT'
          : u.factionKeywords.includes('AGENTS OF THE IMPERIUM') ? 'AoI'
          : u.factionKeywords.includes('ADEPTUS ASTARTES') ? 'SM'
          : undefined);
        return (
          <div className="ds-sheet" style={{ ['--ds-band' as string]: dsColor(rulesFaction), borderRadius: 8, overflow: 'hidden' }}>
            {renderAbilitiesContent(u.abilities, u, u.sources[0] ?? u.name, rulesFaction, u.abilities.map((x) => x.name))}
          </div>
        );
      })()}
      <div className="kw">{[...u.factionKeywords, ...u.keywords].join(', ')}</div>
    </div>
  );
}

/** One picture per model (by name, and by loadout when the same model comes with different kits): tap to set one. */
export function ModelPictures({ variants, kind, owner }: { variants: PictureVariant[]; kind: TokenKind; owner: 0 | 1 }) {
  if (!variants.length) return null;
  return (
    <div>
      <div className="small muted">Model pictures · tap to set one for each model / loadout</div>
      <div className="model-pics">
        {variants.map((v) => (
          <div key={v.key} className="model-pic">
            <Portrait kind={kind} owner={owner} size={48} datasheet={v.key} fallback={v.fallback} editable />
            <span>{v.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
