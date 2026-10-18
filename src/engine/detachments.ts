// Detachment rules: the effects themselves live in data/detachment-rules.json and are applied by effects.ts;
// this module handles the "pick one" rules (Combat Doctrines, Mission Tactics, Psychic Disciplines …).
import { activeRules, DET_RULES, DOCTRINES, doctrineUsesLeft, type DetChoice, type DetChoiceOption, type DetRule } from './effects';
import { rollN } from './dice';
import { log } from './state';
import { choiceBlocked, choicePickedHooks } from './events';
import type { DetChoiceState, GameState, PlayerId } from './types';

export { DET_RULES };
export type { DetChoice, DetChoiceOption, DetRule };

const detState = (s: GameState, p: PlayerId) => (s.players[p].det ??= {});

export interface DetChoiceNow { rule: string; choice: DetChoice; state: DetChoiceState; open: boolean; options: { o: DetChoiceOption; why: string | null }[] }

/** Choice rules of player p, whether one can be picked right now and why an option is unavailable. */
export function detChoices(s: GameState, p: PlayerId): DetChoiceNow[] {
  const out: DetChoiceNow[] = [];
  for (const d of activeRules(s, p).map((name) => ({ name }))) {
    const ch = DET_RULES[d.name]?.choice;
    if (!ch) continue;
    const st: DetChoiceState = s.players[p].det?.[d.name] ?? { active: [], used: [], count: 0 };
    const inCommand = s.phase === 'command' && s.active === p;
    let open = inCommand;
    if (ch.when === 'command') open = inCommand && st.pickedTurn !== s.turn && (ch.uses !== 'limit' || st.count < (ch.limit ?? 1));
    if (ch.when === 'round') open = inCommand && st.round !== s.round && (!ch.rounds || ch.rounds.includes(s.round));
    if (ch.when === 'battle') open = inCommand && st.count === 0 && (ch.keep || st.active.length < (ch.pick ?? 1));
    const tithe = s.players[p].tithe ?? 0;
    if (ch.when === 'tithe') open = s.phase === 'command' && st.pickedTurn !== s.turn && ch.options.some((o) => !st.active.includes(o.id) && (o.cost ?? 0) <= tithe);
    const left = d.name === DOCTRINES ? doctrineUsesLeft(s, p, ch.options.map((o) => o.id), st.used) : null;
    const options = ch.options.map((o) => ({
      o,
      why: left ? (left[o.id] ? null : 'All uses spent this battle')
        : (ch.uses === 'eachOnce' || ch.uses === 'limit') && st.used.includes(o.id) ? 'Already used this battle'
        : ch.when === 'tithe' && (o.cost ?? 0) > tithe ? `Needs ${o.cost} Blood Tithe points (${tithe})` : choiceBlocked(s, p, d.name, o),
    }));
    out.push({ rule: d.name, choice: ch, state: st, open, options });
  }
  return out;
}

export function pickDetChoice(s: GameState, p: PlayerId, rule: string, ids: string[]): string | null {
  const now = detChoices(s, p).find((c) => c.rule === rule);
  if (!now) return 'No such rule';
  if (!now.open) return 'Cannot be selected now';
  const need = now.choice.pick ?? 1;
  if (ids.length !== need) return `Select ${need}`;
  const groups = now.choice.groups;
  if (groups && groups.some((g) => ids.filter((id) => now.options.find((x) => x.o.id === id)?.o.group === g).length !== 1)) return `Select one of each: ${groups.join(', ')}`;
  for (const id of ids) {
    const o = now.options.find((x) => x.o.id === id);
    if (!o) return 'No such option';
    if (o.why) return o.why;
  }
  // "or randomly determine two by rolling two D6" (Experimental Augmentations): duplicates count once
  const randomly = ids.some((id) => now.choice.options.find((o) => o.id === id)?.random);
  ids = [...new Set(ids.flatMap((id) => {
    const rnd = now.choice.options.find((o) => o.id === id && o.random);
    if (!rnd) return [id];
    const pool = now.choice.options.filter((o) => !o.random && o.group === rnd.group);
    const dice = rollN(s, rnd.random!);
    log(s, `${rnd.name}: rolled [${dice.join(' ')}]`, 'roll', p);
    // a D6 table of fewer options (Code Chivalric: 1-2, 3-4, 5-6); six options: one each
    // … a result already sworn (Heroes of Legend) becomes one that was not
    const used = s.players[p].det?.[rule]?.used ?? [];
    return dice.map((v) => pool[groups ? Math.ceil((v * pool.length) / 6) - 1 : Math.min(v, pool.length) - 1].id)
      .map((id) => (groups && used.includes(id) ? pool.find((o) => !used.includes(o.id))?.id ?? id : id));
  }))];
  const st = (detState(s, p)[rule] ??= { active: [], used: [], count: 0 });
  if (now.choice.when === 'tithe') s.players[p].tithe = (s.players[p].tithe ?? 0) - ids.reduce((a, id) => a + (now.choice.options.find((o) => o.id === id)?.cost ?? 0), 0);
  st.active = now.choice.when === 'tithe' || now.choice.keep ? [...new Set([...st.active, ...ids])] : [...ids];
  st.used = rule === DOCTRINES ? [...st.used, ...ids] : [...new Set([...st.used, ...ids])];
  st.count += 1;
  st.pickedTurn = s.turn;
  st.round = s.round;
  choicePickedHooks(s, p, rule, ids, randomly); // Nurgle's Gift, Code Chivalric's Oath, Harbingers of Dread ...
  const names = ids.map((id) => now.choice.options.find((o) => o.id === id)!.name).join(' + ');
  log(s, `${now.choice.name}: ${names}`, 'info', p);
  return null;
}

/** Expire choices at the start of the owner's Command phase ("until the start of your next Command phase")
 *  and per-battle-round ones when a new round starts. */
export function detOnCommandStart(s: GameState, p: PlayerId, newRound: boolean) {
  for (const pl of [0, 1] as PlayerId[]) {
    for (const d of activeRules(s, pl).map((name) => ({ name }))) {
      const ch = DET_RULES[d.name]?.choice;
      const st = s.players[pl].det?.[d.name];
      if (!ch || !st) continue;
      if (ch.when === 'command' && pl === p) st.active = [];
      if (ch.when === 'round' && newRound) st.active = [];
    }
  }
}

/** One-line summary of how much of each detachment rule the app applies, for the screen. */
export function detSummary(s: GameState, p: PlayerId): { name: string; auto: DetRule['auto'] | 'none'; manual?: string; active: string[] }[] {
  const names = [...new Set([...(s.players[p].detachments ?? []).map((d) => d.name), ...activeRules(s, p)])];
  return names.map((name) => ({ name })).map((d) => {
    const r = DET_RULES[d.name];
    const st = s.players[p].det?.[d.name];
    const active = r?.choice ? (st?.active ?? []).map((id) => r.choice!.options.find((o) => o.id === id)?.name ?? id) : [];
    return { name: d.name, auto: r?.auto ?? 'none', manual: r?.manual, active };
  });
}
