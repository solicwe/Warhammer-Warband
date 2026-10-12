// A faction built from a ListForge pack (data/packs/<ID>.listforge-pack.json) instead of the Wahapedia export:
// the 2026 Codex: Space Marines (datasheets, army rules, detachments, stratagems, enhancements). The Wahapedia build
// of the same faction is the reference for what a pack doesn't carry: base sizes, unit roles, ids and the spelling of
// names that saved army lists, unit pictures and the rules data (data/abilities, data/stratagems) are keyed by.
// Stratagem timing comes from the rules cards (data/packs/<ID>.cards.txt) where a detachment has them.
import fs from 'node:fs';
import path from 'node:path';

const wkey = (s) => String(s ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');
const up = (s) => String(s).toUpperCase();
const num = (s) => { const m = /-?\d+/.exec(String(s ?? '')); return m ? Number(m[0]) : null; };
const plus = (s) => { const m = /(\d+)\+/.exec(String(s ?? '')); return m ? Number(m[1]) : null; };

/** Core abilities as "Name param" in the pack ("Feel No Pain 5+", "Scouts 6\"", "Deadly Demise D3"). */
const CORE = ['Feel No Pain', 'Deadly Demise', 'Scouts', 'Firing Deck', 'Lone Operative', 'Deep Strike', 'Leader', 'Support', 'Infiltrators', 'Stealth', 'Fights First', 'Hover'];
function coreAbility(s) {
  for (const n of CORE) if (s === n || s.startsWith(`${n} `)) return { name: n, type: 'Core', ...(s.length > n.length ? { param: s.slice(n.length + 1).trim() } : {}), text: '' };
  return { name: s, type: 'Core', text: '' };
}

/** "➤ Bolt Rifle - Focused Fire" → "focused fire"; a single profile takes the weapon's name. */
function profileName(weapon, p) {
  if (!p.name) return weapon.name;
  const m = /^➤?\s*(.*?)\s+-\s+(.+)$/.exec(p.name.trim());
  return (m ? m[2] : p.name.replace(/^➤\s*/, '')).toLowerCase();
}

function weaponOf(w) {
  return {
    name: w.name,
    profiles: w.profiles.map((p) => ({
      name: profileName(w, p),
      range: p.melee ? 'Melee' : num(p.range) ?? 0,
      A: String(p.attacks).trim(),
      skill: plus(p.skill),
      S: num(p.strength) ?? 0,
      AP: num(p.ap) ?? 0,
      D: String(p.damage).trim(),
      abilities: String(p.keywords ?? '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean),
    })),
  };
}

const statModel = (name, st, base) => ({
  name,
  M: num(st.M),
  T: num(st.T) ?? 0,
  Sv: plus(st.Sv) ?? 7,
  InSv: plus(st.InSv),
  W: num(st.W) ?? 1,
  Ld: plus(st.LD) ?? 7,
  OC: num(st.OC),
  base,
});

/** The role the army builder groups a unit under (the Wahapedia build's words). */
function roleOf(cats) {
  const has = (c) => cats.includes(c);
  if (has('Battleline')) return 'Battleline';
  if (has('Dedicated Transport')) return 'Dedicated Transports';
  const kind = ['Monster', 'Vehicle', 'Mounted', 'Beast', 'Infantry'].find(has) ?? 'Infantry';
  if (has('Epic Hero')) return `${kind} Epic Hero`;
  if (has('Character')) return `${kind} Character`;
  if (has('Aircraft')) return 'Aircraft';
  if (has('Transport')) return 'Transport';
  if (has('Walker')) return 'Walker';
  if (has('Artillery')) return 'Artillery';
  return kind;
}

function defaultBase(cats, kws, W) {
  const k = [...cats, ...kws].map(up);
  if (k.includes('VEHICLE') || k.includes('MONSTER')) return { w: 0, h: 0, text: 'Hull' };
  if (k.includes('MOUNTED')) return { w: 90, h: 52, text: '90 x 52mm' };
  if (k.includes('TERMINATOR') || k.includes('GRAVIS') || W >= 3) return { w: 40, h: 40, text: '40mm' };
  return { w: 32, h: 32, text: '32mm' };
}

/** Stratagem details from the rules cards: name → { category, when, target, effect, phase }. */
function readCards(file) {
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  const t = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim());
  for (let i = 1; i < t.length; i++) {
    if (!/^Space Marines · |^Core$/.test(t[i]) || t[i + 2] !== 'CP') continue;
    const name = t[i - 1];
    const det = t[i] === 'Core' ? 'Core' : t[i].replace('Space Marines · ', '');
    const [, category = ''] = (t[i + 3] ?? '').split(' · ');
    const grab = (label, from) => { const j = t.indexOf(label, from); return j > 0 && j < from + 40 ? t[j + 1] : ''; };
    out.set(`${up(name)}@${det}`, { category, when: grab('When to Use', i), effect: grab('What it Does', i), target: grab('Target', i), trigger: grab('Trigger', i) });
  }
  return out;
}

/** The faction keyword of a faction's units (the army's own keyword, not its name). */
const FACTION_KW = { SM: 'ADEPTUS ASTARTES', AC: 'ADEPTUS CUSTODES' };
/** Factions whose saved lists and rules data use Wahapedia's spelling of unit names. */
const KEEP_SPELLING = new Set(['SM']);

const PHASES = ['Command', 'Movement', 'Shooting', 'Charge', 'Fight'];
function stratagemsOf(det, text, cards) {
  const i = text.indexOf('STRATAGEMS');
  if (i < 0) return [];
  const out = [];
  // card layout ("Name (1CP)" then WHEN / TARGET / EFFECT / RESTRICTIONS lines)
  for (const m of text.slice(i).matchAll(/^([^\n:]+?) \((\d+)CP\)\n(WHEN:[\s\S]*?)(?=\n\s*\n[^\n]+ \(\d+CP\)\n|(?![\s\S]))/gm)) {
    const [, name, cp, body] = m;
    const part = (k) => (new RegExp(`^${k}: ([\\s\\S]*?)(?=\\n(?:WHEN|TARGET|EFFECT|RESTRICTIONS):|(?![\\s\\S]))`, 'm').exec(body)?.[1] ?? '').trim();
    const when = part('WHEN');
    const card = cards.get(`${up(name)}@${det}`);
    const phase = /^end of any phase|^any phase/i.test(when) ? 'Any phase' : PHASES.filter((p) => new RegExp(`${p} phase`, 'i').test(when)).map((p) => `${p} phase`).join(' or ') || 'Any phase';
    const turn = /or the fight phase/i.test(when) ? 'Either player’s turn' : /^your opponent/i.test(when) ? 'Opponent’s turn' : /^your /i.test(when) ? 'Your turn' : 'Either player’s turn';
    const restr = part('RESTRICTIONS');
    out.push({
      id: `${det}-${wkey(name)}`,
      name: up(name.trim()),
      cp: Number(cp),
      type: `${det} – ${card?.category || 'Battle Tactic'} Stratagem`,
      turn,
      phase,
      text: `WHEN: ${when}\nTARGET: ${part('TARGET')}\nEFFECT: ${part('EFFECT')}${restr ? `\nRESTRICTIONS: ${restr}` : ''}`,
    });
  }
  if (out.length) return out;
  for (const m of text.slice(i).matchAll(/^- (.+?) \((\d+)CP\): ([\s\S]*?)(?=\n\s*\n- |\n- |$)/gm)) {
    const [, name, cp, body] = m;
    const tgt = /\s*(Target [^.]*\.)\s*/.exec(body);
    const when = tgt ? body.slice(0, tgt.index).trim() : body.split('. ')[0];
    const effect = tgt ? body.slice(tgt.index + tgt[0].length).trim() : body.slice(when.length + 1).trim();
    const card = cards.get(`${up(name)}@${det}`);
    const phase = PHASES.filter((p) => new RegExp(`${p} phase`, 'i').test(when)).map((p) => `${p} phase`).join(' or ') || 'Any phase';
    // "Your opponent's Shooting phase or the Fight phase": the Fight phase is in both players' turns
    const turn = /or the fight phase/i.test(when) ? 'Either player’s turn' : /^your opponent/i.test(when) ? 'Opponent’s turn' : /^your /i.test(when) ? 'Your turn' : 'Either player’s turn';
    out.push({
      id: `${det}-${wkey(name)}`,
      name: up(name),
      cp: Number(cp),
      type: `${det} – ${card?.category || 'Battle Tactic'} Stratagem`,
      turn,
      phase,
      text: `WHEN: ${when}\nTARGET: ${tgt ? tgt[1].replace(/^Target /, '').replace(/\.$/, '').replace(/^\w/, (c) => c.toUpperCase()) : 'One unit from your army'}.\nEFFECT: ${effect}`,
    });
  }
  return out;
}

/** Wargear slots → the builder's options: a model type's alternatives, optional extras, and "1 per N models" variants. */
function wargearOf(u, weaponName) {
  const defModel = u.models.find((m) => m.isDefault) ?? u.models[u.models.length - 1];
  const dflt = (m) => m.wargear.filter((s) => !s.optional).flatMap((s) => (s.options[0] ? items(s.options[0]) : []));
  // an option is its weapons plus, for wargear such as a storm shield, the upgrade's name (a gear item)
  const items = (o) => [...o.weapons.map((w) => weaponName(w.weaponId)).filter(Boolean), ...(o.upgradeName ? [o.upgradeName] : [])];
  const options = [];
  const costs = [];
  for (const o of u.models.flatMap((m) => m.wargear.flatMap((s) => s.options))) if (o.pts > 0) { const n = items(o)[0]; if (n && !costs.some((c) => c.name === n)) costs.push({ name: n, pts: o.pts }); }
  // optional extra models with their own price (Victrix Honour Guard: +1 Chapter Champion 10 pts, +1 Chapter Ancient 15 pts)
  for (const m of u.models) if (m.min === 0 && m.max === 1 && !(m.perModels > 0) && m.pts > 0 && !m.isDefault && u.models.some((x) => x.isDefault && x.min >= 1) && !costs.some((c) => c.name === m.name)) costs.push({ name: m.name, pts: m.pts });
  for (const m of u.models) {
    if (m.perModels > 0 && m !== defModel) {
      // the variant's own slots: ones the default model lacks, or with other weapons (Sword Brother w/ Thunder Hammer: "Melee weapon")
      const sameSlot = (a, b) => JSON.stringify(a.options.map(items)) === JSON.stringify(b.options.map(items));
      const own = m.wargear.filter((s) => { const d = defModel.wargear.find((x) => x.name === s.name); return !d || !sameSlot(s, d); });
      const replace = defModel.wargear.filter((s) => !s.optional && (!m.wargear.some((x) => x.name === s.name) || own.some((x) => x.name === s.name))).flatMap((s) => items(s.options[0]));
      // one weapon from each of its own slots (heavy weapon × melee weapon)
      const choices = own.filter((s) => !s.optional).reduce((acc, s) => acc.flatMap((c) => s.options.map((o) => [...c, ...items(o)])), [[]]).filter((c) => c.length);
      if (choices.length) options.push({ text: `For every ${m.perModels} models, ${m.max} ${defModel.name} can be equipped as a ${m.name}: ${choices.map((c) => c.join(' + ')).join(' / ')}`, scope: 'perN', per: m.perModels, max: m.max || 1, who: defModel.name, replace, choices });
      continue;
    }
    const scope = m.max <= 1 ? 'one' : 'any';
    for (const s of m.wargear) {
      if (s.optional) {
        options.push({ text: `${m.name}: can be equipped with ${s.options.map((o) => items(o).join(' + ')).join(' / ')}`, scope, who: m.name, replace: [], choices: s.options.map(items).filter((c) => c.length) });
      } else if (s.options.length > 1) {
        const base = items(s.options[0]);
        options.push({ text: `${m.name}: ${base.join(' + ')} can be replaced with ${s.options.slice(1).map((o) => items(o).join(' + ')).join(' / ')}`, scope, who: m.name, replace: base, choices: s.options.slice(1).map(items).filter((c) => c.length) });
      }
    }
  }
  return { options, costs, loadout: Object.fromEntries(u.models.filter((m) => !(m.perModels > 0 && m !== defModel)).map((m) => [m.name, dflt(m).map((n) => n.toLowerCase())])) };
}

/** Wargear upgrades (storm shield, shield dome, grav-chutes …) as Wargear abilities; stat changes go in `mods`. */
function upgradesOf(u) {
  const out = new Map();
  for (const m of u.models) for (const sl of m.wargear) for (const o of sl.options) {
    if (!o.upgradeName || out.has(o.upgradeName)) continue;
    out.set(o.upgradeName, { name: o.upgradeName, type: 'Wargear', text: o.upgradeText || '', ...(o.statMods?.length ? { mods: o.statMods.map((x) => ({ stat: x.characteristic, type: x.type, value: x.value })) } : {}) });
  }
  return [...out.values()];
}

function pointsOf(u) {
  const sizes = [];
  if (u.sizeOptions?.length) {
    const tiers = [{ minModels: u.minModels, pts: u.basePoints }, ...u.pointsTiers];
    for (const so of u.sizeOptions) {
      const models = so.counts.reduce((a, c) => a + c.max, 0);
      const tier = [...tiers].reverse().find((t) => models >= t.minModels) ?? tiers[0];
      // a size can cost extra on top of the tier (Headtakers: +30 for 3 Hunting Wolves); the same model count keeps the last listed
      for (let k = sizes.length - 1; k >= 0; k--) if (sizes[k].models === models) sizes.splice(k, 1);
      sizes.push({ models, pts: tier.pts + (so.pts || 0) + so.counts.reduce((a, c) => a + (c.pts || 0), 0) });
    }
  } else {
    const tiers = [{ minModels: u.minModels, pts: u.basePoints }, ...[...u.pointsTiers].sort((a, b) => a.minModels - b.minModels)];
    tiers.forEach((t, k) => sizes.push({ models: k + 1 < tiers.length ? tiers[k + 1].minModels - 1 : u.maxModels, pts: t.pts }));
  }
  const seen = new Set();
  return [{ label: '', options: sizes.filter((s) => !seen.has(s.models) && seen.add(s.models)) }];
}

export function factionFromPack(packFile, ref, meta) {
  const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
  // a model's default gear is in its points: when a pack lists a costed option first (Shield-Captain: Praesidium
  // Shield +25), the first free option is the default
  for (const u of pack.units) for (const m of u.models) for (const sl of m.wargear) {
    const i = sl.options.findIndex((o) => !o.pts);
    if (!sl.optional && i > 0 && sl.options[0].pts > 0) sl.options = [sl.options[i], ...sl.options.filter((_, k) => k !== i)];
  }
  const cards = readCards(packFile.replace(/\.listforge-pack\.json$/, '.cards.txt'));
  const chapters = new Map((meta?.options ?? []).map((o) => [wkey(o.keyword), o.keyword]));
  const refSheets = new Map(ref.datasheets.map((d) => [wkey(d.name), d]));
  // army rules the book changes ("modify") or adds keep their new text
  const changed = (pack.armyRuleChanges ?? []).filter((c) => c.action !== 'remove' && c.description);
  const ruleText = new Map([...pack.armyRules, ...changed].map((r) => [r.name, r.description]));
  const factionKw = meta?.factionKeyword ?? FACTION_KW[ref.id] ?? up(ref.name);

  const datasheets = [];
  const packNames = new Map(); // the pack's name of a unit → the name used here
  for (const u of pack.units) {
    if (/\[legends\]/i.test(u.name)) continue;
    const old = refSheets.get(wkey(u.name)) ?? refSheets.get(wkey(u.replacesName));
    // the Wahapedia spelling is kept (saved lists, pictures and rules data use it) — except where it only differs in
    // capitals ("Shield-captain") in factions with no saved data yet
    const name = old && (KEEP_SPELLING.has(ref.id) || wkey(old.name) !== wkey(u.name)) ? old.name : u.name;
    packNames.set(wkey(u.name), name);
    const chapter = u.keywords.map((k) => chapters.get(wkey(k))).find(Boolean);
    const weaponIds = new Map(u.weapons.map((w) => [w.id, w.name]));
    const weaponName = (id) => weaponIds.get(id) ?? '';
    const used = new Set(u.models.flatMap((m) => m.wargear.flatMap((s) => s.options.flatMap((o) => o.weapons.map((w) => w.weaponId)))));
    const weapons = u.weapons.filter((w) => used.has(w.id) || !u.models.some((m) => m.wargear.length)).map(weaponOf);
    const W = num(u.models[0]?.stats.W) ?? 1;
    const oldBase = (mn) => (old?.models.find((m) => wkey(m.name) === wkey(mn)) ?? old?.models[0])?.base;
    const models = u.models.map((m) => statModel(m.name, m.stats, oldBase(m.name) ?? defaultBase(u.categories, u.keywords, W)));
    const { options, costs, loadout } = wargearOf(u, weaponName);
    const comp = u.models.filter((m) => !(m.perModels > 0 && !m.isDefault && u.models.length > 1));
    let composition = comp.map((m) => ({ name: m.name, min: m.min, max: m.max, text: `${m.min === m.max ? m.min : `${m.min}-${m.max}`} ${m.name}` }));
    if (u.sizeOptions?.length) {
      const byName = new Map();
      for (const so of u.sizeOptions) for (const c of so.counts) { const e = byName.get(c.modelName) ?? { min: Infinity, max: 0 }; byName.set(c.modelName, { min: Math.min(e.min, c.min), max: Math.max(e.max, c.max) }); }
      // a model missing from a size option has none in that size
      for (const [n, r] of byName) if (u.sizeOptions.some((so) => !so.counts.some((c) => c.modelName === n))) r.min = 0;
      composition = [...byName].map(([n, r]) => ({ name: n, min: r.min, max: r.max, text: `${r.min === r.max ? r.min : `${r.min}-${r.max}`} ${n}` }));
    }
    const damaged = u.abilities.find((a) => /^Damaged:/i.test(a.name));
    // named characters: some packs only flag them (epicHero) without the Epic Hero category
    const keywords = [...new Set([...u.categories, ...u.keywords, ...(u.epicHero ? ['Epic Hero'] : [])].map(up).filter((k) => !chapters.has(wkey(k))).concat(up(name), up(u.name)))];
    datasheets.push({
      id: old?.id ?? u.id,
      name,
      role: old?.role ?? roleOf(u.categories),
      keywords,
      factionKeywords: [...(u.keywords.some((k) => up(k) === 'ANATHEMA PSYKANA') ? ['ANATHEMA PSYKANA'] : [factionKw]), ...(chapter ? [chapter] : [])],
      ...(chapter ? { subfaction: chapter } : {}),
      models,
      composition,
      loadout,
      loadoutText: Object.entries(loadout).map(([m, ws]) => `${m}: ${ws.join(', ')}`).join('. '),
      options: options.map((o) => o.text),
      weapons,
      abilities: [
        ...u.coreAbilities.map(coreAbility),
        ...upgradesOf(u),
        ...u.factionRules.map((n) => ({ name: n, type: 'Faction', text: ruleText.get(n) ?? '' })),
        ...u.abilities.filter((a) => a !== damaged).map((a) => ({ name: a.name, type: 'Datasheet', text: a.description })),
      ],
      leads: u.leaderTargets.map((n) => refSheets.get(wkey(n))?.name ?? n),
      isSupport: u.coreAbilities.includes('Support'),
      ...(u.transportCapacity ? { transport: u.transportCapacity } : {}),
      ...(damaged ? { damaged: { w: /(\d+-\d+)/.exec(damaged.name)?.[1] ?? '', text: damaged.description } } : {}),
      points: pointsOf(u),
      wargearOptions: options,
      ...(costs.length ? { wargearCosts: costs } : {}),
      ...(u.hiddenWhenKeywords?.length ? { hiddenFor: u.hiddenWhenKeywords.map(up) } : {}),
      ...(u.maxPerArmy ? { maxPerArmy: u.maxPerArmy } : {}),
      ...(u.duplicateTaxPts ? { dupTax: { pts: u.duplicateTaxPts, from: u.duplicateTaxFromCopy || 2 } } : {}),
      link: old?.link ?? '',
    });
  }
  // leaders name their bodyguards by the pack's spelling ("Custodian Guard Sodality"): map to the names actually used
  const names = new Map(datasheets.map((d) => [wkey(d.name), d.name]));
  for (const [k, n] of packNames) if (!names.has(k)) names.set(k, n);
  for (const d of datasheets) d.leads = [...new Set(d.leads.map((n) => names.get(wkey(n))).filter(Boolean))];

  const detachments = pack.detachments.map((x) => {
    const chapter = (x.keywords ?? []).map((k) => chapters.get(wkey(k))).find(Boolean);
    const rule = x.ruleText.split(/\n\s*STRATAGEMS/)[0].trim();
    return {
      id: x.id,
      name: x.name,
      dp: x.detachmentPoints,
      forceDisposition: x.disposition ?? x.dispositions?.[0] ?? null,
      ...(x.dispositions?.length > 1 ? { forceDispositions: x.dispositions } : {}),
      ...(chapter ? { subfaction: chapter } : {}),
      ...(x.uniqueKeywords?.length ? { unitKeywords: x.uniqueKeywords.map(up) } : {}),
      ...(x.keywordGrants?.length ? { keywordGrants: x.keywordGrants.map((g) => ({ unit: names.get(wkey(g.unitName)) ?? g.unitName, keyword: up(g.keyword) })) } : {}),
      rules: [{ name: x.ruleName, text: rule }],
      enhancements: x.enhancements.map((e) => ({ id: e.id, name: e.name, pts: e.pts, upgrade: !!e.isUpgrade, text: e.description })),
      stratagems: stratagemsOf(x.name, x.ruleText, cards),
    };
  });

  const removed = new Set((pack.armyRuleChanges ?? []).filter((c) => c.action === 'remove').map((c) => c.name));
  return {
    ...ref,
    name: ref.name,
    lastUpdate: `${pack.name} r${pack.revision}`,
    armyRules: [...pack.armyRules.filter((r) => !removed.has(r.name) && !changed.some((c) => c.name === r.name)), ...changed]
      .map((r) => ({ name: r.name, text: r.description })),
    detachments,
    datasheets,
    source: { pack: pack.name, revision: pack.revision },
  };
}

export const packFile = (dir, id) => path.join(dir, `${id}.listforge-pack.json`);
