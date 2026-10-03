// Reads detachment stratagem text (WHEN / TARGET / EFFECT) so the game can offer them at the right time
// and apply the common effects automatically. Anything it cannot read is still usable: CP is spent and logged.
import orkStrats from '../../data/stratagems/ORK.json';
import smStrats from '../../data/stratagems/SM.json';
import { parseAbilityText } from './abilityText';
import { runActions, type Action } from './activations';
import { kwPhrase } from './army';
import { addTimed, type Effect } from './effects';
import { canUseStratagem, log, spendStratagem, stratCost, unitById } from './state';
import type { BuffKind, GameState, Phase, PlayerId, StratagemData, UnitState } from './types';

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
}

const BOOKS: Record<string, Record<string, StratRule>> = {
  SM: (smStrats as unknown as { rules: Record<string, StratRule> }).rules,
  ORK: (orkStrats as unknown as { rules: Record<string, StratRule> }).rules,
};

const OFFENCE_BUFFS: BuffKind[] = ['hit+1', 'wound+1', 'rerollHits', 'rerollHits1', 'rerollWounds', 'rerollWounds1', 'ap+1', 'lethal', 'sustained1', 'devastating', 'ignoresCover'];
const DEFENCE_BUFFS: BuffKind[] = ['enemyHit-1', 'enemyWound-1', 'enemyAp-1', 'damage-1', 'fnp4', 'fnp5', 'fnp6', 'cover', 'save+1'];

/** Is a rule's effect about its own attacks, about being attacked, or neither? */
function botUseOf(r: StratRule): StratRule['bot'] {
  const fx = r.effects ?? [];
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
  else if (plan.effects.length) r = { buffs: plan.effects, until, status: 'partial', note: 'ระบบทำส่วนที่อ่านได้ ส่วนที่เหลือทำตามข้อความ' };
  else if (effects) r = { effects, until, status: 'partial', note: 'ระบบทำส่วนที่อ่านได้ ส่วนที่เหลือทำตามข้อความ' };
  else r = { status: 'manual', note: 'ทำตามข้อความเอง' };
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
];
const OTHER: [RegExp, BuffKind][] = [
  [/fights first/, 'fightsFirst'],
  [/add 1 to (?:advance and charge rolls|the advance and charge rolls)/, 'advanceCharge+1'],
];

export const EFFECT_LABEL: Partial<Record<BuffKind, string>> = {
  'hit+1': '+1 Hit', 'wound+1': '+1 Wound', rerollHits1: 'Re-roll Hit 1', rerollHits: 'Re-roll Hits', rerollWounds1: 'Re-roll Wound 1', rerollWounds: 'Re-roll Wounds',
  'ap+1': 'AP +1', lethal: 'Lethal Hits', sustained1: 'Sustained Hits 1', devastating: 'Devastating Wounds', ignoresCover: 'Ignores Cover',
  'enemyHit-1': 'ศัตรู −1 Hit', 'enemyWound-1': 'ศัตรู −1 Wound', 'enemyAp-1': 'ศัตรู AP −1', 'damage-1': '−1 Damage', fnp4: 'FNP 4+', fnp5: 'FNP 5+', fnp6: 'FNP 6+',
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

/** Why the stratagem cannot be used right now (timing / CP / once per phase), or null. */
export function stratagemBlock(s: GameState, p: PlayerId, st: StratagemData, unit?: UnitState): string | null {
  const plan = planStratagem(st);
  if (s.phase === 'deploy' || s.phase === 'scouts' || s.phase === 'gameover') return 'ยังไม่เริ่ม battle round';
  if (plan.turn === 'your' && s.active !== p) return 'ใช้ได้เฉพาะเทิร์นของคุณ';
  if (plan.turn === 'opponent' && s.active === p) return 'ใช้ได้เฉพาะเทิร์นศัตรู';
  if (plan.phases !== 'any' && plan.phases.length && !plan.phases.includes(s.phase)) return `ใช้ได้ใน ${plan.phases.join(' / ')} phase`;
  if (plan.target === 'own' && !unit) return 'เลือกหน่วยเป้าหมายก่อน';
  if (unit && plan.target === 'own' && unit.owner !== p) return 'ต้องเป็นหน่วยของคุณ';
  if (unit && plan.target === 'own' && !stratTargetOk(st, unit)) return 'หน่วยนี้ไม่ตรงกับ TARGET ของ stratagem';
  if (unit && plan.target === 'enemy' && unit.owner === p) return 'ต้องเลือกหน่วยศัตรู';
  return canUseStratagem(s, p, st.id, plan.target === 'own' ? unit : undefined, st.cp);
}

/** Spend CP, log, and apply the stratagem to the target unit. Returns the quick buffs applied. */
export function applyDetachmentStratagem(s: GameState, p: PlayerId, st: StratagemData, unitId?: string): BuffKind[] {
  const plan = planStratagem(st);
  const rule = stratRuleFor(s, p, st);
  const u = unitId ? unitById(s, unitId) : undefined;
  const cp = stratCost(s, st.id, plan.target === 'own' ? u : undefined, st.cp);
  spendStratagem(s, p, st.id, plan.target === 'own' ? u : undefined, st.cp);
  const buffs = rule.buffs ?? [];
  const until = rule.until === 'turn' || rule.until === 'nextCommand' ? 'turn' : 'phase';
  if (u && plan.target === 'own') {
    for (const k of buffs) u.buffs.push({ kind: k, until, label: st.name });
    for (const e of rule.effects ?? []) addTimed(s, u, { e, label: st.name, until: rule.until ?? 'phase', by: p });
  }
  // one-off actions: on the own unit, or on the enemy unit for stratagems that pick one
  const holder = u && u.owner === p ? u : s.units.find((x) => x.owner === p && x.status === 'board');
  if (rule.do?.length && holder) runActions(s, st.name, holder, rule.do, u ?? holder);
  const what = [...buffs.map((k) => EFFECT_LABEL[k] ?? k), ...(rule.effects?.length ? ['ระบบทำให้'] : [])].join(', ');
  log(s, `${s.players[p].name} ใช้ ${st.name} (${cp}CP)${u ? ` → ${u.name}` : ''}${what ? `: ${what}` : ''}${rule.status === 'auto' ? '' : ' — ส่วนที่เหลือทำตามข้อความ'}`, 'cp', p);
  return buffs;
}

/** Stratagems of a player's detachments that could be used now, with the reason when not. */
export function stratagemsNow(s: GameState, p: PlayerId) {
  return s.players[p].detachments.flatMap((d) => d.stratagems.map((st) => ({ st, plan: planStratagem(st), detachment: d.name, rule: stratRule(st, s.players[p].factionId, d.name) })));
}

