// Reads detachment stratagem text (WHEN / TARGET / EFFECT) so the game can offer them at the right time
// and apply the common effects automatically. Anything it cannot read is still usable: CP is spent and logged.
import acStrats from '../../data/stratagems/AC.json';
import orkStrats from '../../data/stratagems/ORK.json';
import { reactWorth } from './botPlus';
import smStrats from '../../data/stratagems/SM.json';
import { parseAbilityText } from './abilityText';
import { runActions, shockTest, type Action } from './activations';
import { kwPhrase } from './army';
import { buildShootPools, expectedDamage, finishAttack, onAttackFinished, onModelKilled, resolveAll, startAttack } from './attack';
import { addTimed, cond, lastEnemyAct, unitFlags, type Effect } from './effects';
import {
  afterReaction, autoCharge, canEmbarkIn, chargeTargetOptions, declareCharge, disembarkUnit, embarkedIn, formationAt, validateDisembark,
} from './game';
import { baseDist, dist } from './geometry';
import {
  alive, boardUnits, canUseStratagem, engagedEnemies, log, onBoard, other, setReactHook, spendStratagem, stratCost, unitById, unitDistance,
  type ReactCtx, type ReactOn,
  heroFx,
} from './state';
import type { BuffKind, GameState, Phase, PlayerId, Pt, StratagemData, UnitState } from './types';
import { unitVisibleTo } from './visibility';

/** What a stratagem does, in terms the engine and the bot understand. Hand-written ones live in
 *  data/stratagems/<FACTION>.json (key: the stratagem NAME, or NAME@Detachment); the rest are read from the card. */
export interface StratRule {
  /** quick buffs the dice engine knows (hit+1, enemyAp-1, fnp5 …), put on the target unit */
  buffs?: BuffKind[];
  /** anything the ability effect engine can express (Effect in effects.ts), put on the target unit */
  effects?: Effect[];
  /** one-off actions on the target unit, in the abilities' format (Action in activations.ts):
   *  { "move": "D6" }, { "surge": "D6+1" }, { "mortals": "D3" }, { "heal": "3" }, { "reserves": true }, { "unshock": true } … */
  do?: Action[];
  /** how long: end of the phase (default), end of the turn, or until your next Command phase */
  until?: 'phase' | 'turn' | 'nextCommand';
  /** when the bot considers it: before one of its units attacks, when one is attacked, or never */
  bot?: 'attack' | 'defend' | 'never';
  status?: 'auto' | 'partial' | 'manual';
  /** what the player still does by hand */
  note?: string;
  /** "Select either …": the player picks one option; its buffs / effects / actions are added to the rule's own */
  choice?: StratOption[];
  /** "Select one enemy unit …": the player picks an enemy unit; actions with on:"target" and `enemyEffects` go to it */
  enemy?: EnemyPick;
  /** timed effects put on the picked enemy unit(s) ("that enemy unit is pinned …") */
  enemyEffects?: Effect[];
  /** the TARGET is a unit in Reserves (arriving by Deep Strike this phase), or one destroyed this phase */
  targetFrom?: 'reserves' | 'destroyed' | 'embarked';
  /** the target also counts for up to this many units (Guerrilla Tactics: up to two PHOBOS/SCOUT units) */
  extraTargets?: { count: number; kw?: string[] };
  /** how long `enemyEffects` last (default: as `until`) */
  enemyUntil?: TimedUntil;
  /** the moment the game offers it by itself ("just after an enemy unit has shot" …) */
  react?: ReactOn;
  /** what the own TARGET unit must satisfy (conditions of effects.ts cond(); "…Last" ones look at the enemy unit that just acted) */
  unitIf?: string[];
  /** things only the stratagem engine can do: shoot back, charge now, embark, disembark, move the wreck */
  special?: Special[];
  /** "You can only use this Stratagem once per battle round / battle" */
  limit?: 'round' | 'battle';
  /** the TARGET keywords, when the card's wording can't be read ("INFANTRY or MOUNTED") */
  targetKw?: string[];
  /** reaction to a model's death: the destroyed model must have this keyword (Refusal to Yield: ANCIENT) */
  ctxModel?: string;
  /** reactions: when the bot uses it (default never) */
  botReact?: 'always' | 'shoot' | 'charge';
}

type TimedUntil = 'phase' | 'turn' | 'nextCommand' | 'nextTurnStart' | 'battle';
export type Special = 'shootAt' | 'charge' | 'chargeCap6' | 'embark' | 'embarkEmpty' | 'embarkHeavy' | 'disembarkShoot' | 'disembarkNear6' | 'wreckMove' | 'moveEndDzOrObjective' | 'moveEndObjective' | 'shootAtSnap';

export interface StratOption {
  label: string; buffs?: BuffKind[]; effects?: Effect[]; do?: Action[]; enemyEffects?: Effect[];
  /** only offered when these conditions hold on the target unit */
  if?: string[];
  /** a mark on the timed effects (e.g. "doctrine:tactical" for rules that ask which doctrine a unit is under) */
  mark?: string;
  /** Red Thirst: the unit becomes Battle-shocked */
  shock?: boolean;
}
export interface EnemyPick {
  range?: number; engaged?: boolean; visible?: boolean; kw?: string[]; notKw?: string[];
  /** every enemy unit that fits, nothing to pick */
  all?: boolean;
  /** the enemy unit that just attacked / charged / moved (the last one to act this phase) */
  lastActor?: boolean;
  /** the enemy unit that destroyed ours (reaction context) */
  killer?: boolean;
  /** only units this unit hit this phase (optionally: with a weapon whose name matches) */
  hitBy?: boolean | string;
}

const BOOKS: Record<string, Record<string, StratRule>> = {
  SM: (smStrats as unknown as { rules: Record<string, StratRule> }).rules,
  AC: (acStrats as unknown as { rules: Record<string, StratRule> }).rules,
  ORK: (orkStrats as unknown as { rules: Record<string, StratRule> }).rules,
};

const OFFENCE_BUFFS: BuffKind[] = ['hit+1', 'wound+1', 'rerollHits', 'rerollHits1', 'rerollWounds', 'rerollWounds1', 'ap+1', 'lethal', 'sustained1', 'devastating', 'ignoresCover'];
const DEFENCE_BUFFS: BuffKind[] = ['enemyHit-1', 'enemyWound-1', 'enemyAp-1', 'damage-1', 'fnp4', 'fnp5', 'fnp6', 'cover', 'save+1'];

/** Is a rule's effect about its own attacks, about being attacked, or neither? */
function botUseOf(r0: StratRule): StratRule['bot'] {
  const r = { ...r0, effects: [...(r0.effects ?? []), ...(r0.choice ?? []).flatMap((o) => o.effects ?? [])], buffs: [...(r0.buffs ?? []), ...(r0.choice ?? []).flatMap((o) => o.buffs ?? [])] };
  const fx = r.effects;
  if ((r.buffs ?? []).some((k) => OFFENCE_BUFFS.includes(k)) || fx.some((e) => e.hit || e.wound || e.ap || e.strength || e.attacks || e.damage || e.reroll || e.abilities?.length || e.critHitOn)) return 'attack';
  if ((r.buffs ?? []).some((k) => DEFENCE_BUFFS.includes(k)) || fx.some((e) => e.defend)) return 'defend';
  return 'never';
}

/** "a CHARACTER unit", "a unit within 9"", "that unit" … after "attacks that target" → conditions, or null. */
function targetIf(t?: string): string[] | null {
  if (!t) return [];
  const x = t.trim().replace(/^(?:an? |that |the )/, '');
  if (/^(?:enemy )?unit$/.test(x)) return [];
  if (/^character unit$/.test(x)) return ['targetCharacter'];
  if (/^(?:monster or vehicle|vehicle or monster) unit$/.test(x)) return ['targetMV'];
  if (/^(?:monster|vehicle|infantry|psyker|fly) unit$/.test(x)) return [x === 'infantry unit' ? 'targetInfantry' : `targetKw:${x.split(' ')[0].toUpperCase()}`];
  if (/^battle-shocked unit$/.test(x)) return ['targetBattleShocked'];
  let m: RegExpExecArray | null;
  if ((m = /^unit within (\d+)"$/.exec(x))) return [`within:${m[1]}`];
  if ((m = /^unit (?:that is )?more than (\d+)" away$/.exec(x))) return [`beyond:${m[1]}`];
  if (/^unit within range of (?:an |one or more )?objective(?: markers?)?$/.test(x)) return ['targetOnObjective'];
  return null;
}

/** The 11th edition's short wording: "Your unit's melee attacks have [LANCE].", "Your unit has +2" M.",
 *  "Attacks that target your unit have -1 AP." … One sentence → effects, or null. */
function compactAction(c: string): Action[] | null {
  let m: RegExpExecArray | null;
  const dist = (x: string) => x.toUpperCase().replace(/"$/, '');
  if ((m = /^your unit can (?:immediately )?make a normal move of up to (d6|d3\+\d|\d+)"?$/.exec(c))) return [{ move: dist(m[1]) }];
  if ((m = /^your unit can (?:immediately )?make a surge move of up to (d6\+\d|d6|d3\+\d|\d+)"?$/.exec(c))) return [{ surge: dist(m[1]) }];
  if ((m = /^your unit suffers (d3|d6|\d+) mortal wounds?$/.exec(c))) return [{ mortals: m[1].toUpperCase() }];
  if ((m = /^your unit heals (d3\+\d|d3|\d+) wounds?$/.exec(c))) return [{ heal: m[1].toUpperCase() }];
  if (/^(?:remove your unit from the battlefield and )?place (?:your unit|it) (?:in|into) strategic reserves$/.test(c)) return [{ reserves: true }];
  if (/^your unit is no longer battle-shocked$/.test(c)) return [{ unshock: true }];
  return null;
}

function compactSentence(c: string): Effect[] | null {
  let m: RegExpExecArray | null;
  const kind = (w?: string) => (w ? { attack: w.trim() as 'ranged' | 'melee' } : {});
  // "your unit's ranged attacks (that target …) have [LETHAL HITS] / +1 S / +1 A and S / +1 AP"
  if ((m = /^your unit's (ranged |melee )?attacks(?: that target (.+?))? have:? (?:• )?(.+)$/.exec(c))) {
    const iff = targetIf(m[2]);
    if (iff === null) return null;
    const what = m[3].replace(/\s*• or:.*$/, '').replace(/\.$/, '').trim();
    const e: Effect = { ...kind(m[1]), ...(iff.length ? { if: iff } : {}) };
    const tags = [...what.matchAll(/\[([^\]]+)\]/g)].map((x) => x[1].toLowerCase());
    if (tags.length && /^(?:\[[^\]]+\](?:,| and| or)?\s*)+$/.test(what)) return [{ ...e, abilities: tags }];
    let k: RegExpExecArray | null;
    if ((k = /^\+(\d) (a|s|ap|d)(?: and (a|s|ap))?$/.exec(what))) {
      const key = (w: string) => (w === 'a' ? 'attacks' : w === 's' ? 'strength' : w === 'ap' ? 'ap' : 'damage');
      return [{ ...e, [key(k[2])]: Number(k[1]), ...(k[3] ? { [key(k[3])]: Number(k[1]) } : {}) }];
    }
    return null;
  }
  // "your unit's attacks (that target …) can (re-roll:) • re-roll hit rolls of 1" / "can re-roll wound rolls of 1"
  if ((m = /^your unit's (ranged |melee )?attacks(?: that target (.+?))? can(?: re-roll)?:? (?:• )?(?:can )?re-roll (hit|wound) rolls(?: of 1)?/.exec(c))) {
    const iff = targetIf(m[2]);
    if (iff === null) return null;
    const ones = / of 1/.test(c.slice(m.index, m.index + m[0].length + 6));
    return [{ ...kind(m[1]), reroll: m[3] === 'hit' ? (ones ? 'hits1' : 'hits') : (ones ? 'wounds1' : 'wounds'), ...(iff.length ? { if: iff } : {}) }];
  }
  if ((m = /^your unit has feel no pain (\d)\+( against mortal wounds)?$/.exec(c))) return [{ defend: { fnp: Number(m[1]), ...(m[2] ? { fnpVs: 'mortal' } : {}) } }];
  if ((m = /^your unit has (\d)\+ (?:insv|invulnerable save)$/.exec(c))) return [{ defend: { inv: Number(m[1]) } }];
  if (/^your unit has mobile$/.test(c)) return [{ mobile: true }];
  if (/^your unit has stealth$/.test(c)) return [{ stealth: true }];
  if (/^your unit is riled up(?: until .+)?$/.test(c)) return [{ riled: true }];
  if ((m = /^your unit has \+(\d)" m$/.exec(c))) return [{ move: Number(m[1]) }];
  if ((m = /^your unit has \+(\d) to (advance|charge) rolls$/.exec(c))) return [{ [m[2] === 'advance' ? 'advanceBonus' : 'chargeBonus']: Number(m[1]) }];
  if ((m = /^your unit has \+(\d) (t|oc)(?: until the end of the turn)?$/.exec(c))) return [{ [m[2] === 't' ? 'toughness' : 'oc']: Number(m[1]) }];
  if ((m = /^your unit can re-roll (charge|advance) rolls$/.exec(c))) return [{ [m[1] === 'charge' ? 'rerollCharge' : 'rerollAdvance']: true }];
  // attacks against the unit
  if ((m = /^(ranged |melee )?attacks that target your unit(?: with a s greater than your unit's t)? have -1 (ap|to wound rolls?|to hit rolls?|d)(?: until .+)?$/.exec(c))) {
    const stronger = / with a s greater than/.test(c);
    const d = m[2] === 'ap' ? { ap: 1 } : m[2] === 'd' ? { damage: -1 } : /hit/.test(m[2]) ? { hit: -1 } : stronger ? { woundIfStronger: -1 } : { wound: -1 };
    return [{ defend: { ...d, ...(m[1] ? { vs: m[1].trim() as 'ranged' | 'melee' } : {}) } }];
  }
  return null;
}

/** All sentences of the effect in the short wording, or null when one of them isn't understood. */
function compactEffects(t: string): { effects: Effect[]; acts: Action[] } | null {
  const sents = t.split(/(?<=\.)\s+(?!•)/).map((x) => x.replace(/\.$/, '').trim()).filter((x) => x.length > 3);
  const effects: Effect[] = [];
  const acts: Action[] = [];
  for (const sn of sents) {
    const fx = compactSentence(sn);
    const ac = fx ? null : compactAction(sn);
    if (!fx && !ac) return null;
    effects.push(...(fx ?? []));
    acts.push(...(ac ?? []));
  }
  return effects.length || acts.length ? { effects, acts } : null;
}

const readMemo = new Map<string, StratRule>();

/** Read a stratagem from its card: the quick-buff patterns, then the EFFECT sentences through the ability reader. */
function readStratagem(st: StratagemData): StratRule {
  const key = `${st.name}\n${st.text}`;
  const hit = readMemo.get(key);
  if (hit) return hit;
  const plan = planStratagem(st);
  let t = section(st.text, 'EFFECT').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const until: StratRule['until'] = /^until the end of the turn/.test(t) ? 'turn' : /^until the start of your next command phase/.test(t) ? 'nextCommand' : 'phase';
  t = t.replace(/^until (?:the end of the (?:phase|turn)|the attacking unit has finished making its attacks|the start of your next command phase), /, '');
  const compact = plan.target === 'own' && t ? compactEffects(t) : null;
  t = t.replace(/\byour unit\b/g, 'this unit').replace(/\bthat unit of yours\b/g, 'this unit');
  const parsed = plan.target === 'own' && t && !compact ? parseAbilityText(st.name, t) : undefined;
  const effects = compact?.effects.length ? compact.effects : parsed?.effects?.length ? parsed.effects : undefined;
  let r: StratRule;
  if (compact) r = { ...(compact.effects.length ? { effects: compact.effects } : {}), ...(compact.acts.length ? { do: compact.acts } : {}), until, status: 'auto' };
  else if (plan.full) r = { buffs: plan.effects, until, status: 'auto' };
  else if (effects && parsed!.status !== 'partial') r = { effects, until, status: 'auto' };
  else if (plan.effects.length) r = { buffs: plan.effects, until, status: 'partial', note: 'The app applies what it can read; do the rest as written' };
  else if (effects) r = { effects, until, status: 'partial', note: 'The app applies what it can read; do the rest as written' };
  else r = { status: 'manual', note: 'Resolve it as written' };
  r.bot = botUseOf(r);
  readMemo.set(key, r);
  return r;
}

/** The detachment a player's stratagem comes from. */
export const stratDetachment = (s: GameState, p: PlayerId, st: StratagemData) => s.players[p].detachments.find((d) => d.stratagems.some((x) => x.id === st.id))?.name;

/** What this stratagem does: the faction's hand-written book first, else read from the card. */
export function stratRule(st: StratagemData, factionId?: string, detachment?: string): StratRule {
  const book = factionId ? BOOKS[factionId] : undefined;
  const own = book?.[`${st.name}@${detachment}`] ?? book?.[st.name];
  if (own) return { status: 'auto', ...own, bot: own.bot ?? botUseOf(own) };
  return readStratagem(st);
}

export const stratRuleFor = (s: GameState, p: PlayerId, st: StratagemData) => stratRule(st, s.players[p].factionId, stratDetachment(s, p, st));

export interface StratagemPlan {
  phases: Phase[] | 'any';
  turn: 'your' | 'opponent' | 'either';
  target: 'own' | 'enemy' | 'none';
  effects: BuffKind[];
  until: 'phase' | 'turn';
  /** true when every sentence of the effect was understood */
  full: boolean;
}

const PHASES: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight'];

const OFFENSE: [RegExp, BuffKind][] = [
  [/add 1 to the hit roll/, 'hit+1'],
  [/add 1 to the wound roll/, 'wound+1'],
  [/re-roll a hit roll of 1/, 'rerollHits1'],
  [/re-roll the hit roll/, 'rerollHits'],
  [/re-roll a wound roll of 1/, 'rerollWounds1'],
  [/re-roll the wound roll/, 'rerollWounds'],
  [/improve the armour penetration characteristic of (?:that|those|the) (?:attack|weapon)s? by 1/, 'ap+1'],
  [/\[lethal hits\]/, 'lethal'],
  [/\[sustained hits 1\]/, 'sustained1'],
  [/\[devastating wounds\]/, 'devastating'],
  [/\[ignores cover\]/, 'ignoresCover'],
  // 2026 Codex wording ("Your unit's attacks have +1 to hit rolls", "can re-roll wound rolls of 1")
  [/attacks (?:have|get) \+1 to hit rolls/, 'hit+1'],
  [/attacks (?:have|get) \+1 to wound rolls/, 'wound+1'],
  [/re-roll hit rolls of 1/, 'rerollHits1'],
  [/re-roll hit rolls(?! of)/, 'rerollHits'],
  [/re-roll wound rolls of 1/, 'rerollWounds1'],
  [/re-roll wound rolls(?! of)/, 'rerollWounds'],
  [/attacks have \+1 ap/, 'ap+1'],
];
const DEFENSE: [RegExp, BuffKind][] = [
  [/subtract 1 from the hit roll/, 'enemyHit-1'],
  [/subtract 1 from the wound roll/, 'enemyWound-1'],
  [/worsen the armour penetration characteristic of (?:that|the) attack by 1/, 'enemyAp-1'],
  [/subtract 1 from the damage characteristic/, 'damage-1'],
  [/feel no pain 4\+/, 'fnp4'],
  [/feel no pain 5\+/, 'fnp5'],
  [/feel no pain 6\+/, 'fnp6'],
  [/benefit of cover/, 'cover'],
  [/add 1 to the armour saving throw|improve the save characteristic .* by 1/, 'save+1'],
  [/target your unit have -1 ap/, 'enemyAp-1'],
  [/target your unit have -1 d\b/, 'damage-1'],
  [/target your unit have -1 to hit rolls/, 'enemyHit-1'],
  [/target your unit have -1 to wound rolls/, 'enemyWound-1'],
];
const OTHER: [RegExp, BuffKind][] = [
  [/fights first/, 'fightsFirst'],
  [/add 1 to (?:advance and charge rolls|the advance and charge rolls)/, 'advanceCharge+1'],
];

export const EFFECT_LABEL: Partial<Record<BuffKind, string>> = {
  'hit+1': '+1 Hit', 'wound+1': '+1 Wound', rerollHits1: 'Re-roll Hit 1', rerollHits: 'Re-roll Hits', rerollWounds1: 'Re-roll Wound 1', rerollWounds: 'Re-roll Wounds',
  'ap+1': 'AP +1', lethal: 'Lethal Hits', sustained1: 'Sustained Hits 1', devastating: 'Devastating Wounds', ignoresCover: 'Ignores Cover',
  'enemyHit-1': 'enemy −1 to Hit', 'enemyWound-1': 'enemy −1 to Wound', 'enemyAp-1': 'enemy −1 AP', 'damage-1': '−1 Damage', fnp4: 'FNP 4+', fnp5: 'FNP 5+', fnp6: 'FNP 6+',
  cover: 'Benefit of Cover', 'save+1': '+1 Save', fightsFirst: 'Fights First', 'advanceCharge+1': '+1 Advance/Charge',
};

const section = (text: string, key: string) => {
  const m = text.match(new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n?(?:WHEN|TARGET|EFFECT|RESTRICTIONS):|$)`, 'i'));
  return m ? m[1].trim() : '';
};

export function planStratagem(st: StratagemData): StratagemPlan {
  const phaseText = `${st.phase} ${section(st.text, 'WHEN')}`.toLowerCase();
  const phases: Phase[] | 'any' = /any phase/.test(st.phase.toLowerCase()) ? 'any' : PHASES.filter((p) => phaseText.includes(`${p} phase`) || st.phase.toLowerCase().includes(p));
  const tt = st.turn.toLowerCase();
  const turn = tt.startsWith('your') ? 'your' : tt.startsWith('opponent') ? 'opponent' : 'either';
  const tgt = section(st.text, 'TARGET').toLowerCase();
  const target = /from your army/.test(tgt) ? 'own' : /enemy unit/.test(tgt) ? 'enemy' : tgt ? 'own' : 'none';
  const eff = section(st.text, 'EFFECT').toLowerCase().replace(/’/g, "'");
  const effects: BuffKind[] = [];
  for (const [re, k] of [...OFFENSE, ...DEFENSE, ...OTHER]) if (re.test(eff) && !effects.includes(k)) effects.push(k);
  // "re-roll the hit roll" also matches inside "re-roll a hit roll of 1" phrasing variants; keep the stronger one only
  if (effects.includes('rerollHits') && effects.includes('rerollHits1')) effects.splice(effects.indexOf('rerollHits1'), 1);
  if (effects.includes('rerollWounds') && effects.includes('rerollWounds1')) effects.splice(effects.indexOf('rerollWounds1'), 1);
  const until = /end of the turn|start of your next/.test(eff) ? 'turn' : 'phase';
  const sentences = eff.split(/(?<=\.)\s+/).filter((x) => x.length > 3);
  const full = effects.length > 0 && sentences.length <= 2 && !/select|instead|mortal wound|d6|roll one|set up|move/.test(eff);
  return { phases, turn, target, effects, until, full };
}

/** Does the unit fit the stratagem's TARGET ("That MEGANOBZ/NOBZ unit", "One ADEPTUS ASTARTES INFANTRY unit …")?
 *  Keywords are written in capitals on the card; a target without them fits any of your units. */
export function stratTargetOk(st: StratagemData, u: UnitState): boolean {
  const tgt = section(st.text, 'TARGET').replace(/[’]/g, "'");
  const m = /\b([A-Z][A-Z'-]+(?:[ /][A-Z][A-Z'-]+)*)\b/.exec(tgt.replace(/^(?:One|That|Up to \w+)\s+/, ''));
  if (!m || m[1].length < 3) return true;
  const kws = [...u.keywords, ...u.factionKeywords, ...u.sources];
  return m[1].split('/').some((alt) => kwPhrase(alt.trim(), kws));
}

/** Units a stratagem can be used on: on the battlefield, or (for some) in Reserves / just destroyed. */
export function stratCandidates(s: GameState, p: PlayerId, st: StratagemData, ctx: ReactCtx = {}): UnitState[] {
  const rule = stratRuleFor(s, p, st);
  if (rule.targetFrom === 'destroyed') return ctx.unitId ? [unitById(s, ctx.unitId)].filter((u) => u.owner === p) : [];
  if (rule.targetFrom === 'reserves') return s.units.filter((u) => u.owner === p && u.status === 'reserves');
  if (rule.targetFrom === 'embarked') return s.units.filter((u) => u.owner === p && u.status === 'embarked');
  return boardUnits(s, p);
}

/** Enemy units the stratagem may pick for this own unit. */
export function stratEnemies(s: GameState, p: PlayerId, rule: StratRule, u: UnitState | undefined, ctx: ReactCtx = {}): UnitState[] {
  const q = rule.enemy;
  if (!q) return [];
  if (q.killer) return ctx.killerId ? [unitById(s, ctx.killerId)].filter(onBoard) : [];
  if (q.lastActor) { const L = lastEnemyAct(s, p); return L && onBoard(L.u) ? [L.u] : []; }
  return boardUnits(s, other(p)).filter((e) => {
    if (q.kw && !q.kw.some((k) => e.keywords.includes(k) || e.factionKeywords.includes(k))) return false;
    if (q.notKw && q.notKw.some((k) => e.keywords.includes(k))) return false;
    if (!u || !onBoard(u)) return !(q.range || q.engaged || q.visible || q.hitBy);
    if (q.engaged && !engagedEnemies(s, u).some((x) => x.id === e.id)) return false;
    if (q.range !== undefined && unitDistance(u, e) > q.range + 1e-6) return false;
    if (q.visible && !alive(u).some((m) => unitVisibleTo(s, m, e))) return false;
    if (q.hitBy) {
      const h = u.lastHits;
      if (!h || h.key !== `${s.turn}:${s.phase}` || !h.ids.includes(e.id)) return false;
      if (typeof q.hitBy === 'string' && !(h.byWeapon?.[e.id] ?? []).some((w) => new RegExp(q.hitBy as string, 'i').test(w))) return false;
    }
    return true;
  });
}

const limitUsed = (s: GameState, p: PlayerId, st: StratagemData, rule: StratRule) =>
  rule.limit && s.players[p].stratLimits?.[st.id] !== undefined && (rule.limit === 'battle' || s.players[p].stratLimits![st.id] === s.round);

/** Why the stratagem cannot be used right now (timing / CP / once per phase / target), or null.
 *  `react`: offered by the game at its moment (the timing is already right). */
export function stratagemBlock(s: GameState, p: PlayerId, st: StratagemData, unit?: UnitState, opt: { react?: boolean; ctx?: ReactCtx } = {}): string | null {
  const plan = planStratagem(st);
  const rule = stratRuleFor(s, p, st);
  if (s.phase === 'deploy' || s.phase === 'scouts' || s.phase === 'gameover') return 'The battle has not started';
  if (!opt.react) {
    if (plan.turn === 'your' && s.active !== p) return 'Your turn only';
    if (plan.turn === 'opponent' && s.active === p) return "Opponent's turn only";
    if (plan.phases !== 'any' && plan.phases.length && !plan.phases.includes(s.phase)) return `${plan.phases.join(' / ')} phase only`;
  }
  if (limitUsed(s, p, st, rule)) return rule.limit === 'battle' ? 'Once per battle' : 'Once per battle round';
  if (plan.target === 'own' && !unit) return 'Select a target unit first';
  if (unit && plan.target === 'own' && unit.owner !== p) return 'Must be one of your units';
  if (unit && plan.target === 'own' && unit.owner === p && !(rule.targetKw ? cond(`kw:${rule.targetKw.join('|')}`, { s, A: unit }) : stratTargetOk(st, unit))) return "This unit does not match the Stratagem's TARGET";
  if (unit && plan.target === 'enemy' && unit.owner === p && !rule.enemy) return 'Select an enemy unit';
  if (unit && unit.owner === p) {
    const L = lastEnemyAct(s, p);
    for (const c of rule.unitIf ?? []) if (!cond(c, { s, A: unit, T: L?.u, holder: unit })) return `This unit does not qualify (${condText(c)})`;
    if (rule.enemy && !rule.enemy.all && !stratEnemies(s, p, rule, unit, opt.ctx).length) return 'No enemy unit can be selected';
  }
  return canUseStratagem(s, p, st.id, plan.target === 'own' && unit?.owner === p && rule.targetFrom !== 'destroyed' ? unit : undefined, st.cp);
}

const COND_TH: Record<string, string> = {
  targetOfLast: 'must be the target of the enemy unit that just attacked', lostToLast: 'must have lost models to that attack', halvedByLast: 'must be Below Half-strength after that attack',
  '!engaged': 'must be unengaged', engaged: 'must be engaged', belowStarting: 'must be below Starting Strength', onObjective: 'must be within range of an objective', charged: 'must have charged this turn',
  killedThisPhase: 'must have destroyed an enemy unit this phase', disembarkedThisTurn: 'must have disembarked this turn', entrenched: 'must be ENTRENCHED',
  onControlledObjective: 'must control an objective', hasEmbarkedBattleline: 'must have a BATTLELINE unit embarked', fellBackFromLast: 'the enemy unit must have Fallen Back from this unit',
};
const condText = (c: string) => COND_TH[c] ?? (c.startsWith('nearLast:') ? `must be within ${c.slice(9)}" of that enemy unit` : c);

export interface StratUse { choice?: number; enemyId?: string; extraIds?: string[]; ctx?: ReactCtx }

/** The rule with the chosen option folded in. */
export function withChoice(rule: StratRule, choice?: number): StratRule & { mark?: string; shock?: boolean } {
  const o = choice !== undefined ? rule.choice?.[choice] : undefined;
  if (!o) return rule;
  return {
    ...rule,
    buffs: [...(rule.buffs ?? []), ...(o.buffs ?? [])],
    effects: [...(rule.effects ?? []), ...(o.effects ?? [])],
    do: [...(rule.do ?? []), ...(o.do ?? [])],
    enemyEffects: [...(rule.enemyEffects ?? []), ...(o.enemyEffects ?? [])],
    mark: o.mark, shock: o.shock,
  };
}

/** Options of a "select either …" stratagem the unit may take (some need a condition, e.g. MOUNTED). */
export const stratChoices = (s: GameState, rule: StratRule, u?: UnitState) =>
  (rule.choice ?? []).map((o, i) => ({ o, i })).filter(({ o }) => !o.if || (u && o.if.every((c) => cond(c, { s, A: u, holder: u }))));

/** Spend CP, log, and apply the stratagem to the target unit. Returns the quick buffs applied. */
export function applyDetachmentStratagem(s: GameState, p: PlayerId, st: StratagemData, unitId?: string, use: StratUse = {}): BuffKind[] {
  const plan = planStratagem(st);
  const base = stratRuleFor(s, p, st);
  const rule = withChoice(base, use.choice ?? (base.choice?.length ? stratChoices(s, base, unitId ? unitById(s, unitId) : undefined)[0]?.i : undefined));
  const u = unitId ? unitById(s, unitId) : undefined;
  const costUnit = plan.target === 'own' && u?.owner === p && rule.targetFrom !== 'destroyed' ? u : undefined;
  const cp = stratCost(s, st.id, costUnit, st.cp);
  spendStratagem(s, p, st.id, costUnit, st.cp);
  if (rule.limit) (s.players[p].stratLimits ??= {})[st.id] = rule.limit === 'battle' ? -1 : s.round;
  const buffs = rule.buffs ?? [];
  const until = rule.until === 'turn' || rule.until === 'nextCommand' ? 'turn' : 'phase';
  const own = [u, ...(use.extraIds ?? []).map((id) => unitById(s, id))].filter((x): x is UnitState => !!x && x.owner === p);
  for (const x of own) {
    for (const k of buffs) x.buffs.push({ kind: k, until, label: st.name });
    for (const e of rule.effects ?? []) addTimed(s, x, { e, label: st.name, until: rule.until ?? 'phase', by: p, mark: rule.mark });
    if (rule.shock && !x.battleShocked) { x.battleShocked = true; log(s, `${st.name}: ${x.name} gives in to the Red Thirst → Battle-shocked`, 'info', p); }
  }
  const enemies = rule.enemy
    ? (rule.enemy.all ? stratEnemies(s, p, rule, u, use.ctx) : [stratEnemies(s, p, rule, u, use.ctx).find((e) => e.id === use.enemyId) ?? stratEnemies(s, p, rule, u, use.ctx)[0]].filter((e): e is UnitState => !!e))
    : u && u.owner !== p ? [u] : [];
  for (const e of enemies) for (const fx of rule.enemyEffects ?? []) addTimed(s, e, { e: fx, label: st.name, until: rule.enemyUntil ?? rule.until ?? 'phase', by: p });
  // one-off actions: on the own unit, or on the enemy unit for stratagems that pick one
  const holder = own[0] ?? s.units.find((x) => x.owner === p && x.status === 'board');
  if (rule.do?.length && holder) {
    for (const x of own.length ? own : [holder]) {
      if (enemies.length) for (const e of enemies) runActions(s, st.name, x, rule.do, e);
      else runActions(s, st.name, x, rule.do, x);
    }
  }
  for (const sp of rule.special ?? []) runSpecial(s, p, sp, st.name, own[0] ?? holder, enemies[0], use.ctx ?? {});
  // a stratagem on an EPIC HERO (or a 2CP one on a character): the hero's moment on the board
  const hero = own.find((x) => alive(x).some((m) => m.keywords.includes('EPIC HERO') || (st.cp >= 2 && m.isCharacter)));
  if (hero) heroFx(s, hero, st.name, buffs.some((k) => /^enemy|fnp|damage-|save|cover/.test(k)) || (rule.effects ?? []).some((e) => !!e.defend), undefined, rule.limit === 'battle');
  const what = [...buffs.map((k) => EFFECT_LABEL[k] ?? k), ...(base.choice?.length && use.choice !== undefined ? [base.choice[use.choice].label] : []), ...(rule.effects?.length && !base.choice ? ['applied'] : [])].join(', ');
  log(s, `${s.players[p].name} uses ${st.name} (${cp}CP)${u ? ` → ${u.name}` : ''}${enemies.length ? ` · enemy: ${enemies.map((e) => e.name).join(', ')}` : ''}${what ? `: ${what}` : ''}${rule.status === 'auto' || !rule.status ? '' : ' — resolve the rest as written'}`, 'cp', p);
  return buffs;
}

// ---------- special actions ----------

/** Shoot `target` with `u` right now, as if it were its Shooting phase (dice rolled automatically). */
function shootNow(s: GameState, u: UnitState, target: UnitState, label: string, mode: 'normal' | 'snap' = 'normal') {
  if (!onBoard(u) || !onBoard(target)) return;
  const r = buildShootPools(s, u.id, target.id, { mode });
  if (r.error || !r.pools.length) { log(s, `${label}: ${u.name} cannot shoot ${target.name} (${r.error ?? 'no weapon in range'})`, 'info', u.owner); return; }
  const fired = [...u.weaponsFired];
  log(s, `${label}: ${u.name} shoots ${target.name}`, 'info', u.owner);
  startAttack(s, 'shoot', u.id, target.id, r.pools, { free: true });
  resolveAll(s);
  finishAttack(s);
  u.weaponsFired = fired; // shooting out of phase does not use up its own Shooting phase
}

/** Somewhere near the transport to put a unit (`range` from its hull), as close to `towards` as possible. */
function placeNear(s: GameState, u: UnitState, t: UnitState, range: number, towards: Pt | null, ok: (pos: Map<string, Pt>) => boolean): Map<string, Pt> | null {
  const c = alive(t)[0];
  if (!c) return null;
  let best: { pos: Map<string, Pt>; d: number } | null = null;
  for (let ring = 0; ring <= 4; ring++) {
    const r = c.r + 1 + ring * (range / 4);
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const pos = formationAt(u, { x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r });
      if (!ok(pos)) continue;
      const mid = [...pos.values()].reduce((q, p2) => ({ x: q.x + p2.x / pos.size, y: q.y + p2.y / pos.size }), { x: 0, y: 0 });
      const d = towards ? dist(mid, towards) : ring;
      if (!best || d < best.d) best = { pos, d };
    }
  }
  return best?.pos ?? null;
}

function runSpecial(s: GameState, p: PlayerId, sp: Special, label: string, u: UnitState | undefined, enemy: UnitState | undefined, ctx: ReactCtx) {
  if (!u) return;
  switch (sp) {
    case 'shootAt': if (enemy) shootNow(s, u, enemy, label); return;
    // Power of the Machine Spirit: snap shooting, or normal shooting once the unit is at or below half-strength
    case 'shootAtSnap': if (enemy) shootNow(s, u, enemy, label, alive(u).length * 2 <= u.startingStrength || alive(u).reduce((a, m) => a + m.wounds, 0) * 2 <= u.models.reduce((a, m) => a + m.profile.W, 0) ? 'normal' : 'snap'); return;
    case 'charge': case 'chargeCap6': {
      // a charge out of turn (Leonine Aggression …): only at the enemy units it was allowed to pick, no charge bonus
      // (Selfless Service: a charge roll above 6 counts as 6)
      declareCharge(s, u, false, sp === 'chargeCap6' ? 6 : undefined);
      const opts = chargeTargetOptions(s, u).filter((e) => !enemy || e.id === enemy.id || unitDistance(u, e) <= 6);
      const t = (enemy && opts.find((e) => e.id === enemy.id)) ?? opts[0];
      if (!t || !autoCharge(s, u, [t.id])) { log(s, `${label}: ${u.name}'s charge fails`, 'info', p); u.declaredCharge = false; return; }
      u.chargedTurn = -1; // no Charge bonus (Fights First, Lance …) this turn
      return;
    }
    case 'embark': case 'embarkEmpty': case 'embarkHeavy': {
      const ts = boardUnits(s, p).filter((t) => t.transport && !canEmbarkIn(s, u, t) && (sp !== 'embarkHeavy' || Math.max(...t.models.map((m) => m.profile.W)) >= 14)
        && (sp !== 'embarkEmpty' || !embarkedIn(s, t).length)
        && alive(u).every((m) => alive(t).some((n) => baseDist(m, n) <= 6 + 1e-6)));
      const t = ts.sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
      if (!t) { log(s, `${label}: no transport to embark within 6"`, 'info', p); return; }
      u.status = 'embarked'; u.embarkedIn = t.id;
      log(s, `${label}: ${u.name} embarks in ${t.name}`, 'info', p);
      return;
    }
    case 'disembarkShoot': {
      // Burning Vengeance: one unit gets out of the transport (best shooter) and shoots the attacker
      const inside = embarkedIn(s, u);
      if (!inside.length || !enemy) { log(s, `${label}: no unit embarked`, 'info', p); return; }
      const score = (x: UnitState) => {
        const r = buildShootPools(s, x.id, enemy.id, { mode: 'normal' });
        return r.pools.reduce((a, q) => a + expectedDamage(s, q, enemy).models, 0);
      };
      const x = [...inside].sort((a, b) => score(b) - score(a))[0];
      const pos = placeNear(s, x, u, 3, alive(enemy)[0] ?? null, (q) => validateDisembark(s, x, u, q).ok);
      if (!pos) { log(s, `${label}: no room for ${x.name} to disembark`, 'info', p); return; }
      disembarkUnit(s, x, u, pos);
      shootNow(s, x, enemy, label);
      return;
    }
    case 'disembarkNear6': {
      // Uncompromising Egress: set up wholly within 6" of the Land Raider, even in Engagement Range
      const inside = embarkedIn(s, u);
      const x = inside[0];
      if (!x) { log(s, `${label}: no unit embarked`, 'info', p); return; }
      const foe = boardUnits(s, other(p)).sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
      const pos = placeNear(s, x, u, 6, foe ? alive(foe)[0] : null, (q) => [...q.entries()].every(([id, pt]) => {
        const m = x.models.find((mm) => mm.id === id)!;
        return pt.x >= m.r && pt.y >= m.r && alive(u).some((n) => dist(pt, n) - n.r + m.r <= 6 + 1e-6)
          && !s.units.some((o) => o.id !== x.id && onBoard(o) && alive(o).some((n) => dist(pt, n) < n.r + m.r - 0.01));
      }));
      if (!pos) { log(s, `${label}: no room to disembark`, 'info', p); return; }
      for (const m of alive(x)) { const q = pos.get(m.id)!; m.x = q.x; m.y = q.y; }
      x.status = 'board'; x.embarkedIn = null; x.setUpTurn = s.turn; x.disembarkedTurn = s.turn; x.disembarkedFrom = u.id;
      log(s, `${label}: ${x.name} disembarks from ${u.name} within 6"`, 'info', p);
      return;
    }
    case 'wreckMove': {
      // Machine Wrath: the wreck moves before it blows up, to catch as many enemy units as it can
      const m = u.models.find((x) => x.id === ctx.modelId) ?? u.models[0];
      const M = m.profile.M ?? 0;
      const val = (pt: Pt) => s.units.filter((v) => v.id !== u.id && onBoard(v) && alive(v).some((n) => dist(n, pt) - n.r - m.r <= 6))
        .reduce((a, v) => a + (v.owner === p ? -1.5 : 1) * v.pts, 0);
      let best = { pt: { x: m.x, y: m.y }, v: val(m) };
      for (let a = 0; a < 16; a++) for (const f of [0.5, 1]) {
        const pt = { x: m.x + Math.cos((a / 16) * Math.PI * 2) * M * f, y: m.y + Math.sin((a / 16) * Math.PI * 2) * M * f };
        const v = val(pt);
        if (v > best.v) best = { pt, v };
      }
      if (best.pt.x !== m.x || best.pt.y !== m.y) { m.x = best.pt.x; m.y = best.pt.y; log(s, `${label}: ${u.name} lurches towards the enemy before exploding`, 'info', p); }
      return;
    }
    case 'moveEndObjective':
      if (u.extraMove) u.extraMove.endIn = 'objective';
      return;
    case 'moveEndDzOrObjective':
      if (u.extraMove) u.extraMove.endIn = 'dzOrObjective';
      return;
  }
}

// ---------- reactions: the game offers a stratagem at its moment ----------

/** Moments that cannot wait for a prompt (the dice are being rolled right now): only the bot or "use automatically" act. */
const SYNC_ONLY = new Set<ReactOn>(['deadlyDemise', 'deadlyDemiseSix', 'enemyFallBack']);

export interface ReactOffer { st: StratagemData; rule: StratRule; units: UnitState[] }

/** Detachment stratagems of `p` that react to this moment, with the units they could be used on. */
export function reactionOffers(s: GameState, p: PlayerId, on: ReactOn, ctx: ReactCtx = {}): ReactOffer[] {
  const out: ReactOffer[] = [];
  for (const d of s.players[p].detachments) for (const st of d.stratagems) {
    const rule = stratRule(st, s.players[p].factionId, d.name);
    if (rule.react !== on) continue;
    if (rule.ctxModel && ctx.modelId) {
      const m = ctx.unitId ? unitById(s, ctx.unitId).models.find((x) => x.id === ctx.modelId) : undefined;
      if (!m || !(m.keywords.includes(rule.ctxModel) || new RegExp(rule.ctxModel, 'i').test(m.name))) continue;
    }
    const units = (rule.targetFrom || ['deadlyDemise', 'deadlyDemiseSix', 'modelDestroyed', 'chargeMoveEnd', 'ownAttacked'].includes(on)
      ? (ctx.unitId ? [unitById(s, ctx.unitId)] : [])
      : stratCandidates(s, p, st, ctx)
    ).filter((u) => u.owner === p && !stratagemBlock(s, p, st, u, { react: true, ctx }));
    if (units.length) out.push({ st, rule, units });
  }
  return out;
}

/** Bot (or "use automatically"): which unit and enemy it would use the stratagem with, and whether it is worth it. */
function autoPick(s: GameState, p: PlayerId, o: ReactOffer, ctx: ReactCtx, auto: boolean): { u: UnitState; enemyId?: string; choice?: number } | null {
  const cost = o.st.cp;
  if (!auto && !o.rule.botReact) {
    // moves and redeploys: worth it when the planner finds somewhere better for the unit
    const kind = o.rule.do?.some((a) => a.reserves) ? 'reserves' : o.rule.do?.some((a) => a.surge) ? 'surge' : o.rule.do?.some((a) => a.move) ? 'move'
      : o.rule.special?.some((x) => x.startsWith('embark')) ? 'embark' : null;
    if (!kind || o.rule.enemy) return null;
    const u = o.units.find((x) => reactWorth(s, x, o.st, kind));
    return u ? { u, choice: stratChoices(s, o.rule, u)[0]?.i } : null;
  }
  if (!auto) {
    if (s.players[p].cp < cost + (SYNC_ONLY.has(o.rule.react!) ? 0 : 1)) return null;
  }
  let best: { u: UnitState; enemyId?: string; v: number } | null = null;
  for (const u of o.units) {
    const es = o.rule.enemy ? stratEnemies(s, p, o.rule, u, ctx) : [];
    if (o.rule.enemy && !o.rule.enemy.all && !es.length) continue;
    let v = 1;
    let enemyId = es[0]?.id;
    if (o.rule.botReact === 'shoot' || o.rule.special?.includes('shootAt') || o.rule.special?.includes('shootAtSnap')) {
      v = 0;
      for (const e of es) {
        const r = buildShootPools(s, u.id, e.id, { mode: 'normal' });
        const ev = r.pools.reduce((a, q) => a + expectedDamage(s, q, e).models, 0) * (e.pts / Math.max(1, e.startingStrength));
        if (ev > v) { v = ev; enemyId = e.id; }
      }
      if (!auto && v < 6 * cost) continue; // a free volley is worth a lot
    } else if (o.rule.botReact === 'charge' || o.rule.special?.includes('charge') || o.rule.special?.includes('chargeCap6')) {
      const near = boardUnits(s, other(p)).filter((e) => unitDistance(u, e) <= 12).sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
      if (!near) continue;
      v = 12 - unitDistance(u, near);
      enemyId = near.id;
    } else if (es.length > 1) {
      enemyId = [...es].sort((a, b) => b.pts * alive(b).length / b.startingStrength - a.pts * alive(a).length / a.startingStrength)[0].id;
    }
    if (!best || v > best.v) best = { u, enemyId, v };
  }
  return best ? { u: best.u, enemyId: best.enemyId, choice: stratChoices(s, o.rule, best.u)[0]?.i } : null;
}

function handleReact(s: GameState, p: PlayerId, on: ReactOn, ctx: ReactCtx): boolean {
  if (s.phase === 'deploy' || s.phase === 'scouts' || s.phase === 'gameover') return false;
  const offers = reactionOffers(s, p, on, ctx);
  if (!offers.length) return false;
  const bot = (s.bots ?? []).includes(p) || (s.autoRules ?? []).includes(p);
  const autos = s.players[p].autoStrats ?? [];
  for (const o of offers) {
    const isAuto = !bot && autos.includes(o.st.id);
    if (!bot && !isAuto) continue;
    const pick = autoPick(s, p, o, ctx, isAuto);
    if (!pick) continue;
    applyDetachmentStratagem(s, p, o.st, pick.u.id, { enemyId: pick.enemyId, choice: pick.choice, ctx });
    return true;
  }
  if (bot || SYNC_ONLY.has(on)) return false;
  const left = offers.filter((o) => !autos.includes(o.st.id));
  if (!left.length) return false;
  if (s.window || s.attack) {
    (s.reactQueue ??= []).push({ player: p, on, ctx, turn: s.turn, phase: s.phase });
    return false;
  }
  s.window = { kind: 'stratReaction', player: p, on, ctx, offers: left.map((o) => ({ stratId: o.st.id, units: o.units.map((u) => u.id) })), label: REACT_LABEL[on] ?? on };
  return true;
}

export const REACT_LABEL: Partial<Record<ReactOn, string>> = {
  enemyChargeMoveEnd: 'an enemy unit just made a Charge move', enemyChargePhaseStart: "start of your opponent's Charge phase", enemyCommandStart: "your opponent's Command phase",
  enemyMoved: 'an enemy unit just ended a move', enemyShot: 'an enemy unit has just shot', enemyChargeDeclared: 'an enemy unit just declared a charge', enemyChargePhaseEnd: "end of your opponent's Charge phase",
  fightPhaseEnd: 'end of the Fight phase', chargeMoveEnd: 'your unit just made a Charge move', ownAttacked: 'your unit has just attacked', ownDestroyed: 'your unit was destroyed',
  modelDestroyed: 'your model was destroyed', oathDestroyed: 'the Oath of Moment target was destroyed',
};

setReactHook(handleReact);

// the attack sequence: "just after an enemy unit has shot", "after your unit has shot / fought"
onAttackFinished((s, at, info) => {
  const A = unitById(s, at.attackerId);
  // Onslaught of Fire / Strike from the Shadows: models destroyed → that unit takes a Battle-shock test
  const T = unitById(s, at.targetId);
  if (info.modelsKilled > 0 && onBoard(T) && unitFlags(s, A).shockOnKill && (T.used ??= {}).shockOnKill !== `${s.turn}:${s.phase}`) {
    T.used.shockOnKill = `${s.turn}:${s.phase}`;
    shockTest(s, T, 0, 'Stratagem');
  }
  if (at.free) return;
  if (at.kind === 'shoot' && s.phase === 'shooting' && A.owner === s.active) handleReact(s, other(A.owner), 'enemyShot', { unitId: A.id });
  if (at.kind === 'shoot' || at.kind === 'fight') handleReact(s, A.owner, 'ownAttacked', { unitId: A.id });
  // prompts that waited for the attack to finish (a unit destroyed during it …)
  if (!s.window && s.reactQueue?.length) {
    const q = s.reactQueue.shift()!;
    if (q.turn === s.turn && q.phase === s.phase) handleReact(s, q.player, q.on as ReactOn, q.ctx);
  }
});

// deaths: "when a friendly DEATH COMPANY unit is destroyed", "just after an ANCIENT model is destroyed", "your Oath target is destroyed"
onModelKilled((s, u, m, killerId) => {
  const queue = (p: PlayerId, on: ReactOn, ctx: ReactCtx) => {
    if (!reactionOffers(s, p, on, ctx).length) return;
    if (s.attack) (s.reactQueue ??= []).push({ player: p, on, ctx, turn: s.turn, phase: s.phase });
    else handleReact(s, p, on, ctx);
  };
  queue(u.owner, 'modelDestroyed', { unitId: u.id, modelId: m.id, killerId });
  if (!alive(u).length) {
    queue(u.owner, 'ownDestroyed', { unitId: u.id, killerId });
    if (s.players[other(u.owner)].oathTarget === u.id) queue(other(u.owner), 'oathDestroyed', { unitId: u.id });
  }
});

/** Answer a stratagem prompt: use one of the offered stratagems (or `null` to pass). */
export function answerReaction(s: GameState, stratId: string | null, unitId?: string, use: StratUse = {}) {
  const w = s.window;
  if (w?.kind !== 'stratReaction') return;
  s.window = null;
  if (stratId) {
    const st = s.players[w.player].detachments.flatMap((d) => d.stratagems).find((x) => x.id === stratId);
    if (st) applyDetachmentStratagem(s, w.player, st, unitId, { ...use, ctx: w.ctx });
  }
  if (!s.window) afterReaction(s, w.resume);
}

/** Stratagems of a player's detachments that could be used now, with the reason when not. */
export function stratagemsNow(s: GameState, p: PlayerId) {
  return s.players[p].detachments.flatMap((d) => d.stratagems.map((st) => ({ st, plan: planStratagem(st), detachment: d.name, rule: stratRule(st, s.players[p].factionId, d.name) })));
}

