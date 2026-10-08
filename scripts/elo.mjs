// Bot Elo ladder: the live bot (src/engine/bot*.ts) plays the frozen baseline (src/engine/baseline) with every
// faction, each pairing from both sides on the same map, on several CPU cores. The score turns into an Elo
// difference; the baseline's rating plus that difference is the live bot's rating, kept in data/bot-elo.json so every
// change to the bot can be checked against the last one.
//   node scripts/elo.mjs --games 48 --workers 4 --label "army plan"
//   node scripts/elo.mjs ... --promote      (then freeze the live bot as the new baseline, carrying its rating)
//   node scripts/elo.mjs ... --look         (with the turn lookahead on: closer to the app, several times slower)
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const GAMES = Number(arg('games', 48));
const WORKERS = Number(arg('workers', Math.max(1, os.cpus().length)));
const SEED0 = Number(arg('seed', 7000));
const LABEL = arg('label', 'live');
const FILE = 'data/bot-elo.json';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'elo-'));

const index = JSON.parse(fs.readFileSync('public/data/index.json', 'utf8'));
const all = (index.factions ?? index).map((f) => f.id);
// factions that are only allies for others have no list of their own
const factions = (arg('factions') ?? all.filter((id) => !['TL', 'UA'].includes(id)).join(',')).split(',');

/** Every faction against a rotating opponent, each pairing twice (the armies and sides swapped) on the same seed. */
function schedule() {
  const games = [];
  for (let i = 0; games.length < GAMES; i++) {
    const a = factions[i % factions.length];
    const b = factions[(i * 7 + 3 + Math.floor(i / factions.length)) % factions.length];
    const seed = SEED0 + i * 13;
    // the same two armies on the same map: the live bot plays each army once, from each side
    games.push({ a: `auto:${a}`, b: `auto:${b}`, seed, sideA: 0 }, { a: `auto:${b}`, b: `auto:${a}`, seed, sideA: 1 });
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

const elo = (p) => 400 * Math.log10(Math.min(0.99, Math.max(0.01, p)) / (1 - Math.min(0.99, Math.max(0.01, p))));

const t0 = Date.now();
const games = schedule();
const shards = Array.from({ length: WORKERS }, (_, k) => games.filter((_, i) => i % WORKERS === k)).filter((g) => g.length);
const jobs = await Promise.all(shards.map((g) => runWorker({ games: g, wA: {}, wB: {}, baselineB: true, look: flag('look') })));
const res = shards.flatMap((g, k) => g.map((game, i) => ({ game, m: jobs[k][i] })));
const ok = res.filter((r) => typeof r.m === 'number');
const n = ok.length;
const win = ok.filter((r) => r.m > 0).length, draw = ok.filter((r) => r.m === 0).length, loss = n - win - draw;
const p = (win + draw / 2) / Math.max(1, n);
const se = Math.sqrt(Math.max(1e-6, p * (1 - p)) / Math.max(1, n));
const d = elo(p);
const ci = [elo(p - 1.96 * se), elo(p + 1.96 * se)];
const margin = ok.reduce((a, r) => a + r.m, 0) / Math.max(1, n);

// the live bot's score with each faction (whichever side it played)
const per = {};
for (const r of ok) {
  const f = r.game.a.slice(5);
  per[f] ??= { n: 0, s: 0, m: 0 };
  per[f].n++; per[f].s += r.m > 0 ? 1 : r.m === 0 ? 0.5 : 0; per[f].m += r.m;
}

const book = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { baselineRating: 1500, runs: [] };
const rating = Math.round(book.baselineRating + d);
let commit = '';
try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a checkout */ }
const run = {
  date: new Date().toISOString().slice(0, 10), label: LABEL, commit, lookahead: flag('look'), games: n, errors: res.length - n, win, draw, loss,
  score: +p.toFixed(3), elo: Math.round(d), ci: ci.map(Math.round), margin: +margin.toFixed(1), rating, baseline: book.baselineRating,
  factions: Object.fromEntries(Object.entries(per).map(([f, x]) => [f, { games: x.n, score: +(x.s / x.n).toFixed(2), margin: +(x.m / x.n).toFixed(1) }])),
  seconds: Math.round((Date.now() - t0) / 1000),
};
book.runs.push(run);
if (flag('promote')) {
  execSync('node scripts/bot-baseline/snapshot.mjs');
  book.baselineRating = rating;
}
fs.writeFileSync(FILE, JSON.stringify(book, null, 1) + '\n');
console.log(`${LABEL}: ${n} games (${run.errors} errors) · live W${win} D${draw} L${loss} · score ${(p * 100).toFixed(1)}% · Elo ${d >= 0 ? '+' : ''}${Math.round(d)} [${ci.map(Math.round).join(', ')}] · VP margin ${margin.toFixed(1)} · rating ${rating} (baseline ${book.baselineRating})${flag('promote') ? ' · promoted to baseline' : ''} · ${run.seconds}s`);
for (const [f, x] of Object.entries(run.factions).sort()) console.log(`  ${f.padEnd(4)} ${x.games} games  score ${(x.score * 100).toFixed(0)}%  margin ${x.margin}`);
