// Blessings of Khorne (World Eaters army rule): at the start of each battle round roll 8D6 and use doubles / triples to
// activate up to two Blessings for the round. Extra dice: Bloodshed points (Icon of Khorne), Idol of Blessed Blood (Lord of
// Skulls); re-rolls: The Blood God's Favour (Angron, up to 6), Favoured of Khorne (up to 2). Reborn in Blood spends a
// triple 6 to bring Angron back. Butchers of Khorne and Skulls for the Skull Throne add one more Blessing for a while.
// The bot and a player on automatic rules pick the best pair; a player who decides gets the dice and the choices.
import { rollN } from './dice';
import { alive, log, onBoard, phaseKey, pushFx } from './state';
import type { Effect } from './effects';
import type { GameState, PlayerId, UnitState } from './types';

export interface Blessing { id: string; name: string; double: number; triple?: number; value: number; short: string; text: string; effects: Effect[] }
export const BLESSINGS: Blessing[] = [
  { id: 'bloodlust', name: 'Unbridled Bloodlust', double: 1, value: 2.5, short: '+1 to charge', text: 'This unit has +1 to charge rolls.', effects: [{ chargeBonus: 1 }] },
  { id: 'invigoration', name: 'Rage-fuelled Invigoration', double: 2, value: 2, short: 'Pile in / consolidate 6"', text: 'Each time a model in this unit makes a Pile-in or Consolidation move, it can move up to 6" instead of up to 3".', effects: [{ pileIn: 6, consolidate: 6 }] },
  { id: 'carnage', name: 'Total Carnage', double: 3, value: 3, short: 'Fight on death 4+', text: 'Each time a model in this unit is destroyed by a melee attack, if it has not fought this phase, roll one D6: on a 4+, do not remove it from play. It can fight after the attacking unit has finished making its attacks, and is then removed from play.', effects: [{ fightOnDeath: 4 }] },
  { id: 'martial', name: 'Martial Excellence', double: 4, triple: 1, value: 4, short: '[SUSTAINED HITS 1] in melee', text: 'Melee weapons equipped by models in this unit have the [SUSTAINED HITS 1] ability.', effects: [{ attack: 'melee', abilities: ['sustained hits 1'] }] },
  { id: 'warp', name: 'Warp Blades', double: 5, triple: 2, value: 5, short: '[LETHAL HITS] in melee', text: 'Melee weapons equipped by models in this unit have the [LETHAL HITS] ability.', effects: [{ attack: 'melee', abilities: ['lethal hits'] }] },
  { id: 'decap', name: 'Decapitating Strikes', double: 6, triple: 3, value: 6, short: '[DEVASTATING WOUNDS] vs INFANTRY', text: 'Each time a model in this unit makes a melee attack that targets an INFANTRY unit, that attack has the [DEVASTATING WOUNDS] ability.', effects: [{ attack: 'melee', if: ['targetInfantry'], abilities: ['devastating wounds'] }] },
];
/** "Double 5+ or Triple 2+" */
export const blessingNeed = (b: Blessing) => `${b.double === 1 ? 'Any double' : `Double ${b.double}+`}${b.triple ? ` or ${b.triple === 1 ? 'any triple' : `Triple ${b.triple}+`}` : ''}`;
export const blessingById = (id: string) => BLESSINGS.find((b) => b.id === id);

/** What one roll can pay for: each pick is one or two Blessings (or Reborn in Blood) with the dice it spends. */
export interface BlessingPick { ids: string[]; reborn?: boolean; score: number }

/** The ways to use `dice` for up to `n` Blessings (no Blessing twice, no die twice), best first. */
export function blessingPicks(dice: number[], n: 1 | 2, skip: string[] = []): BlessingPick[] {
  const count = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) count[d]++;
  // every way to pay for one Blessing: two of a value >= its double, or three of a value >= its triple
  const ways = (b: Blessing) => {
    const out: { v: number; k: number }[] = [];
    for (let v = b.double; v <= 6; v++) out.push({ v, k: 2 });
    if (b.triple) for (let v = b.triple; v <= 6; v++) out.push({ v, k: 3 });
    return out;
  };
  const free = BLESSINGS.filter((b) => !skip.includes(b.id));
  const out: BlessingPick[] = [];
  for (const a of free) {
    const wa = ways(a).filter((w) => count[w.v] >= w.k);
    if (!wa.length) continue;
    out.push({ ids: [a.id], score: a.value });
    if (n < 2) continue;
    for (const b of free) {
      if (b.value <= a.value || b.id === a.id) continue;
      const ok = wa.some((x) => ways(b).some((y) => (x.v === y.v ? count[x.v] >= x.k + y.k : count[y.v] >= y.k)));
      if (ok) out.push({ ids: [b.id, a.id], score: a.value + b.value });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

// an ability picked from a "select one" list (Wrathful Presence) only counts while it is the one picked
const hasAb = (u: UnitState, name: string) => u.abilities.some((a) => a.name === name) && !(u.abilityPicks?.pool.includes(name) && !u.abilityPicks.on.includes(name));
const mine = (s: GameState, p: PlayerId) => s.units.filter((u) => u.owner === p && onBoard(u));

/** How many dice of the roll may be re-rolled, and why (The Blood God's Favour 6, Favoured of Khorne 2). */
export function rerollBudget(s: GameState, p: PlayerId): { n: number; from: string } {
  const angron = mine(s, p).some((u) => hasAb(u, 'The Blood God’s Favour'));
  const fav = mine(s, p).some((u) => u.enhancements.some((e) => e.name === 'Favoured of Khorne'));
  return { n: (angron ? 6 : 0) + (fav ? 2 : 0), from: [angron && 'The Blood God’s Favour (6)', fav && 'Favoured of Khorne (2)'].filter(Boolean).join(' + ') };
}

/** The bot's re-roll: the dice that pay for nothing, lowest first. */
function rerollUseless(s: GameState, p: PlayerId, dice: number[]): number[] {
  const n = rerollBudget(s, p).n;
  if (!n) return dice;
  const count = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) count[d]++;
  // keep pairs of 4+ (or any triple); throw the singles and low pairs again, lowest first
  const keep = (v: number) => count[v] >= 3 || (count[v] >= 2 && v >= 4);
  const idx = dice.map((d, i) => ({ d, i })).filter((x) => !keep(x.d)).sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.i);
  if (!idx.length) return dice;
  const fresh = rollN(s, idx.length);
  const out = [...dice];
  idx.forEach((i, k) => { out[i] = fresh[k]; });
  log(s, `Blessings of Khorne: re-rolled ${idx.length} dice → [${out.join(' ')}]`, 'roll', p);
  return out;
}

const auto = (s: GameState, p: PlayerId) => (s.bots ?? []).includes(p) || (s.autoRules ?? []).includes(p);

/** Roll for the army (or one more Blessing, `extra`), then take the best pick or let the player choose. */
export function blessingsRoll(s: GameState, p: PlayerId, extra?: { label: string; kw?: string; until: 'phase' | 'round' }) {
  const P = s.players[p];
  const n = 8 + (P.bloodshed ?? 0) + (mine(s, p).some((u) => hasAb(u, 'Idol of Blessed Blood')) ? 1 : 0);
  P.bloodshed = 0;
  const bot = auto(s, p) || !!s.window; // another prompt is open: the game takes the best for the player too
  const raw = rollN(s, n);
  const dice = (bot ? rerollUseless(s, p, raw) : raw).sort((a, b) => a - b);
  const options = picksFor(s, p, dice, extra);
  pushFx(s, { kind: 'roll', owner: p, title: extra ? extra.label : 'Blessings of Khorne', dice, result: options.length ? options[0].reborn ? 'Reborn in Blood' : options[0].ids.map((id) => blessingById(id)!.name).join(' + ') : 'no Blessing', good: options.length > 0 });
  log(s, `${extra ? extra.label : 'Blessings of Khorne'}: rolled [${dice.join(' ')}]`, 'roll', p);
  if (bot) { if (options.length) applyPick(s, p, options[0], extra); return; }
  const rr = rerollBudget(s, p);
  if (!options.length && !rr.n) return;
  s.window = { kind: 'blessings', player: p, dice, picks: options, extra, rerolls: rr.n, rerollFrom: rr.from };
}

/** What this roll can pay for (Reborn in Blood first when Angron is down and three 6s came up). */
function picksFor(s: GameState, p: PlayerId, dice: number[], extra?: { label: string }): BlessingPick[] {
  const angron = s.units.find((u) => u.owner === p && hasAb(u, 'Reborn in Blood'));
  const reborn = !extra && !!angron && !alive(angron).length && dice.filter((d) => d === 6).length >= 3;
  return [...(reborn ? [{ ids: [], reborn: true, score: 99 }] : []), ...blessingPicks(dice, extra ? 1 : 2, extra ? activeIds(s, p) : [])];
}

/** The player re-rolls the dice they picked (at most the roll's re-roll budget, once). */
export function rerollBlessings(s: GameState, idx: number[]): string | null {
  const w = s.window;
  if (w?.kind !== 'blessings') return 'No Blessings roll';
  const pick = [...new Set(idx)].filter((i) => i >= 0 && i < w.dice.length);
  if (!pick.length) return 'Tap the dice to re-roll';
  if (pick.length > (w.rerolls ?? 0)) return `You can re-roll at most ${w.rerolls ?? 0} dice`;
  const fresh = rollN(s, pick.length);
  const dice = [...w.dice];
  pick.forEach((i, k) => { dice[i] = fresh[k]; });
  dice.sort((a, b) => a - b);
  log(s, `${w.extra?.label ?? 'Blessings of Khorne'}: re-rolled ${pick.length} dice → [${dice.join(' ')}]`, 'roll', w.player);
  s.window = { ...w, dice, picks: picksFor(s, w.player, dice, w.extra), rerolls: 0 };
  return null;
}

/** The Blessings active for the army this round (not counting extras). */
export function activeIds(s: GameState, p: PlayerId): string[] {
  const b = s.players[p].blessings;
  return b && b.round === s.round ? b.ids : [];
}

export function applyPick(s: GameState, p: PlayerId, pick: BlessingPick | null, extra?: { label: string; kw?: string; until: 'phase' | 'round' }) {
  const P = s.players[p];
  if (s.window?.kind === 'blessings') s.window = null;
  if (!pick) return;
  if (pick.reborn) {
    const a = s.units.find((u) => u.owner === p && hasAb(u, 'Reborn in Blood'));
    if (a) {
      const m = a.models[0];
      m.dead = false; m.wounds = Math.min(8, m.profile.W);
      a.status = 'reserves';
      s.destroyedByTurn = s.destroyedByTurn.filter((d) => d.unitId !== a.id);
      log(s, `Reborn in Blood: ${a.name} returns (Deep Strike in the next Movement phase, 8 wounds)`, 'info', p);
    }
    return;
  }
  const names = pick.ids.map((id) => blessingById(id)!.name).join(' + ');
  if (extra) {
    (P.blessingExtras ??= []).push({ id: pick.ids[0], kw: extra.kw, key: extra.until === 'phase' ? phaseKey(s) : `r${s.round}` });
    log(s, `${extra.label}: ${names}${extra.kw ? ` for ${extra.kw} units` : ''} until the end of the ${extra.until === 'phase' ? 'phase' : 'battle round'}`, 'info', p);
  } else {
    P.blessings = { round: s.round, ids: pick.ids };
    log(s, `Blessings of Khorne: ${names} until the end of the battle round`, 'info', p);
  }
}

/** Start of each battle round: every World Eaters army rolls. */
export function blessingsRoundStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!s.players[p].armyRules?.some((r) => r.name === 'Blessings of Khorne')) continue;
    if (!s.units.some((u) => u.owner === p && hasAb(u, 'Blessings of Khorne'))) continue;
    blessingsRoll(s, p);
  }
}

/** The Blessings a unit has right now (Archslaughterer: all of them). */
export function unitBlessings(s: GameState, u: UnitState, qualifies: boolean): string[] {
  if ((u.timed ?? []).some((t) => t.mark === 'allBlessings')) return BLESSINGS.map((b) => b.id);
  if (!qualifies) return [];
  const P = s.players[u.owner];
  const ids = new Set(activeIds(s, u.owner));
  for (const x of P.blessingExtras ?? []) {
    if (x.key !== phaseKey(s) && x.key !== `r${s.round}`) continue;
    if (x.kw && !u.keywords.includes(x.kw)) continue;
    ids.add(x.id);
  }
  return [...ids];
}
