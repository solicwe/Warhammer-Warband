// Thousand Sons — Cabal of Sorcerers: at the start of the Shooting phase, models with the ability attempt Rituals.
// Each model attempts one Ritual a turn (Magnus two), each Ritual is attempted once a turn by the army.
// Psychic test: 2D6, Channel the Warp adds a third D6; any double or triple costs the model's unit D3 mortal wounds;
// the total (plus bonuses) must reach the Ritual's Warp Charge. The rules that change any of this live here too:
// Magnus, Ahriman, Spirit Snare, Immaterial Flare, the enhancements (Diabolic Savant, Warp Syphon, Warpmeld Dagger,
// Lord of Forbidden Lore, Warp-cursed Runemaster, Empowered Manifestation, Incandaeum, Noctilith Mantle),
// Arcane Focus (Grand Coven) and Sorcerous Invigoration (Ritual of Regeneration).
import { runActions, setBackUp } from '../rules-engine/activations';
import { applyMortalWounds, onAttackFinished, onModelKilled, onMortalWounds } from '../engine/attack';
import { d6, rollExpr, rollN } from '../engine/dice';
import { abilitySheet, addTimed, unitFlags } from '../rules-engine/effects';
import { inFlow } from './flow';
import { baseDist } from '../engine/geometry';
import { alive, boardUnits, canUseStratagem, engagedEnemies, hasKw, log, onBoard, other, pushFx, spendStratagem, unitById } from '../engine/state';
import type { GameState, ModelState, PlayerId, StratagemData, UnitState } from '../engine/types';
import { unitVisibleTo } from '../engine/visibility';

export interface Ritual { id: string; name: string; wc: number; side: 'enemy' | 'friendly'; text: string }
export const RITUALS: Ritual[] = [
  { id: 'destinys-ruin', name: "Destiny's Ruin", wc: 5, side: 'enemy', text: 'Our attacks against that unit re-roll Hit rolls of 1 (10+: re-roll the Hit roll)' },
  { id: 'temporal-surge', name: 'Temporal Surge', wc: 6, side: 'friendly', text: 'A friendly unit makes a Normal move of up to D6" (10+: 6"), then cannot charge this turn' },
  { id: 'doombolt', name: 'Doombolt', wc: 7, side: 'enemy', text: 'D3 mortal wounds (11+: D3+3)' },
  { id: 'twist-of-fate', name: 'Twist of Fate', wc: 9, side: 'enemy', text: 'Our attacks against that unit improve AP by 1 (12+: by 2)' },
];
export const ritualById = (id: string) => RITUALS.find((r) => r.id === id)!;

const OURS = ['THOUSAND SONS|SCINTILLATING LEGIONS'];
const has = (u: UnitState, name: string) => u.abilities.some((a) => a.name.startsWith(name));
const enh = (u: UnitState, name: string, m?: ModelState) => u.enhancements.some((e) => e.name === name && (!m || e.model === m.source));
const near = (a: ModelState, u: UnitState, r: number) => alive(u).some((n) => baseDist(a, n) <= r + 1e-6);

export interface Caster { unit: UnitState; model: ModelState; tries: number; bonus: number; range: number }

/** Models of player p that can attempt Rituals now, with how many attempts they have left. */
export function casters(s: GameState, p: PlayerId): Caster[] {
  if (s.players[p]?.factionId !== 'TS') return [];
  const R = ritualState(s, p);
  const out: Caster[] = [];
  const add = (u: UnitState, m: ModelState) => {
    if (out.some((c) => c.model.id === m.id)) return;
    if (u.enhancements.some((e) => e.name === 'Noctilith Mantle')) return; // its models cannot use Rituals
    const max = m.source === 'Magnus The Red' ? 2 : 1;
    const left = max - (R.by[m.id] ?? 0);
    if (left <= 0) return;
    let bonus = Math.min(2, m.ritualBonus ?? 0);
    if (m.source === 'Magnus The Red') bonus += 2;
    if (m.source === 'Ahriman') bonus += 1;
    out.push({ unit: u, model: m, tries: left, bonus, range: ritualRange(s, u, m) });
  };
  for (const u of boardUnits(s, p)) {
    for (const a of u.abilities.filter((x) => x.name.startsWith('Cabal of Sorcerers'))) {
      const only = /\((.+) only\)/.exec(a.name)?.[1]?.toLowerCase();
      const sheet = abilitySheet(u, a);
      for (const m of alive(u).filter((x) => x.source === sheet && (!only || x.name.toLowerCase().includes(only)))) add(u, m);
    }
  }
  // Changehost of Deceit: Mortal Sorcery — Scintillating Legions PSYKER units near a Thousand Sons unit have the ability
  if ((s.players[p].detachments ?? []).some((d) => d.name === 'Changehost of Deceit')) {
    const ts = boardUnits(s, p).filter((u) => u.factionKeywords.includes('THOUSAND SONS'));
    for (const u of boardUnits(s, p).filter((x) => x.factionKeywords.includes('SCINTILLATING LEGIONS') && hasKw(x, 'PSYKER'))) {
      if (!ts.some((t) => alive(t).some((m) => alive(u).some((n) => baseDist(m, n) <= 6 + 1e-6 && unitVisibleTo(s, m, u))))) continue;
      for (const m of alive(u)) add(u, m);
    }
  }
  return out;
}

/** How far the model's Rituals reach (24", more with enhancements). */
export function ritualRange(s: GameState, u: UnitState, m: ModelState): number {
  let r = 24;
  if (enh(u, 'Lord of Forbidden Lore', m)) r += 6;
  if (enh(u, 'Warp-cursed Runemaster', m) && boardUnits(s, u.owner).some((v) => hasKw(v, 'VEHICLE') && v.factionKeywords.includes('THOUSAND SONS') && near(m, v, 6))) r += 6;
  if (enh(u, 'Empowered Manifestation', m) && inFlow(s, u)) r += 6;
  return r;
}

function ritualState(s: GameState, p: PlayerId) {
  const P = s.players[p];
  if (!P.rituals || P.rituals.turn !== s.turn) P.rituals = { turn: s.turn, tried: [], by: {} };
  return P.rituals;
}

/** Rituals the army can still attempt this turn (Doombolt again once per battle with the Incandaeum). */
export function ritualsLeft(s: GameState, p: PlayerId, c?: Caster): Ritual[] {
  const R = ritualState(s, p);
  return RITUALS.filter((r) => !R.tried.includes(r.id)
    || (r.id === 'doombolt' && !!c && c.model.source.startsWith('Exalted Sorcerer') && enh(c.unit, 'Incandaeum', c.model) && !(s.players[p].abilityUsed ?? {}).incandaeum));
}

/** Is it the start of player p's Shooting phase with Rituals that can still be attempted? */
export function ritualsPending(s: GameState, p: PlayerId): boolean {
  if (s.players[p]?.factionId !== 'TS') return false;
  if (s.phase !== 'shooting' || s.active !== p || s.window || s.attack) return false;
  const R = ritualState(s, p);
  if (R.done) return false;
  // once a unit has been selected to shoot, the start of the phase is over
  if (boardUnits(s, p).some((u) => u.selectedToShoot || u.weaponsFired.length > 0)) { R.done = true; return false; }
  const cs = casters(s, p);
  return cs.some((c) => ritualsLeft(s, p, c).length > 0);
}

export function endRituals(s: GameState, p: PlayerId) { ritualState(s, p).done = true; }

/** Units a Ritual can be aimed at by this model. */
export function ritualTargets(s: GameState, c: Caster, r: Ritual): UnitState[] {
  const side = r.side === 'enemy' ? other(c.unit.owner) : c.unit.owner;
  return boardUnits(s, side).filter((u) => {
    if (!alive(u).some((n) => baseDist(c.model, n) <= c.range + 1e-6)) return false;
    if (!unitVisibleTo(s, c.model, u) && u.id !== c.unit.id) return false;
    if (r.side === 'friendly') return u.factionKeywords.some((k) => k === 'THOUSAND SONS' || k === 'SCINTILLATING LEGIONS') && !engagedEnemies(s, u).length;
    if (r.id === 'doombolt') {
      // a Lone Operative on its own can only be picked from within 12"
      const lone = (u.core.loneOperative || unitFlags(s, u).loneOperative) && (!u.sources || u.sources.length <= 1);
      if (lone && !alive(u).some((n) => baseDist(c.model, n) <= 12 + 1e-6)) return false;
    }
    return true;
  });
}

export interface RitualChoice { channel: boolean; arcaneFocus?: boolean; syphon?: boolean; dagger?: boolean }
export interface RitualOutcome { manifested: boolean; result: number; dice: number[]; perils: number; casterDead: boolean }

/** Bonus to the Psychic test result when the model Channels the Warp. */
function channelBonus(s: GameState, c: Caster, otherMods: number): number {
  let b = 0;
  if (enh(c.unit, 'Diabolic Savant', c.model) && boardUnits(s, c.unit.owner).some((v) => v.factionKeywords.includes('SCINTILLATING LEGIONS') && near(c.model, v, 6))) b += 1;
  // Immaterial Flare: +1, not cumulative with any other modifiers
  const flare = boardUnits(s, c.unit.owner).some((v) => has(v, 'Immaterial Flare') && near(c.model, v, 6));
  if (flare && otherMods + b === 0 && hasKw(c.unit, 'PSYKER')) b += 1;
  return b;
}

const findStrat = (s: GameState, p: PlayerId, name: string): StratagemData | undefined =>
  s.players[p].detachments.flatMap((d) => d.stratagems).find((st) => st.name.toUpperCase() === name);

/** Attempt one Ritual with one model. Returns null and the outcome, or an error. */
export function attemptRitual(s: GameState, p: PlayerId, modelId: string, ritualId: string, targetId: string | undefined, how: RitualChoice): { error: string | null; out?: RitualOutcome } {
  const c = casters(s, p).find((x) => x.model.id === modelId);
  if (!c) return { error: 'This model cannot attempt a Ritual now' };
  const r = ritualById(ritualId);
  if (!ritualsLeft(s, p, c).some((x) => x.id === r.id)) return { error: 'That Ritual was already attempted this turn' };
  const targets = ritualTargets(s, c, r);
  const t = targets.find((x) => x.id === targetId) ?? targets[0];
  if (!t) return { error: 'No unit in range' };
  const R = ritualState(s, p);
  if (R.tried.includes(r.id) && r.id === 'doombolt') (s.players[p].abilityUsed ??= {}).incandaeum = 'battle';
  R.tried.push(r.id);
  R.by[c.model.id] = (R.by[c.model.id] ?? 0) + 1;

  // the Psychic test
  let dice = rollN(s, 2);
  let extra = how.channel ? d6(s) : null;
  const notes: string[] = [];
  const all = () => (extra !== null ? [...dice, extra] : [...dice]);
  let mods = c.bonus;
  const chan = extra !== null ? channelBonus(s, c, mods) : 0;
  const total = () => all().reduce((a, b) => a + b, 0) + mods + chan;
  const isDouble = (v: number[]) => v.some((x, i) => v.indexOf(x) !== i);
  // Warp Syphon: after rolling the additional D6 (before checking for doubles), a nearby vehicle takes 1 mortal wound
  // and that die is re-rolled — used when the extra die makes a double or leaves the test short
  if (extra !== null && how.syphon && enh(c.unit, 'Warp Syphon', c.model) && (isDouble(all()) || total() < r.wc)) {
    const v = boardUnits(s, p).find((x) => hasKw(x, 'VEHICLE') && x.factionKeywords.includes('THOUSAND SONS') && near(c.model, x, 6));
    if (v) { applyMortalWounds(s, v, 1, 'Warp Syphon'); const old = extra; extra = d6(s); notes.push(`Warp Syphon: ${old} → ${extra}`); }
  }
  // Arcane Focus (Grand Coven): a test that Channelled the Warp and would fail (or bring perils) is re-rolled in full
  if (extra !== null && how.arcaneFocus && (total() < r.wc || isDouble(all()))) {
    const st = findStrat(s, p, 'ARCANE FOCUS');
    if (st && !canUseStratagem(s, p, st.id, c.unit, st.cp)) {
      spendStratagem(s, p, st.id, c.unit, st.cp);
      log(s, `Arcane Focus (−${st.cp}CP): ${c.model.name} re-rolls the Psychic test [${all().join(' ')}]`, 'cp', p);
      dice = rollN(s, 2); extra = d6(s);
    }
  }
  const values = all();
  const doubles = isDouble(values);
  let perils = 0;
  if (doubles) {
    perils = rollExpr(s, 'D3').total;
    applyMortalWounds(s, c.unit, perils, `${c.model.name} rolled a double in the Psychic test`);
  }
  // Warpmeld Dagger: the bearer takes D3 mortal wounds and adds them to the result
  if (how.dagger && enh(c.unit, 'Warpmeld Dagger', c.model) && !c.model.dead) {
    const n = rollExpr(s, 'D3').total;
    applyMortalWounds(s, c.unit, n, 'Warpmeld Dagger', undefined, true);
    if (!c.model.dead) { mods += n; notes.push(`Warpmeld Dagger +${n}`); }
  }
  const casterDead = c.model.dead;
  const result = total();
  const manifested = !casterDead && result >= r.wc;
  const bonusTxt = [mods ? `+${mods}` : '', chan ? `+${chan} (channel)` : ''].filter(Boolean).join(' ');
  pushFx(s, { kind: 'roll', owner: p, title: `${r.name} · ${c.model.name}`, dice: values, result: `${casterDead ? 'the sorcerer fell' : `${result}${bonusTxt ? ` (${bonusTxt})` : ''} vs ${r.wc}+`} → ${manifested ? 'manifested' : 'failed'}${doubles ? ` · perils ${perils} MW` : ''}`, good: manifested });
  log(s, `${c.model.name}: ${r.name} — Psychic test [${values.join(' ')}]${how.channel ? ' (Channelled the Warp)' : ''}${bonusTxt ? ` ${bonusTxt}` : ''}${notes.length ? ` · ${notes.join(' · ')}` : ''} = ${result} vs ${r.wc} → ${manifested ? `manifested on ${t.name}` : 'failed'}`, 'roll', p);
  // the Ritual on the board: from the sorcerer to its target
  const mid = (u: UnitState) => { const ms = alive(u).length ? alive(u) : u.models; return { x: ms.reduce((a, m) => a + m.x, 0) / ms.length, y: ms.reduce((a, m) => a + m.y, 0) / ms.length }; };
  const what: Record<string, string> = {
    'destinys-ruin': result >= 10 ? 're-roll hits' : 're-roll hits of 1', 'twist-of-fate': result >= 12 ? 'AP +2 against it' : 'AP +1 against it',
    doombolt: result >= 11 ? 'D3+3 mortal wounds' : 'D3 mortal wounds', 'temporal-surge': result >= 10 ? 'moves 6"' : 'moves D6"',
  };
  pushFx(s, { kind: 'ritual', owner: p, ritual: r.id, name: r.name, from: { x: c.model.x, y: c.model.y }, to: mid(t), ok: manifested, text: manifested ? what[r.id] : undefined });
  if (manifested) resolveRitual(s, c, r, unitById(s, t.id), result);
  return { error: null, out: { manifested, result, dice: values, perils, casterDead } };
}

function resolveRitual(s: GameState, c: Caster, r: Ritual, t: UnitState, result: number) {
  const p = c.unit.owner;
  if (r.id === 'destinys-ruin') {
    addTimed(s, t, { e: { incoming: { by: p, units: OURS, reroll: result >= 10 ? 'hits' : 'hits1' } }, label: r.name, until: 'phase', by: p, mark: r.name });
  } else if (r.id === 'twist-of-fate') {
    addTimed(s, t, { e: { incoming: { by: p, units: OURS, ap: result >= 12 ? 2 : 1 } }, label: r.name, until: 'phase', by: p, mark: r.name });
  } else if (r.id === 'doombolt') {
    t.psyHit = { key: `${s.turn}|${s.phase}`, by: p };
    const n = rollExpr(s, result >= 11 ? 'D3+3' : 'D3').total;
    log(s, `${r.name}: ${t.name} suffers ${n} mortal wounds`, 'roll', p);
    applyMortalWounds(s, t, n, r.name);
  } else if (r.id === 'temporal-surge') {
    runActions(s, r.name, c.unit, [{ on: 'target', move: result >= 10 ? '6' : 'D6', noCharge: true }], t);
  }
  // Ritual of Regeneration — Sorcerous Invigoration: the manifesting unit heals D3 (Curse of Life: +3)
  const P = s.players[p];
  if ((P.detachments ?? []).some((d) => d.name === 'Ritual of Regeneration') && hasKw(c.unit, 'PSYKER') && !hasKw(c.unit, 'MONSTER')
    && c.unit.factionKeywords.includes('THOUSAND SONS') && onBoard(c.unit)) {
    const key = `invigoration:${c.unit.id}`;
    const bag = (P.abilityUsed ??= {});
    if (bag[key] !== `t${s.turn}`) {
      bag[key] = `t${s.turn}`;
      const curse = c.unit.enhancements.some((e) => e.name === 'Curse of Life' && alive(c.unit).some((m) => m.source === e.model));
      const n = rollExpr(s, 'D3').total + (curse ? 3 : 0);
      runActions(s, 'Sorcerous Invigoration', c.unit, [{ on: 'self', heal: String(n) }], null);
    }
  }
}

// Spirit Snare: a Cabal of Sorcerers model dies near a Daemon Prince of Tzeentch, whose Rituals get +1 (up to +2)
onModelKilled((s, u, m) => {
  if (!u.factionKeywords.includes('THOUSAND SONS') || !m.keywords.includes('PSYKER')) return;
  if (!u.abilities.some((a) => a.name.startsWith('Cabal of Sorcerers'))) return;
  const prince = boardUnits(s, u.owner).flatMap((x) => alive(x).filter((n) => x.abilities.some((a) => a.name === 'Spirit Snare' && (!a.sheet || a.sheet === n.source)) && baseDist(n, m) <= 9 + 1e-6))
    .find((n) => (n.ritualBonus ?? 0) < 2);
  if (!prince) return;
  prince.ritualBonus = (prince.ritualBonus ?? 0) + 1;
  log(s, `Spirit Snare: ${prince.name} captures the soul of ${m.name} (+${prince.ritualBonus} to its Psychic tests)`, 'info', u.owner);
});

// a THOUSAND SONS PSYKER hit a unit with a Psychic Attack: Ensorcelled Destruction / Annihilation work against it this phase
onAttackFinished((s, at, info) => {
  const A = unitById(s, at.attackerId);
  if (!info.hits || !hasKw(A, 'PSYKER') || !A.factionKeywords.includes('THOUSAND SONS') || !at.pools.some((p) => p.psychic)) return;
  const T = unitById(s, at.targetId);
  T.psyHit = { key: `${s.turn}|${s.phase}`, by: A.owner };
});

// Relentless Rebirth (Ritual of Regeneration): the bot / a player on automatic rules spends 1CP when an INFANTRY or
// MOUNTED THOUSAND SONS PSYKER unit is about to suffer 2+ mortal wounds — Feel No Pain 5+ against them this phase
onMortalWounds((s, u, n) => {
  const p = u.owner;
  if (n < 2 || !((s.bots ?? []).includes(p) || (s.autoRules ?? []).includes(p))) return;
  if (!u.factionKeywords.includes('THOUSAND SONS') || !hasKw(u, 'PSYKER') || !(hasKw(u, 'INFANTRY') || hasKw(u, 'MOUNTED'))) return;
  if ((u.timed ?? []).some((x) => x.label === 'RELENTLESS REBIRTH')) return;
  const st = findStrat(s, p, 'RELENTLESS REBIRTH');
  if (!st || s.players[p].cp < st.cp + 1 || canUseStratagem(s, p, st.id, u, st.cp)) return;
  spendStratagem(s, p, st.id, u, st.cp);
  addTimed(s, u, { e: { defend: { fnp: 5, fnpVs: 'mortal' } }, label: 'RELENTLESS REBIRTH', until: 'phase', by: p });
  log(s, `RELENTLESS REBIRTH (${st.cp}CP): ${u.name} has Feel No Pain 5+ against mortal wounds this phase`, 'info', p);
});

// Split: a destroyed PINK HORROR may become two BLUE HORRORS, a BLUE HORROR a BRIMSTONE HORROR (after the attacks)
onModelKilled((s, u, m) => {
  if (!u.templates?.length || !u.abilities.some((a) => a.name === 'Split')) return;
  const n = m.name.toUpperCase();
  const from = n.includes('PINK') ? 'pink' : n.includes('BRIMSTONE') ? null : n.includes('BLUE') ? 'blue' : null;
  if (from) (s.splits ??= []).push({ unitId: u.id, from, x: m.x, y: m.y });
});
onAttackFinished((s) => resolveSplits(s));

export function resolveSplits(s: GameState) {
  const list = s.splits ?? [];
  if (!list.length) return;
  s.splits = [];
  for (const q of list) {
    const u = unitById(s, q.unitId);
    if (!alive(u).length || !u.templates) continue;
    const r = d6(s);
    const tpl = u.templates.find((t) => /BLUE|BRIMSTONE/i.test(t.name)) ?? u.templates[u.templates.length - 1];
    const add = q.from === 'pink' ? 2 : 1;
    log(s, `Split: a ${q.from === 'pink' ? 'Pink' : 'Blue'} Horror of ${u.name} rolled ${r}${r >= 4 ? ` → ${add === 2 ? 'two Blue Horrors' : 'a Brimstone Horror'}` : ''}`, 'roll', u.owner);
    if (r < 4) continue;
    for (let k = 0; k < add; k++) {
      const nm: ModelState = { ...structuredClone(tpl), id: `${u.id}-s${u.models.length}`, name: q.from === 'pink' ? 'Blue Horror' : 'Brimstone Horror', dead: false, wounds: tpl.profile.W };
      u.models.push(nm);
      if (!setBackUp(s, u, nm, { x: q.x, y: q.y })) u.models.pop();
    }
  }
}

/** Probability that nD6 + bonus reaches wc, and that a double (or triple) shows up. */
export function testOdds(n: 2 | 3, bonus: number, wc: number): { pass: number; perils: number } {
  let pass = 0, perils = 0, tot = 0;
  const faces = [1, 2, 3, 4, 5, 6];
  for (const a of faces) for (const b of faces) for (const c of n === 3 ? faces : [0]) {
    tot++;
    const v = n === 3 ? [a, b, c] : [a, b];
    const dbl = v.some((x, i) => v.indexOf(x) !== i);
    if (dbl) perils++;
    if (a + b + c + bonus >= wc) pass++;
  }
  return { pass: pass / tot, perils: perils / tot };
}
