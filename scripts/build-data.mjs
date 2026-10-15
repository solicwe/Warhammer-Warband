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
import { fileURLToPath } from 'node:url';
import { factionFromPack, packFile } from './pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    .replace(/<\/t[dh]>/gi, ' ¦ ') // table cells stay apart: the app draws "a ¦ b ¦ c" lines as a table
    .replace(/<\/(p|li|div|tr)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .split('\n').filter((l) => !/^[\s¦]+$/.test(l)).map((l) => (l.includes('¦') ? l.replace(/(\s*¦\s*)+$/, '').replace(/^(\s*¦\s*)+/, '') : l)).join('\n')
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
    // "2 godhammer lascannons" -> listed twice, so the model really carries (and fires) both
    const items = m[2].replace(/\.$/, '').split(/;\s*/).flatMap((s) => Array(Math.min(+(/^(\d+)\s/.exec(s)?.[1] ?? 1), 6)).fill(s.replace(/^\d+\s+/, '').trim())).filter(Boolean);
    if (!out[who]) out[who] = items;
  }
  return out;
}

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };
const COUNT_RE = /^(\d+|one|two|three|four|five|six|a|an)\s+/i;
const countOf = (s) => { const m = COUNT_RE.exec(s); return m ? Number(m[1]) || WORDS[m[1].toLowerCase()] || 1 : 1; };
const stripCount = (s) => s.replace(/^up to (\d+|\w+)\s+/i, '').replace(COUNT_RE, '').replace(/^additional\s+/i, '').replace(/[.;,:]+$/, '').trim();
const ownerless = (x) => x.replace(/\*/g, '').replace(/\([^)]*\)?|\[[^\]]*\]?/g, '').replace(/^.*?(?:'s|\btheir|\bits)\s+/i, '').trim();
const JUNK = /following|\bor\b|^unit$|^models?$|pistol\)|one of them|^different\b|\blist\b|duplicates|cannot be|more than|\bcan be\b|[()\]]/i;
/** "2 multi-meltas and 1 storm bolter" -> ['multi-meltas', 'multi-meltas', 'storm bolter'] (repeated for counts) */
const items = (s) => s.split(/\s+and\s+|,\s*/).flatMap((raw) => {
  const body = ownerless(raw);
  const x = stripCount(body);
  if (!x || x.length > 40 || JUNK.test(x)) return [];
  return Array(Math.min(countOf(body), 6)).fill(x);
});

/** Loose key for matching wargear text to weapon names: "Astartes chain sword" ~ "Astartes chainsword", "neo volkite" ~ "neo-volkite". */
const wkey = (s) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');
export function canonWeapon(name, weapons) {
  const k = wkey(name);
  for (const c of [k, k.replace(/es$/, ''), k.replace(/s$/, '')]) {
    const w = weapons.find((x) => wkey(x.name) === c);
    if (w) return w.name;
  }
  const w = weapons.find((x) => k.startsWith(wkey(x.name)) && k.length - wkey(x.name).length <= 2);
  if (w) return w.name;
  return name.charAt(0).toUpperCase() + name.slice(1); // equipment (shield, banner ...), not a weapon
}

/** "The Intercessor Sergeant’s bolt rifle can be replaced with one of the following: • 1 power fist …" -> structured option.
 *  scope: one (this model / the named model), upTo N models, perN (for every N models, `max` of them), any number, all.
 *  stack: "This model can be equipped with up to 4 X" (count = copies on one model). pick: "two different weapons from the following list". */
export function parseWargearOption(text, weapons = []) {
  let t = text.replace(/\s+/g, ' ').replace(/’/g, "'").trim();
  if (!t || /^none$/i.test(t) || /^\*/.test(t)) return null;
  const opt = { text: t, scope: 'one', who: '*', replace: [], choices: [] };
  let m;
  // conditions first: "If this unit contains 12 models, …" / "If the Reiver Sergeant is equipped with 1 bolt carbine, it can be equipped with …"
  if ((m = t.match(/^If this unit contains (\d+) models,\s*/i))) { opt.minModels = +m[1]; t = t.slice(m[0].length); t = t.charAt(0).toUpperCase() + t.slice(1); }
  if ((m = t.match(/^If (?:this model|the ([A-Z][\w -]+?)) is equipped with (.+?), (?:it|its|they) /i))) {
    if (m[1]) opt.who = m[1].trim();
    if (!/\bnot\b/i.test(t.slice(0, m.index + m[0].length))) opt.requires = items(m[2]);
  }
  // "(this model's X cannot be replaced)" / "This model's X cannot be replaced." are notes, not replacements
  t = t.replace(/\([^)]*cannot be replaced[^)]*\)/gi, '').replace(/[^.•]*cannot be replaced\.?/gi, '').trim();
  // "(a model cannot be equipped with more than one electroscourge)": a note, not a choice
  const uniq = t.match(/cannot be equipped with more than one ([\w -]+?)\)/i);
  if (uniq) opt.unique = [uniq[1].trim()];
  t = t.replace(/\s*\([^)]*cannot be equipped with[^)]*\)/gi, '').trim();
  // "This model can be equipped with 1 havoc launcher or can replace 1 combi-bolter with 1 havoc launcher": the gain is what counts
  t = t.replace(/^(This model can be equipped with [^.]+?) or can replace .*$/i, '$1.');
  if ((m = t.match(/^For every (\d+|\w+) (models?|[A-Z][\w' -]+?) in (?:this|the) unit,? (?:up to )?(\d+|\w+)?/i))) {
    opt.scope = 'perN'; opt.per = Number(m[1]) || WORDS[m[1].toLowerCase()] || 5; opt.max = Number(m[3]) || WORDS[(m[3] ?? '').toLowerCase()] || 1;
    // "For every 5 Inquisitorial Agents": only those models count, not the Gun Servitors
    if (!/^models?$/i.test(m[2])) opt.perOf = m[2].trim();
  } else if (/^Any number of/i.test(t)) opt.scope = 'any';
  else if (/^All (?:of )?(?:the )?(?:[\w-]+ ){0,3}(?:models|in this unit)/i.test(t)) opt.scope = 'all';
  else if ((m = t.match(/^Up to (\d+|\w+)/i))) { opt.scope = 'upTo'; opt.max = Number(m[1]) || WORDS[m[1].toLowerCase()] || 1; }
  else if (/^(One|1) /i.test(t)) { opt.scope = 'upTo'; opt.max = 1; }
  else if ((m = t.match(/^This model can be equipped with up to (\d+|\w+)/i))) { opt.scope = 'upTo'; opt.max = Number(m[1]) || WORDS[m[1].toLowerCase()] || 1; opt.stack = true; }
  // who: "The Intercessor Sergeant's …", "Any number of Initiates can …", "One Incursor can …", "1 Nob model can …"
  const whoClean = (w) => (/^models?$/i.test(w) ? '*' : w.replace(/ in this unit$/i, '').replace(/ (?:equipped with|that|who) .*$/i, '').replace(/ models?$/i, '').trim());
  if (opt.who === '*') {
    if ((m = t.match(/^(?:The|An?|Each|Every) ([A-Z][\w -]+?)(?:'s|(?<=s)'(?= )| can)/))) opt.who = whoClean(m[1]);
    else if ((m = t.match(/^(?:Any number of|Up to \w+|One|1|All(?: of the)?) ([A-Z][\w -]+?)(?: models?)?(?:'s| can)/))) opt.who = whoClean(m[1]);
    else if ((m = t.match(/^For every \w+ (?:models?|[A-Z][\w' -]+?) in this unit,? (?:up to \w+ )?(?:1 |one )?([A-Z][\w -]+?)(?: models?)?(?:'s|(?<=s)'(?= )| equipped| can)/))) opt.who = whoClean(m[1]);
  }
  // "For every 5 Inquisitorial Agents in this unit, it can be equipped with …": one of the counted models carries it
  if (opt.who === '*' && (m = t.match(/^For every \w+ ([A-Z][\w' -]+?) in (?:this|the) unit/))) opt.who = whoClean(m[1]);
  // what is replaced: "have their X replaced", "X's Y can be replaced", "can replace its X with …"
  let choiceBody = null;
  if ((m = t.match(/can (?:each )?replace (?:its|their) (.+?) with (.+)$/i))) { opt.replace = items(m[1]); choiceBody = m[2]; }
  else if ((m = t.match(/have (?:their|its) (.+?) replaced/i)) || (m = t.match(/(?:'s|s'|their|its) (.+?) (?:can )?(?:each )?(?:be )?replaced/i))) opt.replace = items(m[1]);
  // "… replaced with 1 twin lightning claws, or two different weapons from the following list: • …"
  if ((m = t.match(/(two|three|2|3) different (?:weapons|items) from the following list:?\*?\s*(.+)$/i))) {
    opt.pick = Number(m[1]) || WORDS[m[1].toLowerCase()];
    opt.pickFrom = m[2].split('•').map((x) => x.trim()).filter(Boolean).flatMap(items);
    const before = t.slice(0, m.index).match(/replaced with (.+?),? or $/i);
    if (before) opt.choices = [items(before[1])];
  } else {
    if (choiceBody === null) {
      // the choices follow the LAST "replaced (with)" / "equipped with"
      const low = t.toLowerCase();
      const idx = Math.max(low.lastIndexOf('replaced'), low.lastIndexOf('equipped with'));
      const after = idx >= 0 ? t.slice(idx).match(/(?:replaced(?: with)?|equipped with)(?: (?:one|1) of the following)?:?\s*(.+)$/i) : null;
      choiceBody = after ? after[1] : null;
    }
    if (choiceBody !== null) {
      choiceBody = choiceBody.replace(/^(?:one|1) of the following:?\s*/i, '');
      if (choiceBody.includes('•')) opt.choices = choiceBody.split('•').map((x) => x.trim()).filter(Boolean).map(items);
      else opt.choices = [items(choiceBody.split(/\.\s/)[0])];
    }
  }
  opt.choices = opt.choices.filter((c) => c.length);
  // "1 model equipped with a Y can be equipped with Z" mentions Y as a requirement, not a replacement
  if (!opt.requires && (m = t.match(/equipped with (?:a |an |1 )?(.+?) can (?:be equipped with|have)/i)) && !opt.replace.length) opt.requires = items(m[1]);
  if (!opt.choices.length && !opt.pick) return null;
  const canon = (arr) => arr.map((x) => canonWeapon(x, weapons));
  // "its excruciator cannons can be replaced with 2 …": a plural carried twice goes as a pair
  const rawReplace = opt.replace;
  opt.replace = canon(opt.replace);
  if (opt.replace.length === 1 && /s$/i.test(rawReplace[0]) && !/s$/i.test(opt.replace[0]) && opt.choices.length && opt.choices.every((c) => c.length === 2 && c[0] === c[1])) opt.replace = [opt.replace[0], opt.replace[0]];
  if (opt.unique) opt.unique = canon(opt.unique);
  opt.choices = opt.choices.map(canon);
  if (opt.pickFrom) opt.pickFrom = [...new Set(canon(opt.pickFrom))];
  if (opt.requires) opt.requires = canon(opt.requires);
  return opt;
}

function parsePoints(rows) {
  // Keep the first price tier ("YOUR UNIT COSTS" / "YOUR 1ST TO 3RD UNITS COST"), drop duplicates.
  const tiers = [];
  let cur = null;
  const wargear = [];
  for (const r of rows) {
    const desc = htmlToText(r.description ?? '').replace(/^\+\s*/, '+ ');
    if (r.cost && /^(per |\+ )/i.test(desc)) { wargear.push({ name: desc.replace(/^(per |\+ )\s*(\d+\s+)?/i, '').trim(), pts: +r.cost }); continue; }
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
  const wg = [];
  for (const w of wargear) if (!wg.some((x) => x.name.toLowerCase() === w.name.toLowerCase())) wg.push(w);
  return { tiers: uniq, wargear: wg };
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

// ---------- points updates (Munitorum Field Manual), data/points/*.txt ----------
// "FACTION | Datasheet | 5=115/125,10=210/220" — models=cost on the first price tier / the later tier ("YOUR 3RD + UNIT
// COSTS"); "t2:" only the later tier; "=95" or "=95/105" for a unit with one size; "enh:Name" for an enhancement.
const normName = (s) => s.toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, '');
const POINTS_DIR = path.join(path.dirname(OVERRIDES), 'points');
const pointsLines = fs.existsSync(POINTS_DIR)
  ? fs.readdirSync(POINTS_DIR).filter((f) => f.endsWith('.txt')).sort().flatMap((f) => fs.readFileSync(path.join(POINTS_DIR, f), 'utf8').split('\n'))
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split('|').map((x) => x.trim()))
  : [];
const pointsMisses = [];
function applyPointsUpdates(faction, fid) {
  for (const [fac, name, spec0, extra] of pointsLines) {
    if (fac !== fid) continue;
    let spec = spec0, only = null;
    const replaceSizes = spec.startsWith('!');
    if (replaceSizes) spec = spec.slice(1);
    const m0 = /^t([12]):/.exec(spec);
    if (m0) { only = Number(m0[1]); spec = spec.slice(m0[0].length); }
    const vals = (v) => v.split('/').map((x) => (x.trim() === '' ? undefined : Number(x)));
    if (name.startsWith('enh:')) {
      const e = faction.detachments.flatMap((d) => d.enhancements).filter((x) => normName(x.name) === normName(name.slice(4)));
      if (!e.length) pointsMisses.push(`${fid} ${name}`);
      for (const x of e) x.pts = vals(spec.replace(/^=/, ''))[0];
      continue;
    }
    const d = faction.datasheets.find((x) => normName(x.name) === normName(name));
    if (!d || !d.points?.length) { pointsMisses.push(`${fid} ${name}: no such datasheet`); continue; }
    const pairs = spec.startsWith('=') ? [[null, vals(spec.slice(1))]] : spec.split(',').map((x) => { const [m, v] = x.split('='); return [Number(m), vals(v)]; });
    // "!4=180/190,5=225/235": the unit now comes in these sizes (the later tier stays a flat extra on a pack's unit)
    if (replaceSizes) {
      d.points = d.points.slice(0, 1);
      d.points[0].options = pairs.filter(([m, v]) => m !== null && v[0] !== undefined).map(([m, v]) => ({ models: m, pts: v[0] }));
      if (d.dupTax && pairs[0]?.[1][1] !== undefined) d.dupTax = { ...d.dupTax, pts: pairs[0][1][1] - pairs[0][1][0] };
      if (!d.dupTax && pairs.some(([, v]) => v[1] !== undefined)) d.points.push({ label: 'YOUR 3RD + UNIT COSTS', options: pairs.filter(([m, v]) => m !== null && v[1] !== undefined).map(([m, v]) => ({ models: m, pts: v[1] })) });
    }
    // "comp:Custodian Guard=4-5": how many of that model the unit has
    const cm = /^comp:(.+)=(\d+)-(\d+)$/.exec(extra ?? '');
    if (cm) {
      const c = d.composition.find((x) => normName(x.name ?? '') === normName(cm[1]));
      if (c) { c.min = +cm[2]; c.max = +cm[3]; c.text = `${c.min}-${c.max} ${c.name}`; } else pointsMisses.push(`${fid} ${name}: no model ${cm[1]}`);
    }
    if (replaceSizes) continue;
    const setTier = (ti, models, pts) => {
      const tier = d.points[ti];
      if (!tier) return false;
      const opts = models === null ? tier.options : tier.options.filter((o) => o.models === models);
      if (!opts.length || (models === null && new Set(tier.options.map((o) => o.models)).size > 1)) return false;
      for (const o of opts) o.pts = pts;
      return true;
    };
    for (const [models, v] of pairs) {
      const t1 = only === 2 ? undefined : v[0], t2 = only === 2 ? v[0] : v[1];
      if (t1 !== undefined && !setTier(0, models, t1)) pointsMisses.push(`${fid} ${name}: no ${models ?? 'single'}-model option`);
      if (t2 === undefined) continue;
      if (d.points.length > 1) { if (!setTier(1, models, t2)) pointsMisses.push(`${fid} ${name}: no later-tier ${models ?? 'single'}-model option`); }
      else if (d.dupTax) {
        // a pack's unit: one price list plus a flat extra for later copies
        const base = (models === null ? d.points[0].options[0] : d.points[0].options.find((o) => o.models === models))?.pts;
        if (base !== undefined) d.dupTax = { ...d.dupTax, pts: t2 - base };
      } else pointsMisses.push(`${fid} ${name}: no later price tier`);
    }
  }
}

const META = JSON.parse(fs.readFileSync(path.join(path.dirname(OVERRIDES), 'factions-meta.json'), 'utf8'));

/** Which sub-faction (e.g. Chapter) a detachment belongs to: an explicit entry in factions-meta.json,
 *  else the sub-faction keyword its rules / enhancements / stratagems name most often. */
function detachmentSubfaction(sub, d) {
  if (!sub) return undefined;
  if (d.name in (sub.detachments ?? {})) return sub.detachments[d.name] || undefined;
  const txt = JSON.stringify([d.rules, d.enhancements, d.stratagems]).toUpperCase();
  let best, n = 0;
  for (const o of sub.options) {
    const c = txt.split(o.keyword).length - 1;
    if (c > n) { best = o.keyword; n = c; }
  }
  return best;
}

/** Units another army's book now holds, listed again for one of this army's sub-factions. */
const BORROW = {
  // (the Deathwatch keep their own faction pack in 11th edition: nothing borrowed from Imperial Agents any more)
};

function build() {
  const t = Object.fromEntries(FILES.map((f) => [f, readCsv(f)]));
  const lastUpdate = t.Last_update[0]?.last_update ?? '';
  const abilityById = new Map(t.Abilities.map((a) => [a.id, a]));
  const sourceById = new Map(t.Source.map((s) => [s.id, s]));
  const excludeRe = (META.excludeSources?.patterns ?? []).map((p) => new RegExp(p, 'i'));
  const keepEd = META.excludeSources?.keepEditions;
  const keepIds = META.excludeSources?.keepSources?.ids ?? [];
  const excludedSource = (id) => {
    if (keepIds.includes(id)) return false;
    const s = sourceById.get(id);
    if (!s) return !!keepEd; // no source at all: not a published 11th edition datasheet
    if (excludeRe.some((r) => r.test(s.name))) return true;
    return !!keepEd && !keepEd.includes(String(s.edition));
  };
  let dropped = 0;
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
    // 11th edition moved some sub-faction units to another army's book (the Deathwatch went to Imperial Agents):
    // they come back here, for that sub-faction
    const borrow = BORROW[f.id] ?? [];
    const borrowed = new Map();
    for (const br of borrow) {
      for (const d of t.Datasheets) {
        if (d.faction_id !== br.from || d.virtual === 'true' || excludedSource(d.source_id)) continue;
        // only what this army's own books don't have (its own Watch Master, Corvus Blackstar … come first)
        if (t.Datasheets.some((x) => x.faction_id === f.id && x.name === d.name && x.virtual !== 'true' && !excludedSource(x.source_id))) continue;
        if ((by.keywords.get(d.id) ?? []).some((k) => k.keyword.toUpperCase() === br.keyword)) borrowed.set(d.id, br);
      }
    }
    // a unit the Munitorum Field Manual prices is in the game, whichever page its datasheet is on (Forge World …)
    const priced = new Set(pointsLines.filter(([fac]) => fac === f.id).map(([, n]) => normName(n)));
    const inGame = (d) => !excludedSource(d.source_id) || priced.has(normName(d.name));
    const sheets = [...t.Datasheets.filter((d) => d.faction_id === f.id && d.virtual !== 'true' && inGame(d)), ...t.Datasheets.filter((d) => borrowed.has(d.id))];
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
        wargearOptions: (by.options.get(d.id) ?? []).map((o) => parseWargearOption(htmlToText(o.description).replace(/\n/g, ' '), weapons)).filter(Boolean),
        weapons,
        abilities,
        leads: (by.leader.get(d.id) ?? []).map((l) => datasheetById.get(l.attached_id)?.name).filter(Boolean),
        isSupport: d.is_support === 'true',
        transport: htmlToText(d.transport) || undefined,
        damaged: d.damaged_w ? { w: d.damaged_w, text: htmlToText(d.damaged_description) } : undefined,
        ...(() => { const pp = parsePoints(by.cost.get(d.id) ?? []); return { points: pp.tiers, wargearCosts: pp.wargear.map((w) => ({ ...w, name: canonWeapon(w.name, weapons) })) }; })(),
        link: d.link,
      };
    }).filter((d) => d.models.length && d.points.length);

    dropped += t.Datasheets.filter((d) => d.faction_id === f.id && d.virtual !== 'true' && !inGame(d)).length;
    const detachments = t.Detachments.filter((x) => x.faction_id === f.id && (x.force_disposition || !META.excludeDetachmentsWithoutForceDisposition)).map((x) => ({
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

    for (const d of datasheets) {
      const br = borrowed.get(d.id);
      if (!br) continue;
      d.factionKeywords = [...new Set([...br.factionKeywords, br.keyword])];
      d.borrowedFrom = br.from;
    }
    const sub = META.subfactions[f.id];
    if (sub) {
      const keys = sub.options.map((o) => o.keyword);
      for (const d of datasheets) { const k = d.factionKeywords.find((x) => keys.includes(x)); if (k) d.subfaction = k; }
      for (const d of detachments) { const k = detachmentSubfaction(sub, d); if (k) d.subfaction = k; }
    }
    let faction = { id: f.id, name: f.name, link: f.link, lastUpdate, armyRules, detachments, datasheets, ...(sub ? { subfactions: { label: sub.label, options: sub.options } } : {}) };
    const ovPath = path.join(OVERRIDES, `${f.id}.json`);
    if (fs.existsSync(ovPath)) {
      faction = deepMerge(faction, JSON.parse(fs.readFileSync(ovPath, 'utf8')));
      console.log(`applied overrides for ${f.id}`);
    }
    // a newer book as a ListForge pack replaces the Wahapedia datasheets / rules / detachments (data/packs)
    const pf = packFile(path.join(ROOT, 'data/packs'), f.id);
    if (fs.existsSync(pf)) {
      const waha = faction;
      faction = factionFromPack(pf, faction, sub);
      // units the book leaves out but the points list prices (Valerian): kept from the Wahapedia data
      for (const d of waha.datasheets) {
        if (!pointsLines.some(([fac, n]) => fac === f.id && normName(n) === normName(d.name)) || faction.datasheets.some((x) => normName(x.name) === normName(d.name))) continue;
        // its army rule is the book's (Combat Doctrines, not the old Oath of Moment), spelled as the book spells it
        const rules = new Set(faction.datasheets.flatMap((x) => x.abilities.filter((a) => a.type === 'Faction').map((a) => a.name)));
        const own = d.abilities.map((a) => ({ ...a, name: a.name.replace(/’/g, "'") })).filter((a) => a.type !== 'Faction' || rules.has(a.name));
        const common = [...rules].find((r) => faction.datasheets.filter((x) => x.abilities.some((a) => a.name === r)).length > faction.datasheets.length / 2);
        if (common && !own.some((a) => a.name === common)) own.push(faction.datasheets.flatMap((x) => x.abilities).find((a) => a.name === common));
        faction.datasheets.push({ ...d, abilities: own });
      }
      console.log(`built ${f.id} from ${faction.source.pack} (revision ${faction.source.revision})`);
    }
    applyPointsUpdates(faction, f.id);
    // Leader lists: only units that are in the game (Legends and removed datasheets drop out), and a leader on foot
    // can't lead a unit that moves differently (JUMP PACK / MOUNTED) — Wahapedia's own lists leave those out too
    const present = new Map(faction.datasheets.map((d) => [d.name, d]));
    const moves = ['JUMP PACK', 'MOUNTED'];
    for (const d of faction.datasheets) {
      d.leads = [...new Set(d.leads ?? [])].filter((n) => {
        const t = present.get(n);
        return t && moves.every((k) => !t.keywords.includes(k) || d.keywords.includes(k));
      });
    }
    fs.writeFileSync(path.join(OUT, 'factions', `${f.id}.json`), JSON.stringify(faction));
    const group = Object.entries(META.groups).find(([, ids]) => ids.includes(f.id))?.[0] ?? 'Other';
    index.factions.push({ id: f.id, name: f.name, group, datasheets: faction.datasheets.length, detachments: faction.detachments.length, ...(sub ? { subfactions: sub.options.map((o) => o.name) } : {}) });
  }
  index.factions.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  if (pointsMisses.length) console.log(`points updates not applied (${pointsMisses.length}):\n  ${pointsMisses.join('\n  ')}`);
  console.log(`built ${index.factions.length} factions (data ${lastUpdate}); left out ${dropped} non-11th-edition (Legends / Forge World / old index) datasheets`);
}

if (process.argv.includes('--fetch')) await fetchAll();
build();
