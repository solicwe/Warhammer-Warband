// Bot self-play tuning: hill-climbs the bot's weights (src/engine/botWeights.ts) by playing a changed set against the
// current best on several CPU cores, keeping the change when it wins clearly. The best set is written to
// data/bot-weights.json, which the bot loads by default.
//   node scripts/tune.mjs --iters 30 --games 24 --workers 4 --log tune-log.txt [--auto: lists for every faction]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ITERS = Number(arg('iters', 20));
const GAMES = Number(arg('games', 24)); // per candidate, even: each matchup is played from both sides
const WORKERS = Number(arg('workers', Math.max(1, os.cpus().length)));
const LOG = arg('log', 'tune-log.txt');
const SEED0 = Number(arg('seed', 5000));
const ACCEPT = Number(arg('accept', 1.5)); // mean VP margin a change must win by
const WEIGHTS = 'data/bot-weights.json';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tune-'));

const src = fs.readFileSync('src/engine/botWeights.ts', 'utf8');
const block = /DEFAULT_W = \{([\s\S]*?)\n\};/.exec(src)[1];
const DEFAULT = Object.fromEntries([...block.matchAll(/(\w+): ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
let best = { ...DEFAULT, ...JSON.parse(fs.readFileSync(WEIGHTS, 'utf8')) };

// --auto: every faction with a list made from its data (src/engine/autoList.ts), so the weights suit all armies
const index = JSON.parse(fs.readFileSync('public/data/index.json', 'utf8'));
const ARMIES = process.argv.includes('--auto')
  ? (index.factions ?? index).map((f) => f.id).filter((id) => !['TL', 'UA'].includes(id)).map((id) => `auto:${id}`)
  : ['SM gunline', 'SM assault', 'ORK horde', 'ORK mixed'];
const log = (line) => { console.log(line); fs.appendFileSync(LOG, `${line}\n`); };

let rng = SEED0 * 7 + 1;
const rnd = () => { rng = (rng * 16807) % 2147483647; return rng / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

function perturb(w) {
  const keys = Object.keys(DEFAULT);
  const n = 2 + Math.floor(rnd() * 3);
  const out = { ...w };
  const changed = [];
  for (let i = 0; i < n; i++) {
    const k = keys[Math.floor(rnd() * keys.length)];
    if (k === 'advanceMargin') out[k] = Math.max(0, +(w[k] + gauss() * 1.5).toFixed(2));
    else out[k] = +(w[k] * Math.exp(gauss() * 0.35)).toFixed(3);
    changed.push(`${k} ${w[k]}→${out[k]}`);
  }
  return { w: out, changed };
}

/** The games of one evaluation: every ordered pair of armies, each from both sides, on varied seeds. */
function schedule(iter) {
  const games = [];
  let i = 0;
  while (games.length < GAMES) {
    // every army in turn, against a rotating opponent (all pairs for the four hand-made lists)
    const a = ARMIES[(i + iter * 5) % ARMIES.length], b = ARMIES[(Math.floor(i / ARMIES.length) + i * 7 + 3 + iter) % ARMIES.length];
    const seed = SEED0 + iter * 1000 + i;
    games.push({ a, b, seed, sideA: 0 }, { a: b, b: a, seed, sideA: 1 }); // same map, armies and sides swapped
    i++;
  }
  return games.slice(0, GAMES);
}

function runWorker(job) {
  return new Promise((resolve) => {
    const file = path.join(TMP, `job-${Math.random().toString(36).slice(2)}.json`);
    job.out = `${file}.out`;
    fs.writeFileSync(file, JSON.stringify(job));
    const p = spawn('npx', ['vitest', 'run', 'src/engine/tune.test.ts', '--reporter=dot'], { env: { ...process.env, TUNE_JOB: file }, stdio: 'ignore' });
    p.on('exit', () => {
      try { resolve(JSON.parse(fs.readFileSync(job.out, 'utf8'))); } catch { resolve(job.games.map(() => ({ error: 'worker failed' }))); }
    });
  });
}

/** Mean VP margin of `wA` over `wB`, with wins / draws / losses. */
async function evaluate(wA, wB, iter, baselineB = false) {
  const games = schedule(iter);
  const shards = Array.from({ length: WORKERS }, (_, k) => games.filter((_, i) => i % WORKERS === k)).filter((g) => g.length);
  const res = (await Promise.all(shards.map((g) => runWorker({ games: g, wA, wB, baselineB, look: process.argv.includes('--look') })))).flat();
  const ms = res.filter((x) => typeof x === 'number');
  const errors = res.length - ms.length;
  const mean = ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length);
  const sd = Math.sqrt(ms.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ms.length - 1));
  return { mean, se: sd / Math.sqrt(Math.max(1, ms.length)), win: ms.filter((x) => x > 0).length, draw: ms.filter((x) => x === 0).length, loss: ms.filter((x) => x < 0).length, errors };
}

// --ab: the live bot code against the frozen baseline (scripts/bot-baseline/snapshot.mjs), same weights, then stop
if (process.argv.includes('--ab')) {
  const t0 = Date.now();
  const r = await evaluate(best, best, Number(arg('round', 0)), true);
  log(`AB live vs baseline: margin ${r.mean.toFixed(1)}±${r.se.toFixed(1)} W${r.win} D${r.draw} L${r.loss}${r.errors ? ` E${r.errors}` : ''} · ${GAMES} games · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(0);
}
log(`# tune ${new Date().toISOString()} iters ${ITERS} games ${GAMES} workers ${WORKERS}`);
for (let it = 0; it < ITERS; it++) {
  const t0 = Date.now();
  const { w, changed } = perturb(best);
  const r = await evaluate(w, best, it);
  // a change must win by a margin that noise rarely gives (one standard error and at least ACCEPT VP)
  const ok = r.mean >= Math.max(ACCEPT, r.se) && r.win > r.loss && !r.errors;
  log(`${it} ${ok ? 'ACCEPT' : 'reject'} margin ${r.mean.toFixed(1)}±${r.se.toFixed(1)} W${r.win} D${r.draw} L${r.loss}${r.errors ? ` E${r.errors}` : ''} · ${changed.join(', ')} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (ok) {
    best = w;
    const diff = Object.fromEntries(Object.entries(best).filter(([k, v]) => v !== DEFAULT[k]));
    fs.writeFileSync(WEIGHTS, `${JSON.stringify(diff, null, 2)}\n`);
  }
}
// the final set against the untouched defaults, on fresh seeds
const fin = await evaluate(best, DEFAULT, 900);
log(`FINAL tuned vs defaults: margin ${fin.mean.toFixed(1)}±${fin.se.toFixed(1)} W${fin.win} D${fin.draw} L${fin.loss}`);
