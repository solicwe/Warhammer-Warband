// Builds per-faction game data from the Wahapedia 11th edition CSV export.
//
//   node scripts/build-data.mjs           # use CSVs already in data/raw
//   node scripts/build-data.mjs --fetch   # download the latest CSVs first
//
// Output: public/data/index.json + public/data/factions/<ID>.json
// Manual corrections live in data/overrides/<ID>.json and are merged on top
// (see data/overrides/README.md), so they survive every re-import.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'data/raw');
const OVERRIDES = path.join(ROOT, 'data/overrides');
const OUT = path.join(ROOT, 'public/data');
const BASE_URL = 'https://wahapedia.ru/wh40k11ed/';
const FILES = [
  'Factions', 'Source', 'Datasheets', 'Datasheets_abilities', 'Datasheets_keywords',
  'Datasheets_models', 'Datasheets_options', 'Datasheets_wargear', 'Datasheets_unit_composition',
  'Datasheets_models_cost', 'Datasheets_stratagems', 'Datasheets_enhancements',
  'Datasheets_detachment_abilities', 'Datasheets_leader', 'Stratagems', 'Abilities',
  'Enhancements', 'Detachment_abilities', 'Detachments', 'Last_update',
];

async function fetchAll() {
  fs.mkdirSync(RAW, { recursive: true });
  for (const f of FILES) {
    const res = await fetch(`${BASE_URL}${f}.csv`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`${f}.csv: HTTP ${res.status}`);
    fs.writeFileSync(path.join(RAW, `${f}.csv`), await res.text());
    console.log('fetched', f);
  }
}

function readCsv(name) {
  const text = fs.readFileSync(path.join(RAW, `${name}.csv`), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const header = lines[0].split('|');
  return lines.slice(1).map((line) => {
    const cells = line.split('|');
    const row = {};
    header.forEach((h, i) => { if (h) row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export function htmlToText(s = '') {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|tr)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const num = (s) => {
  const n = parseInt(String(s).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
const plus = (s) => (s && s !== '-' ? num(s) : null); // "3+" -> 3

function parseBase(s) {
  const m = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*mm/i.exec(s);
  if (m) return { w: +m[1], h: +m[2], text: s };
  const c = /(\d+(?:\.\d+)?)\s*mm/i.exec(s);
  if (c) return { w: +c[1], h: +c[1], text: s };
  return { w: 0, h: 0, text: s || 'Use model' }; // hull / no base: sized in the app
}

// "Kombi-skorcha - Shoota" / "Plasma pistol – standard" -> base weapon + profile name
function splitWeaponName(name) {
  const m = /^(.*?)\s+[–-]\s+(.*)$/.exec(name);
  return m ? { base: m[1].trim(), profile: m[2].trim() } : { base: name.trim(), profile: null };
}

function parseComposition(lines) {
  return lines
    .map((l) => htmlToText(l.description))
    .filter(Boolean)
    .map((text) => {
      const m = /^(\d+)(?:\s*-\s*(\d+))?\s+(.+?)(?:\s+models?)?$/i.exec(text);
      if (!m) return { text };
      return { name: m[3].trim(), min: +m[1], max: m[2] ? +m[2] : +m[1], text };
    });
}

// "<b>Every Nob is equipped with:</b> 1 Kustom Choppa; 1 Kombi-skorcha." -> { Nob: [...] }
function parseLoadout(html) {
  const out = {};
  const text = htmlToText(html);
  const re = /([^\n.:]+?) (?:is|are) equipped with:\s*([^\n]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    let who = m[1].trim().replace(/^(every|each|the|all)\s+/i, '');
    if (/^(model|models|this model)$/i.test(who)) who = '*';
    const items = m[2].replace(/\.$/, '').split(/;\s*/).map((s) => s.replace(/^\d+\s+/, '').trim()).filter(Boolean);
    out[who] = items;
  }
  return out;
}

function parsePoints(rows) {
  // Keep the first price tier ("YOUR UNIT COSTS" / "YOUR 1ST TO 3RD UNITS COST"), drop duplicates.
  const tiers = [];
  let cur = null;
  for (const r of rows) {
    if (!r.cost) { cur = { label: r.description, options: [] }; tiers.push(cur); continue; }
    if (!cur) { cur = { label: 'YOUR UNIT COSTS', options: [] }; tiers.push(cur); }
    // "1 Sword Brother, 4 Neophytes, 5 Initiates" -> 10 models; "10 models" -> 10
    const parts = [...String(r.description).matchAll(/(\d+)\s+[A-Za-z]/g)].map((m) => +m[1]);
    const models = parts.length ? parts.reduce((a, b) => a + b, 0) : num(r.description) ?? 1;
    if (!cur.options.some((o) => o.models === models)) cur.options.push({ models, pts: +r.cost });
  }
  const filled = tiers.filter((t) => t.options.length);
  const uniq = [];
  for (const t of filled) if (!uniq.some((u) => u.label === t.label && JSON.stringify(u.options) === JSON.stringify(t.options))) uniq.push(t);
  return uniq;
}

function deepMerge(target, patch) {
  if (Array.isArray(target) && Array.isArray(patch)) {
    const named = patch.every((p) => p && typeof p === 'object' && 'name' in p);
    if (!named) return patch;
    const out = [...target];
    for (const p of patch) {
      const i = out.findIndex((t) => t && t.name === p.name);
      if (p._delete) { if (i >= 0) out.splice(i, 1); continue; }
      if (i >= 0) out[i] = deepMerge(out[i], p); else out.push(p);
    }
    return out;
  }
  if (target && patch && typeof target === 'object' && typeof patch === 'object' && !Array.isArray(patch)) {
    const out = { ...target };
    for (const [k, v] of Object.entries(patch)) out[k] = k in out ? deepMerge(out[k], v) : v;
    return out;
  }
  return patch;
}

function build() {
  const t = Object.fromEntries(FILES.map((f) => [f, readCsv(f)]));
  const lastUpdate = t.Last_update[0]?.last_update ?? '';
  const abilityById = new Map(t.Abilities.map((a) => [a.id, a]));
  const datasheetById = new Map(t.Datasheets.map((d) => [d.id, d]));
  const by = {
    models: groupBy(t.Datasheets_models, 'datasheet_id'),
    wargear: groupBy(t.Datasheets_wargear, 'datasheet_id'),
    abilities: groupBy(t.Datasheets_abilities, 'datasheet_id'),
    keywords: groupBy(t.Datasheets_keywords, 'datasheet_id'),
    comp: groupBy(t.Datasheets_unit_composition, 'datasheet_id'),
    cost: groupBy(t.Datasheets_models_cost, 'datasheet_id'),
    options: groupBy(t.Datasheets_options, 'datasheet_id'),
    leader: groupBy(t.Datasheets_leader, 'leader_id'),
    dsStrat: groupBy(t.Datasheets_stratagems, 'datasheet_id'),
    dsEnh: groupBy(t.Datasheets_enhancements, 'datasheet_id'),
  };

  fs.mkdirSync(path.join(OUT, 'factions'), { recursive: true });
  const index = { source: 'Wahapedia 40k 11th edition data export', sourceUrl: BASE_URL, lastUpdate, factions: [] };

  for (const f of t.Factions) {
    const sheets = t.Datasheets.filter((d) => d.faction_id === f.id && d.virtual !== 'true');
    const datasheets = sheets.map((d) => {
      const kw = by.keywords.get(d.id) ?? [];
      const weapons = [];
      for (const w of by.wargear.get(d.id) ?? []) {
        const { base, profile } = splitWeaponName(w.name);
        let weapon = weapons.find((x) => x.name.toLowerCase() === base.toLowerCase());
        if (!weapon) { weapon = { name: base, profiles: [] }; weapons.push(weapon); }
        weapon.profiles.push({
          name: profile ?? base,
          range: w.range === 'Melee' ? 'Melee' : num(w.range),
          A: w.A, skill: plus(w.BS_WS), S: num(w.S), AP: num(w.AP) ?? 0, D: w.D,
          abilities: w.description ? w.description.split(/\s*,\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean) : [],
        });
      }
      const abilities = (by.abilities.get(d.id) ?? []).map((a) => {
        const ref = abilityById.get(a.ability_id);
        return {
          name: a.name || ref?.name || '',
          type: a.type,
          param: a.parameter || undefined,
          model: a.model || undefined,
          text: htmlToText(a.description || ref?.description || ''),
        };
      }).filter((a) => a.name);
      return {
        id: d.id,
        name: d.name,
        role: d.role,
        keywords: kw.filter((k) => k.is_faction_keyword !== 'true').map((k) => k.keyword.toUpperCase()),
        factionKeywords: kw.filter((k) => k.is_faction_keyword === 'true').map((k) => k.keyword.toUpperCase()),
        models: (by.models.get(d.id) ?? []).map((m) => ({
          name: m.name, M: m.M === '-' ? null : num(m.M), T: num(m.T), Sv: plus(m.Sv), InSv: plus(m.inv_sv),
          W: num(m.W), Ld: plus(m.Ld), OC: m.OC === '-' ? null : num(m.OC), base: parseBase(m.base_size),
        })),
        composition: parseComposition(by.comp.get(d.id) ?? []),
        loadout: parseLoadout(d.loadout),
        loadoutText: htmlToText(d.loadout),
        options: (by.options.get(d.id) ?? []).map((o) => htmlToText(o.description)).filter(Boolean),
        weapons,
        abilities,
        leads: (by.leader.get(d.id) ?? []).map((l) => datasheetById.get(l.attached_id)?.name).filter(Boolean),
        isSupport: d.is_support === 'true',
        transport: htmlToText(d.transport) || undefined,
        damaged: d.damaged_w ? { w: d.damaged_w, text: htmlToText(d.damaged_description) } : undefined,
        points: parsePoints(by.cost.get(d.id) ?? []),
        link: d.link,
      };
    }).filter((d) => d.models.length && d.points.length);

    const detachments = t.Detachments.filter((x) => x.faction_id === f.id).map((x) => ({
      id: x.id,
      name: x.name,
      dp: num(x.dp) ?? 1,
      forceDisposition: x.force_disposition || null,
      rules: t.Detachment_abilities.filter((a) => a.detachment_id === x.id).map((a) => ({ name: a.name, text: htmlToText(a.description) })),
      enhancements: t.Enhancements.filter((e) => e.detachment_id === x.id).map((e) => ({
        id: e.id, name: e.name, pts: num(e.cost) ?? 0, upgrade: e.upgrade === 'true', text: htmlToText(e.description),
      })),
      stratagems: t.Stratagems.filter((s) => s.detachment_id === x.id).map((s) => ({
        id: s.id, name: s.name, cp: num(s.cp_cost) ?? 1, type: s.type, turn: s.turn, phase: s.phase, text: htmlToText(s.description),
      })),
    }));

    const armyRules = t.Abilities.filter((a) => a.faction_id === f.id).map((a) => ({ name: a.name, text: htmlToText(a.description) }));

    let faction = { id: f.id, name: f.name, link: f.link, lastUpdate, armyRules, detachments, datasheets };
    const ovPath = path.join(OVERRIDES, `${f.id}.json`);
    if (fs.existsSync(ovPath)) {
      faction = deepMerge(faction, JSON.parse(fs.readFileSync(ovPath, 'utf8')));
      console.log(`applied overrides for ${f.id}`);
    }
    fs.writeFileSync(path.join(OUT, 'factions', `${f.id}.json`), JSON.stringify(faction));
    index.factions.push({ id: f.id, name: f.name, datasheets: faction.datasheets.length, detachments: faction.detachments.length });
  }
  index.factions.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`built ${index.factions.length} factions (data ${lastUpdate})`);
}

if (process.argv.includes('--fetch')) await fetchAll();
build();
