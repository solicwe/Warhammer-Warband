// npm run data:meta: what tournament players actually take, from listhammer.info (11th edition GT lists).
// 1. every 40k faction page names its recent events; each event's API lists its players; each player's list is
//    fetched once and kept in node_modules/.cache/listhammer (a rerun only fetches what is new).
// 2. each list is read unit by unit ("Name (N points)", then "Nx Item" lines); the items a datasheet has are counted.
// 3. per datasheet: the most played model count and, at that count, the most played set of items, written to
//    data/wargear-meta.json. The army builder starts a new unit with that loadout (defaultWargear in army.ts).
// Options: --offline (only the cache), --delay=ms between requests (default 300), --max=lists (default 3000; an event
// has up to 150 players and the faction pages name 200 events, so all of them would be 30 000 requests).
import fs from 'node:fs';
import path from 'node:path';

const SLUGS = ['adepta-sororitas', 'adeptus-custodes', 'adeptus-mechanicus', 'aeldari', 'astra-militarum', 'black-templars',
  'blood-angels', 'chaos-daemons', 'chaos-knights', 'chaos-space-marines', 'dark-angels', 'death-guard', 'deathwatch',
  'drukhari', 'emperors-children', 'genestealer-cult', 'grey-knights', 'imperial-agents', 'imperial-knights',
  'leagues-of-votann', 'necrons', 'orks', 'space-marines', 'space-wolves', 'tau-empire', 'thousand-sons', 'tyranids',
  'world-eaters'];
const SITE = 'https://listhammer.info';
const CACHE = 'node_modules/.cache/listhammer';
const OUT = 'data/wargear-meta.json';
const offline = process.argv.includes('--offline');
const delay = Number(process.argv.find((a) => a.startsWith('--delay='))?.slice(8) ?? 300);
const maxLists = Number(process.argv.find((a) => a.startsWith('--max='))?.slice(6) ?? 3000);

fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fetched = 0;
/** A page or API answer, from the cache when there (`keep`: cache it for good; faction pages are refetched). */
async function get(url, file, keep = true) {
  const f = path.join(CACHE, file);
  if (fs.existsSync(f) && (keep || offline)) return fs.readFileSync(f, 'utf8');
  if (offline) return null;
  for (let tries = 0; tries < 3; tries++) {
    try {
      await sleep(delay);
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) { if (r.status === 404) return null; throw new Error(`${r.status}`); }
      const text = await r.text();
      fs.writeFileSync(f, text);
      fetched++;
      return text;
    } catch (e) {
      if (tries === 2) { console.warn(`skip ${url}: ${e.message}`); return null; }
      await sleep(2000);
    }
  }
}

// ---- 1. lists ----
const lists = []; // { faction, text }
const events = new Set();
for (const slug of SLUGS) {
  const html = await get(`${SITE}/factions/${slug}`, `f-${slug}.html`, false);
  if (!html) continue;
  for (const m of html.matchAll(/href="\/events\/([a-z0-9]+)"/g)) events.add(m[1]);
  const nuxt = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nuxt) for (const x of JSON.parse(nuxt[1])) if (typeof x === 'string' && x.includes('oints)') && /\d+x /.test(x)) lists.push({ key: x.slice(0, 200), text: x });
}
console.log(`${events.size} events`);
let n = 0;
for (const uid of events) {
  const raw = await get(`${SITE}/api/events/${uid}`, `e-${uid}.json`);
  if (!raw) continue;
  let ev;
  try { ev = JSON.parse(raw); } catch { continue; }
  if (ev.eventResult?.gameType !== '40k') continue;
  // at most 40 lists of one event, so the lists come from many events; four requests at a time
  const players = (ev.eventPlayersResult ?? []).filter((p) => p.hasList && p.listUid).slice(0, 40);
  if (lists.length >= maxLists) break;
  for (let i = 0; i < players.length; i += 4) {
    await Promise.all(players.slice(i, i + 4).map(async (p) => {
      const t = await get(`${SITE}/api/eventList?eventId=${ev.eventResult.id}&playerId=${p.playerId}`, `l-${p.listUid}.json`);
      try { const list = t && JSON.parse(t).list; if (list) lists.push({ key: p.listUid, text: list }); } catch { /* not a list */ }
    }));
  }
  if (++n % 20 === 0) console.log(`${n}/${events.size} events, ${lists.length} lists, ${fetched} fetched`);
}
const seen = new Set();
const unique = lists.filter((l) => { const k = l.text.replace(/\s+/g, ' ').trim(); if (seen.has(k)) return false; seen.add(k); return true; });
console.log(`${unique.length} lists`);

// ---- 2. datasheets of the game ----
/** Same name however it is written: case, punctuation, plurals ("Storm Bolters" = "Storm bolter"). */
const norm = (s) => s.toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map((w) => (w.length > 3 ? w.replace(/(es|s)$/, '') : w)).join(' ');
const sheets = new Map(); // norm name -> [sheet]
for (const f of fs.readdirSync('public/data/factions')) {
  const fac = JSON.parse(fs.readFileSync(path.join('public/data/factions', f), 'utf8'));
  for (const d of fac.datasheets ?? []) {
    const k = norm(d.name);
    if (!sheets.has(k)) sheets.set(k, []);
    if (!sheets.get(k).some((x) => x.name === d.name)) sheets.get(k).push(d);
  }
}
/** Every item a datasheet can carry, by its normalized name. */
function itemsOf(d) {
  const out = new Map();
  const add = (x) => { if (x && !out.has(norm(x))) out.set(norm(x), x); };
  for (const w of d.weapons ?? []) add(w.name);
  for (const o of d.wargearOptions ?? []) { o.replace.forEach(add); o.choices.forEach((c) => c.forEach(add)); (o.pickFrom ?? []).forEach(add); }
  for (const l of Object.values(d.loadout ?? {})) (Array.isArray(l) ? l : []).forEach((x) => add(typeof x === 'string' ? x : x?.name));
  (d.gear ?? []).forEach(add);
  for (const c of d.wargearCosts ?? []) add(c.name);
  return out;
}
const itemCache = new Map();
function findSheet(name) {
  let k = norm(name);
  if (sheets.has(k)) return sheets.get(k)[0];
  k = norm(name.replace(/\s+with\s+.*$/i, ''));
  return sheets.get(k)?.[0];
}

// ---- 3. units and counts ----
const per = new Map(); // sheet name -> [{ models, items: {name: n} }]
for (const { text } of unique) {
  const lines = text.split('\n').map((l) => l.trim());
  let cur = null;
  const flush = () => { if (cur) { if (!per.has(cur.sheet.name)) per.set(cur.sheet.name, []); per.get(cur.sheet.name).push(cur); } cur = null; };
  for (const line of lines) {
    const h = line.match(/^(.+?) \((\d+) [Pp]oints?\)$/);
    if (h) {
      flush();
      const sheet = findSheet(h[1]);
      if (sheet) {
        if (!itemCache.has(sheet.name)) itemCache.set(sheet.name, itemsOf(sheet));
        cur = { sheet, pts: Number(h[2]), models: 0, items: {} };
      }
      continue;
    }
    if (!cur) continue;
    const it = line.match(/^[•◦\-*\s]*(\d+)x\s+(.+?)\.?$/);
    if (!it) continue;
    const k = norm(it[2]);
    const known = itemCache.get(cur.sheet.name);
    if (known.has(k)) cur.items[known.get(k)] = (cur.items[known.get(k)] ?? 0) + Number(it[1]);
    else if (/^[•\s]/.test(line) && !/^(Attached|Warlord|Enhancement)/i.test(it[2])) cur.models += Number(it[1]);
  }
  flush();
}

// ---- 4. most played loadout ----
const out = {};
for (const [name, entries] of [...per].sort((a, b) => a[0].localeCompare(b[0]))) {
  const sheet = findSheet(name);
  const sizes = (sheet.points?.[0]?.options ?? []).map((o) => o.models);
  // model count: the counted model lines when they give a legal size, else from the points paid
  for (const e of entries) {
    if (sizes.includes(e.models)) continue;
    const opts = [...(sheet.points?.[0]?.options ?? [])].sort((a, b) => b.pts - a.pts);
    e.models = (opts.find((o) => o.pts <= e.pts) ?? opts[opts.length - 1])?.models ?? 1;
  }
  const mode = (xs) => { const c = new Map(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]; };
  const [models] = mode(entries.map((e) => e.models));
  const at = entries.filter((e) => e.models === models);
  const sig = (e) => JSON.stringify(Object.entries(e.items).sort());
  const [best, times] = mode(at.map(sig));
  // items some list named but the chosen loadout leaves out count as 0: only names the lists use are compared (the
  // GW app and Wahapedia name some weapons differently: "Deathwatch thunder hammer", "Heavy Thunder Hammer")
  const items = Object.fromEntries([...new Set(entries.flatMap((e) => Object.keys(e.items)))].sort().map((k) => [k, 0]));
  Object.assign(items, Object.fromEntries(JSON.parse(best)));
  out[name] = { models, lists: entries.length, same: times, items };
}
const doc = {
  source: 'listhammer.info: 11th edition GT army lists (event player lists)',
  date: new Date().toISOString().slice(0, 10),
  lists: unique.length,
  note: 'models: most played unit size; items: the most played loadout at that size (whole unit, counted; 0 = named in other lists, not in this one); lists: how many lists took the unit; same: how many of them had exactly this loadout',
  units: out,
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
const all = [...sheets.values()].flat().length;
console.log(`${OUT}: ${Object.keys(out).length} datasheets of ${all} (from ${unique.length} lists, ${fetched} fetched)`);
