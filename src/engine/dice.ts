import type { GameState } from './types';

// Seeded PRNG (mulberry32) so a battle can be replayed and saved deterministically.
export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const d6 = (s: { rng: number }) => 1 + Math.floor(nextRandom(s) * 6);
export const rollN = (s: { rng: number }, n: number) => Array.from({ length: n }, () => d6(s));

export interface DiceExpr { n: number; sides: number; add: number }

// "D6+2", "2D6", "D3", "3", " 2D6" -> expression
export function parseDice(expr: string | number | null | undefined): DiceExpr {
  if (expr === null || expr === undefined) return { n: 0, sides: 0, add: 0 };
  const s = String(expr).replace(/\s+/g, '').toUpperCase();
  const m = /^(\d*)D(\d+)(?:\+(\d+))?$/.exec(s);
  if (m) return { n: m[1] ? +m[1] : 1, sides: +m[2], add: m[3] ? +m[3] : 0 };
  const n = parseInt(s, 10);
  return { n: 0, sides: 0, add: Number.isFinite(n) ? n : 0 };
}

export function rollExpr(s: { rng: number }, expr: string | number | null | undefined): { total: number; dice: number[] } {
  const e = parseDice(expr);
  const dice: number[] = [];
  for (let i = 0; i < e.n; i++) {
    const r = d6(s);
    dice.push(e.sides === 3 ? Math.ceil(r / 2) : e.sides === 6 ? r : 1 + Math.floor(nextRandom(s) * e.sides));
  }
  return { total: dice.reduce((a, b) => a + b, 0) + e.add, dice };
}

export const isRandom = (expr: string | number | null | undefined) => parseDice(expr).n > 0;
export const exprAverage = (expr: string | number | null | undefined) => {
  const e = parseDice(expr);
  return e.n * ((e.sides === 3 ? 2 : (e.sides + 1) / 2)) + e.add;
};

export function rollOff(s: GameState): { a: number; b: number; winner: 0 | 1 } {
  for (;;) {
    const a = d6(s);
    const b = d6(s);
    if (a !== b) return { a, b, winner: a > b ? 0 : 1 };
  }
}
