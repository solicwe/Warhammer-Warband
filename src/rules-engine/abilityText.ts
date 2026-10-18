// Reads the common ability patterns straight from the datasheet text, for factions without a hand-written file
// (data/abilities/<faction>.json). Every sentence must match a known template from start to end; a sentence
// it does not fully understand is left to the player, and the rule is marked "partial" so the unit sheet says so.
import type { AbilityRule, Defend, Effect, Reroll } from './effects';

const cache = new Map<string, AbilityRule | undefined>();

export function parseAbilityText(name: string, text: string): AbilityRule | undefined {
  const key = `${name}\n${text}`;
  if (cache.has(key)) return cache.get(key);
  const r = parse(text);
  cache.set(key, r);
  return r;
}

// ---------- pieces ----------

/** "friendly Adeptus Mechanicus Vehicle" -> keyword phrase filter matched against the unit at play time. */
function kwPhrase(p: string): string[] {
  const alts = p.split(/\s+or\s+|\//i)
    .map((x) => x.replace(/\b(friendly|enemy|one or more|other|units?|models?|an?|the)\b/gi, ' ').replace(/[^a-z' -]/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return alts.length ? [alts.map((x) => `kw:${x.toUpperCase()}`).join('|')] : [];
}

/** What the attack targets ("a MONSTER or VEHICLE unit", "an enemy unit (excluding units that can FLY)") -> conditions, or null. */
function targetConds(x: string): string[] | null {
  const t = x.trim().replace(/^(?:an? |the )/, '').replace(/^enemy /, '');
  if (/^unit$/.test(t)) return [];
  if (/^(?:monster or vehicle|vehicle or monster|monster\/vehicle) unit$/.test(t)) return ['targetMV'];
  if (/^(?:character, monster or vehicle|character, vehicle or monster) unit$/.test(t)) return ['targetCharMV'];
  if (/^vehicle unit$/.test(t)) return ['targetKw:VEHICLE'];
  if (/^monster unit$/.test(t)) return ['targetKw:MONSTER'];
  if (/^character unit$/.test(t)) return ['targetCharacter'];
  if (/^infantry unit$/.test(t)) return ['targetInfantry'];
  if (/^psyker unit$/.test(t)) return ['targetKw:PSYKER'];
  if (/^unit \(excluding (?:monster and vehicle units|monsters and vehicles|monster\/vehicle units|vehicle and monster units)\)$/.test(t)) return ['targetNotMV'];
  if (/^unit \(excluding units that can fly\)$|^unit \(excluding fly units\)$/.test(t)) return ['targetNotFly'];
  if (/^unit that can fly$/.test(t)) return ['targetFly'];
  if (/^unit that is below its starting strength$/.test(t)) return ['targetBelowStarting'];
  if (/^unit that is below half-strength$/.test(t)) return ['targetBelowHalf'];
  if (/^unit (?:that is )?within range of (?:one or more |an )?objective markers?$/.test(t)) return ['targetOnObjective'];
  if (/^closest eligible (?:enemy )?(?:target|unit)$/.test(t)) return ['targetClosest'];
  if (/^unit that is at its starting strength$/.test(t)) return ['targetFullStrength'];
  let g: RegExpExecArray | null;
  if ((g = /^((?:[a-z]+, )*[a-z]+ or [a-z]+) unit$/.exec(t))) return [`targetKw:${g[1].split(/, | or /).map((k) => k.toUpperCase()).join('|')}`];
  if (/^unit within 12"$/.test(t)) return ['within12'];
  if (/^unit within 6"$/.test(t)) return ['within6'];
  return null;
}

const ABIL: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^\[lethal hits\]$/, () => 'lethal hits'], [/^\[sustained hits (\d)\]$/, (m) => `sustained hits ${m[1]}`], [/^\[devastating wounds\]$/, () => 'devastating wounds'],
  [/^\[precision\]$/, () => 'precision'], [/^\[ignores cover\]$/, () => 'ignores cover'], [/^\[twin-linked\]$/, () => 'twin-linked'], [/^\[assault\]$/, () => 'assault'],
  [/^\[lance\]$/, () => 'lance'], [/^\[heavy\]$/, () => 'heavy'], [/^\[anti-([a-z]+) (\d)\+\]$/, (m) => `anti-${m[1]} ${m[2]}+`],
];
function abilityList(x: string): string[] | null {
  const parts = x.replace(/ abilit(?:y|ies)$/, '').split(/\s*(?:,|and)\s*/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const hit = ABIL.map(([re, f]) => { const m = re.exec(p); return m ? f(m) : null; }).find(Boolean);
    if (!hit) return null;
    out.push(hit);
  }
  return out.length ? out : null;
}

/** "add 1 to the Hit roll and you can re-roll the Wound roll" / "+1 to hit rolls, [LETHAL HITS]" -> offensive effect, or null. */
function attackMods(x: string): Partial<Effect> | null {
  const e: Partial<Effect> = {};
  const rr: Reroll[] = [];
  const clauses = x.replace(/\.$/, '').split(/(?<!on a critical (?:wound|hit))\s*(?:,? and |, |; |: )\s*(?=add|you can|re-roll|improve|that attack|\+\d|\[|can re-roll)/);
  for (let c of clauses) {
    c = c.trim().replace(/^and /, '');
    let m: RegExpExecArray | null;
    if ((m = /^add (\d) to the hit roll$|^\+(\d) to hit rolls?$/.exec(c))) e.hit = Number(m[1] ?? m[2]);
    else if ((m = /^add (\d) to the wound roll$|^\+(\d) to wound rolls?$/.exec(c))) e.wound = Number(m[1] ?? m[2]);
    else if (/^(?:you )?(?:can )?re-roll the hit roll$|^(?:can )?re-roll hit rolls$/.test(c)) rr.push('hits');
    else if (/^(?:you can )?re-roll a hit roll of 1$|^(?:can )?re-roll hit rolls of 1$/.test(c)) rr.push('hits1');
    else if (/^(?:you )?(?:can )?re-roll the wound roll$|^(?:can )?re-roll wound rolls$/.test(c)) rr.push('wounds');
    else if (/^(?:you can )?re-roll a wound roll of 1$|^(?:can )?re-roll wound rolls of 1$/.test(c)) rr.push('wounds1');
    else if (/^(?:you )?(?:can )?re-roll the damage roll$|^(?:can )?re-roll damage rolls$/.test(c)) rr.push('damage');
    else if ((m = /^improve the armou?r penetration characteristic of (?:that attack|those attacks) by (\d)$|^\+(\d) ap$/.exec(c))) e.ap = Number(m[1] ?? m[2]);
    else if ((m = /^on a critical wound,? improve the armou?r penetration characteristic of (?:that attack|those attacks) by (\d)$/.exec(c))) e.critWoundAp = Number(m[1]);
    else if ((m = /^add (\d) to the strength characteristic of (?:that attack|those attacks)$|^\+(\d) s$/.exec(c))) e.strength = Number(m[1] ?? m[2]);
    else if ((m = /^add (\d) to the damage characteristic of (?:that attack|those attacks)$|^improve the damage characteristic of (?:that attack|those attacks) by (\d)$|^\+(\d) d$/.exec(c))) e.damage = Number(m[1] ?? m[2] ?? m[3]);
    else if ((m = /^\+(\d) a$/.exec(c))) e.attacks = Number(m[1]);
    else if ((m = /^that attack has the (.+)$/.exec(c))) { const l = abilityList(m[1]); if (!l) return null; e.abilities = [...(e.abilities ?? []), ...l]; }
    else if (/^\[/.test(c)) { const l = abilityList(c); if (!l) return null; e.abilities = [...(e.abilities ?? []), ...l]; }
    else if (/^if a critical hit is scored, that attack has the \[precision\] ability$/.test(c)) e.abilities = [...(e.abilities ?? []), 'precision on crit'];
    else if ((m = /^(?:a successful |an )?unmodified hit roll of (\d)\+ scores a critical hit$/.exec(c))) e.critHitOn = Number(m[1]);
    else if (/^(?:you can )?ignore any or all modifiers to (?:the hit roll|that attack's ballistic skill or weapon skill characteristics?|the ballistic skill characteristic of that weapon)(?: and(?:\/or)? (?:any or )?all modifiers to (?:the hit roll|the ballistic skill characteristic of that weapon))?$/.test(c)) e.ignoreHitMods = true;
    else return null;
  }
  if (rr.length) e.reroll = rr.length === 1 ? rr[0] : rr;
  return Object.keys(e).length ? e : null;
}

/** Defensive clauses after "each time an attack targets this unit, …". */
function defendMods(x: string): Defend | null {
  const d: Defend = {};
  const clauses = x.replace(/\.$/, '').split(/\s*(?:,? and |; )\s*(?=subtract|worsen|if the|models in|halve)/);
  for (const c of clauses.map((y) => y.trim())) {
    if (/^subtract 1 from the hit roll$/.test(c)) d.hit = -1;
    else if (/^subtract 1 from the wound roll$/.test(c)) d.wound = -1;
    else if (/^if the strength characteristic of that attack is greater than (?:this|that) (?:unit's|model's) toughness characteristic, subtract 1 from the wound roll$/.test(c)) d.woundIfStronger = -1;
    else if (/^worsen the armou?r penetration characteristic of that attack by 1$/.test(c)) d.ap = 1;
    else if (/^subtract 1 from the damage characteristic of that attack$/.test(c)) d.damage = -1;
    else if (/^halve the damage characteristic of that attack$/.test(c)) d.halveDamage = true;
    else if (/^models in (?:this|that) unit have the benefit of cover against that attack$|^(?:this|that) unit has the benefit of cover against that attack$/.test(c)) d.cover = true;
    else return null;
  }
  return Object.keys(d).length ? d : null;
}

function fnpClause(c: string): Defend | null {
  const m = /^(?:models in (?:this|that|the bearer's) unit|this model|the bearer|(?:this|that) unit|that model) ha(?:s|ve) the feel no pain (\d)\+ ability(?: against (mortal wounds|psychic attacks|psychic attacks and mortal wounds|mortal wounds and psychic attacks))?$/.exec(c);
  if (!m) return null;
  const d: Defend = { fnp: Number(m[1]) };
  if (m[2]) d.fnpVs = m[2] === 'mortal wounds' ? 'mortal' : m[2] === 'psychic attacks' ? 'psychic' : 'mortalPsychic';
  return d;
}

function invClause(c: string): Defend | null {
  const m = /^(?:models in (?:this|that|the bearer's) unit|this model|the bearer|(?:this|that) unit|that model) ha(?:s|ve) (?:a )?(\d)\+ (?:invulnerable save|insv)(?: against (ranged|melee) attacks)?$/.exec(c);
  return m ? { inv: Number(m[1]), ...(m[2] ? { vs: m[2] as 'ranged' | 'melee' } : {}) } : null;
}

/** Sentences about the unit itself (OC, rolls, eligibility, core abilities). */
function unitClause(c: string): Partial<Effect> | null {
  let m: RegExpExecArray | null;
  const who = '(?:models in (?:this|that|the bearer\'s|this model\'s) unit|this model\'s unit|the bearer\'s unit|this model|the bearer|(?:this|that) unit|that model)';
  if ((m = /^add (\d) to the objective control characteristic of (?:models in (?:this|that|the bearer's) unit|this model|the bearer)$/.exec(c))) return { oc: Number(m[1]) };
  if ((m = /^add (\d)" to (?:the move characteristic of models in (?:this|that) unit|(?:this|that) unit's move characteristic)$/.exec(c))) return { move: Number(m[1]) };
  if (new RegExp(`^${who} ha(?:s|ve) (?:the )?stealth(?: ability)?$`).test(c)) return { stealth: true };
  if (/^(?:you can )?ignore any or all modifiers to (?:that attack's|the) ballistic skill or weapon skill characteristics?(?: and\/or all modifiers to the hit roll)?$/.test(c)) return { ignoreHitMods: true };
  if ((m = new RegExp(`^${who} ha(?:s|ve) \\+(\\d) oc$`).exec(c))) return { oc: Number(m[1]) };
  if (new RegExp(`^${who} ha(?:s|ve) the (?:stealth) ability$`).test(c)) return { stealth: true };
  if ((m = /^add (\d) to the toughness characteristic of (?:models in (?:this|that|the bearer's) unit|this model|the bearer)$/.exec(c))) return { toughness: Number(m[1]) };
  if ((m = /^(?:this|that) unit can only be selected as the target of a ranged attack if the attacking model is within (\d+)"$/.exec(c))) return { targetableWithin: Number(m[1]) };
  if ((m = /^each time a model in (?:this|that) unit makes a pile-in or consolidation move, it can move up to (\d)" instead of up to 3"$/.exec(c))) return { pileIn: Number(m[1]), consolidate: Number(m[1]) };
  if ((m = /^each time a model in (?:this|that) unit makes a consolidation move, it can move up to (\d)" instead of up to 3"$/.exec(c))) return { consolidate: Number(m[1]) };
  if (/^each time (?:this|that) unit makes a normal(?:, advance or charge| or advance) move, it can move horizontally through terrain features(?: as if they were not there)?$|^each time a model in (?:this|that) unit makes a move, it can move (?:horizontally )?through terrain features$/.test(c)) return { mobile: true };
  if (new RegExp(`^${who} ha(?:s|ve) the fights first ability$`).test(c)) return { fightsFirst: true };
  if (new RegExp(`^${who} ha(?:s|ve) the deep strike ability$`).test(c)) return { deepStrike: true };
  if ((m = new RegExp(`^${who} ha(?:s|ve) the scouts (\\d+)" ability$`).exec(c))) return { scouts: Number(m[1]) };
  if (/^add 1 to advance and charge rolls made for (?:this|that) unit$|^(?:this|that) unit has \+1 to advance and charge rolls$/.test(c)) return { advanceBonus: 1, chargeBonus: 1 };
  if (/^add 1 to charge rolls made for (?:this|that) unit$|^(?:this|that) unit has \+1 to charge rolls$/.test(c)) return { chargeBonus: 1 };
  if (/^add 1 to advance rolls made for (?:this|that) unit$|^(?:this|that) unit has \+1 to advance rolls$/.test(c)) return { advanceBonus: 1 };
  if (/^you can re-roll advance rolls made for (?:this|that) unit$|^(?:this|that) unit can re-roll advance rolls$/.test(c)) return { rerollAdvance: true };
  if (/^you can re-roll charge rolls made for (?:this|that) unit$|^(?:this|that) unit can re-roll charge rolls$/.test(c)) return { rerollCharge: true };
  if (/^you can re-roll advance and charge rolls made for (?:this|that|the bearer's) unit$/.test(c)) return { rerollAdvance: true, rerollCharge: true };
  if ((m = /^(?:this|that|this model's) (?:unit|model) is eligible to (shoot|declare a charge|shoot and declare a charge) in a turn in which it (advanced|fell back|advanced or fell back|advanced and\/or fell back)$/.exec(c))) {
    const el: NonNullable<Effect['eligible']> = [];
    const adv = /advanced/.test(m[2]), fb = /fell back/.test(m[2]);
    if (/shoot/.test(m[1])) { if (adv) el.push('shootAfterAdvance'); if (fb) el.push('shootAfterFallBack'); }
    if (/charge/.test(m[1])) { if (adv) el.push('chargeAfterAdvance'); if (fb) el.push('chargeAfterFallBack'); }
    return { eligible: el };
  }
  return null;
}

// ---------- "select one enemy unit hit by those attacks …" ----------

/** What happens to the selected enemy unit: a battle-shock test, no cover, a mark that helps your attacks, a debuff. */
function markEffects(x: string): unknown[] | null {
  const out: unknown[] = [];
  let m: RegExpExecArray | null;
  const parts = x.replace(/\.$/, '').split(/(?<=\.)\s+/).map((y) => y.replace(/\.$/, '').trim());
  for (let i = 0; i < parts.length; i++) {
    const c = parts[i];
    const until = (w: string) => (w === 'end of the phase' ? 'phase' : w === 'end of the turn' ? 'turn' : w === 'start of your next turn' || w === 'start of your next shooting phase' ? 'nextTurnStart' : w === "end of your opponent's next turn" ? 'endOfNextTurn' : null);
    if ((m = /^that (?:enemy )?unit must take a battle-shock test(, subtracting (\d) from (?:that test|the result))?$/.exec(c))) { out.push({ shock: m[2] ? -Number(m[2]) : 0 }); continue; }
    if ((m = /^until the (end of the phase|end of the turn|start of your next (?:shooting phase|turn)), that (?:enemy )?unit cannot have the benefit of cover$/.exec(c))) { out.push({ incoming: { noCover: true }, until: until(m[1]) }); continue; }
    if ((m = /^until the (end of the phase|end of the turn), each time a friendly ([a-z' ]+?) (?:unit|model) makes an? (ranged |melee )?attack that targets that (?:enemy )?unit, (.+)$/.exec(c))) {
      const mods = attackMods(m[4]);
      if (!mods || mods.attacks || mods.strength || mods.damage) return null;
      out.push({ incoming: { units: kwPhrase(m[2]), ...(m[3] ? { attack: m[3].trim() } : {}), ...mods }, until: until(m[1]) });
      continue;
    }
    if ((m = /^until the (end of the phase|end of the turn), each time a (?:friendly )?model that disembarked from this transport this turn makes an attack that targets that (?:enemy )?unit, (.+)$/.exec(c))) {
      const mods = attackMods(m[2]);
      if (!mods) return null;
      out.push({ incoming: mods, fromThisTransport: true, until: until(m[1]) });
      continue;
    }
    // "Until the start of your next turn, that enemy unit is suppressed. While a unit is suppressed, …"
    if ((m = /^until the (start of your next turn|start of your next shooting phase|end of your opponent's next turn|end of the turn), that (?:enemy )?unit is ([a-z]+)$/.exec(c)) && parts[i + 1]) {
      const w = new RegExp(`^while a unit is ${m[2]}, (.+)$`).exec(parts[i + 1]);
      if (!w) return null;
      const e: Partial<Effect> = {};
      for (const d of w[1].split(/ and (?=subtract|it cannot)/)) {
        let k: RegExpExecArray | null;
        if (/^each time a model in that unit makes an attack, subtract 1 from the hit roll$/.test(d)) e.hit = -1;
        else if ((k = /^subtract (\d)" from (?:its|the) move characteristic(?: of models in that unit)?$/.exec(d))) e.move = -Number(k[1]);
        else if ((k = /^subtract (\d) from (?:charge rolls made for it|its charge rolls|charge rolls made for that unit)$/.exec(d))) e.chargeBonus = -Number(k[1]);
        else if (/^it cannot have the benefit of cover$/.test(d)) { out.push({ incoming: { noCover: true }, until: until(m[1]), mark: m[2] }); }
        else return null;
      }
      if (Object.keys(e).length) out.push({ buff: [e], until: until(m[1]), mark: m[2] });
      i += 1;
      continue;
    }
    return null;
  }
  return out.length ? out : null;
}

function afterShot(t: string): AbilityRule | null {
  let m: RegExpExecArray | null;
  if ((m = /^in your shooting phase, after this (?:model|unit) has shot, select one (?:enemy )?(?:(infantry|monster or vehicle|vehicle|monster) )?unit(?: \(excluding monsters and vehicles\))? (?:that was )?hit by one or more of those attacks(?: made with (?:its|this model's|their|a) ([a-z' -]+?))?\. (.+)$/.exec(t))) {
    const fx = markEffects(m[3]);
    if (!fx) return null;
    const units = m[1] === 'infantry' ? ['INFANTRY'] : m[1] === 'monster or vehicle' ? ['MONSTER|VEHICLE'] : m[1] ? [m[1].toUpperCase()] : /\(excluding monsters and vehicles\)/.test(t) ? ['!MONSTER', '!VEHICLE'] : undefined;
    return { parsed: true, act: { when: 'afterShooting', auto: true, target: { side: 'enemy', hit: true, ...(units ? { units } : {}), ...(m[2] ? { hitWeapon: m[2] } : {}) }, do: fx } };
  }
  if ((m = /^in your shooting phase, after this (?:unit|model) has shot, (?:if it is not within engagement range of (?:one or more|any) enemy units, )?it can make a normal move(?: of up to (d6|d3|\d+)")?(?: as if it were your movement phase)?\. if it does, until the end of the turn, this (?:unit|model) is not eligible to declare a charge\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'afterShootingButton', limit: 'phase', if: ['notEngaged'], label: `Move ${m[1] ? `${m[1].toUpperCase()}"` : 'Normal move'} after shooting (no charge)`, do: [{ on: 'self', move: m[1] ? m[1].toUpperCase() : 'M', noCharge: true }] } };
  }
  return null;
}

// ---------- whole-text templates (triggers, stratagem costs, lone operative) ----------

function wholeText(t: string): AbilityRule | null {
  let m: RegExpExecArray | null;
  if (/^once per battle round, one (?:unit|model) from your army with this ability can use it when its unit is targeted with a stratagem\. if it does, reduce the cp cost of that (?:use|usage) of that stratagem by 1cp\.?$/.test(t)
    || /^once per battle round, you can select one model from your army with this ability(?:\. that model's unit can be targeted with a stratagem| and target that model's unit with a stratagem)\. if it does, reduce the cp cost of that (?:use|usage) of that stratagem by 1cp\.?$/.test(t)) {
    return { parsed: true, effects: [{ stratDiscount: { ids: ['*'], cp: 1, limit: 'round', perArmy: true } }] };
  }
  if ((m = /^each time you target this (?:model|unit) with a stratagem, you must spend (twice|three times|four times) that stratagem's stated cp cost to do so\.?$/.exec(t))) {
    return { parsed: true, effects: [], status: 'auto', note: `Stratagems targeting this model cost ${m[1]} CP` };
  }
  if ((m = /^once per turn, when your opponent targets a unit from their army within (\d+)" of this model with a stratagem, (?:this model|you) can use this ability\. if (?:you|it) do(?:es)?,? increase the cp cost of that use of that stratagem by 1cp\.?$/.exec(t))) {
    return { parsed: true, effects: [{ scope: 'enemyAura', range: Number(m[1]), stratTax: { cp: 1, limit: 'turn' } }] };
  }
  if ((m = /^while this model is within (\d+)" of one or more (?:other )?friendly ([a-z' ]+?) units?, (?:unless it is leading a unit, )?this model has the lone operative ability\.?$/.exec(t))) {
    return { parsed: true, effects: [{ loneOperative: true, if: [`near:${m[1]}:${m[2].trim().toUpperCase().replace(/\s+/g, ' ').split(' ').join('+')}`] }] };
  }
  // "Each time this unit ends a Charge move, select one enemy unit within Engagement Range of it and roll one D6: on a 2-3 …"
  const rows: { min: number; max?: number; do: unknown[] }[] = [];
  const re = /on an? (\d)(?:-(\d)|(\+))?,? (?:that enemy unit|that unit|it) suffers (d3\+3|d3|d6|\d+)?(?: )?mortal wounds?/g;
  while ((m = re.exec(t))) rows.push({ min: Number(m[1]), max: m[3] ? undefined : m[2] ? Number(m[2]) : Number(m[1]), do: [{ mortals: (m[4] ?? '1').toUpperCase() }] });
  if (/^each time this (?:model|unit|model's unit) ends a charge move, select one enemy unit within engagement range of (?:it|this model|this unit),? (?:and|then) roll one d6:/.test(t) && rows.length && /\.?$/.test(t) && !/adding|for each|subtract/.test(t)) {
    return { parsed: true, act: { when: 'endOfCharge', auto: true, target: { side: 'enemy', engaged: true }, roll: 'D6', table: rows } };
  }
  if ((m = /^at the start of the fight phase, each enemy unit within (\d+)" of this (?:model|unit) must take a battle-shock test(, subtracting 1 from that test)?\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'fightStart', auto: true, target: { side: 'enemy', range: Number(m[1]), each: true }, do: [{ shock: m[2] ? -1 : 0 }] } };
  }
  if ((m = /^in your shooting phase, after this (?:unit|model) has shot, select one enemy unit hit by one or more of those attacks\. that (?:enemy )?unit must take a battle-shock test(, subtracting 1 from that test)?\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'afterShooting', auto: true, target: { side: 'enemy', hit: true }, do: [{ shock: m[1] ? -1 : 0 }] } };
  }
  if ((m = /^each time this (?:model|unit) ends a charge move, select one enemy unit within engagement range of it\. that unit must take a battle-shock test(, subtracting 1 from that test)?\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'endOfCharge', auto: true, target: { side: 'enemy', engaged: true }, do: [{ shock: m[1] ? -1 : 0 }] } };
  }
  if ((m = /^at the start of your command phase, if this model is on the battlefield(?: and is your warlord)?, you gain (\d)cp\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'commandStart', auto: true, if: ['holderOnBattlefield', ...(/warlord/.test(t) ? ['warlord'] : [])], do: [{ cp: Number(m[1]) }] } };
  }
  if ((m = /^once per battle, at the start of any phase, (?:this model|the bearer) can use this ability\. if it does, until the end of the phase, (?:this model|the bearer) has a (\d)\+ invulnerable save\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'anyPhase', limit: 'battle', botUse: 'valuable', label: `${m[1]}+ invulnerable save until the end of the phase`, do: [{ on: 'self', bearerOnly: true, buff: [{ defend: { inv: Number(m[1]) } }], until: 'phase' }] } };
  }
  if ((m = /^in your shooting phase, after this unit has shot, if it is not within engagement range of (?:one or more|any) enemy units, it can make a normal move of up to (\d+)"\. if it does, until the end of the turn, this unit is not eligible to declare a charge\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'afterShootingButton', limit: 'phase', if: ['notEngaged'], label: `Move ${m[1]}" after shooting (no charge)`, do: [{ on: 'self', move: m[1], noCharge: true }] } };
  }
  const shot = afterShot(t);
  if (shot) return shot;
  if (/^each time an enemy unit \(excluding monsters and vehicles\),? (?:that is )?within engagement range of (?:this model's unit|this model|this unit|one or more units from your army with this ability),? (?:falls back|is selected to fall back), (?:all )?models in that enemy unit must take (?:a )?desperate escape tests?\./.test(t)) {
    return { parsed: true, effects: [{ forceDesperate: true }] };
  }
  if ((m = /^while an enemy unit is within (\d+)" of this (?:model|unit), (.+?)\.?$/.exec(t))) {
    const body = m[2];
    const e: Partial<Effect> = {};
    let ok = true;
    for (const c of body.split(/ and (?=subtract|worsen|add)|\. in addition, /)) {
      let k: RegExpExecArray | null;
      if (/^worsen the leadership characteristic of models in that unit by 1$/.test(c) || /^each time that unit takes a battle-shock test, subtract 1 from that test$/.test(c)) e.ld = -1;
      else if ((k = /^subtract (\d)"? from the move characteristic(?: of models in that unit)?$/.exec(c))) e.move = -Number(k[1]);
      else if ((k = /^subtract (\d) from the objective control characteristic(?: of models in that unit)?$/.exec(c))) e.oc = -Number(k[1]);
      else if (/^each time that unit is selected to fall back, it must take a leadership test\. if that test is failed, that unit must remain stationary this phase instead$/.test(c)) e.fallBackLdTest = true;
      else ok = false;
    }
    if (ok && Object.keys(e).length) return { parsed: true, effects: [{ scope: 'enemyAura', range: Number(m[1]), ...e }] };
  }
  if ((m = /^at the start of your shooting phase, select one (visible )?enemy (?:([a-z]+) )?unit within (\d+)"(?: of (?:and visible to )?this (?:unit|model))?(?: and visible to this (?:unit|model))?\. (.+)$/.exec(t))) {
    const target = { side: 'enemy', range: Number(m[3]), visible: true, ...(m[2] && m[2] !== 'visible' ? { units: [m[2].toUpperCase()] } : {}) };
    const fx = markEffects(m[4]);
    if (fx) return { parsed: true, act: { when: 'shooting', limit: 'phase', target, label: 'Start of the Shooting phase: select a target', do: fx } };
  }
  if ((m = /^at the start of your shooting phase, select one visible enemy (?:([a-z]+) )?unit within (\d+)" of this model and roll one d6: (.+)$/.exec(t)) && rows.length) {
    return { parsed: true, act: { when: 'shooting', limit: 'phase', target: { side: 'enemy', range: Number(m[2]), visible: true, ...(m[1] ? { units: [m[1].toUpperCase()] } : {}) }, label: 'Roll a D6: mortal wounds', roll: 'D6', table: rows } };
  }
  if (/^at the end of your command phase, if this unit is within range of an objective marker you control, that objective marker remains under your control/.test(t)) {
    return { parsed: true, act: { when: 'commandEnd', auto: true, if: ['onOwnObjective'], do: [{ on: 'self', secure: true }] } };
  }
  if ((m = /^each time this (?:model's )?unit ends a charge move, each enemy unit within engagement range of (?:that|this) unit must take a battle-shock test(, subtracting 1 from that test)?\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'endOfCharge', auto: true, target: { side: 'enemy', engaged: true, each: true }, do: [{ shock: m[1] ? -1 : 0 }] } };
  }
  if ((m = /^(?:in your opponent's movement phase, )?(?:each time|if|when) an enemy unit ends a (?:normal, advance or fall back |any kind of )?move within (\d+)" of this (?:unit|model), if this unit is (?:not within engagement range of (?:one or more|any) enemy units|unengaged), (?:this unit|it) can make a normal move of up to (d\d+(?:\+\d+)?|\d+)"?\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'enemyMovedNear', range: Number(m[1]), limit: 'phase', if: ['unengaged'], do: [{ on: 'self', move: m[2].toUpperCase() }] } };
  }
  if (/^each time a model in this unit is destroyed, if that model has not fought this phase, do not remove it from play\. the destroyed model can fight after the attacking (?:model's )?unit has finished making its attacks, and is then removed from play\.?$/.test(t)) {
    return { parsed: true, effects: [{ fightOnDeath: 1 }] };
  }
  if ((m = /^each time a model in this unit is destroyed, if that model has not fought this phase, roll one d6\. on a (\d)\+, do not remove (?:it|the destroyed model) from play;? (?:it|the destroyed model) can fight after the attacking (?:model's )?unit has finished making its attacks, and is then removed from play\.?$/.exec(t))) {
    return { parsed: true, effects: [{ fightOnDeath: Number(m[1]) }] };
  }
  if ((m = /^(?:if|each time) this (?:unit|model) advances, do not make an advance roll(?: for it)?\. instead, until the end of the phase, add (\d+)" to the move characteristic of (?:models in this unit|this model)\.?$/i.exec(t))) {
    return { parsed: true, effects: [{ advanceFixed: Number(m[1]) }] };
  }
  if ((m = /^each time a model in this unit is destroyed by a melee attack, if that model has not fought this phase, roll one d6\. on a (\d)\+, do not remove it from play;? (?:that|the) destroyed model can fight after the attacking (?:model's )?unit has finished making its attacks, and is then removed from play\.?$/.exec(t))) {
    return { parsed: true, effects: [{ fightOnDeath: Number(m[1]) }] };
  }
  if ((m = /^at the end of your movement phase, roll one d6 for each enemy unit within (\d+)" of (?:this model|one or more models with this ability): on a (\d)\+, that (?:enemy )?unit suffers (d3|d6|\d) mortal wounds?\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'movementEnd', auto: true, target: { side: 'enemy', range: Number(m[1]), each: true }, roll: 'D6', table: [{ min: Number(m[2]), do: [{ mortals: m[3].toUpperCase() }] }] } };
  }
  if ((m = /^at the end of your movement phase, roll one d6 for each enemy unit within (\d+)" of this model:/.exec(t)) && rows.length) {
    return { parsed: true, act: { when: 'movementEnd', auto: true, target: { side: 'enemy', range: Number(m[1]), each: true }, roll: 'D6', table: rows } };
  }
  if ((m = /^once per battle, at the start of any phase, you can select one friendly ([a-z' ]+?) unit that is battle-shocked and within (\d+)" of this model\. that unit is no longer battle-shocked\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'anyPhase', limit: 'battle', target: { side: 'friendly', range: Number(m[2]), shocked: true, units: kwPhrase(m[1]) }, label: 'A friendly unit is no longer Battle-shocked', do: [{ unshock: true }] } };
  }
  if ((m = /^once per battle, at the start of any phase, this (?:unit|model) can use this ability\.? if it does, until the end of the phase, models in this unit have the feel no pain (\d)\+ ability\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'anyPhase', limit: 'battle', botUse: 'valuable', label: `Feel No Pain ${m[1]}+ until the end of the phase`, do: [{ on: 'self', buff: [{ defend: { fnp: Number(m[1]) } }], until: 'phase' }] } };
  }
  if ((m = /^once per battle, at the start of the fight phase, this model can use this ability\. if it does, until the end of the phase, add (\d) to the attacks characteristic of melee weapons equipped by this model(?: and those weapons have the \[([a-z ]+)\] ability)?\.?$/.exec(t))) {
    return { parsed: true, act: { when: 'fightStartButton', limit: 'battle', botUse: 'valuable', label: `+${m[1]} A${m[2] ? `, ${m[2]}` : ''} (this model)`, do: [{ on: 'self', bearerOnly: true, buff: [{ attack: 'melee', attacks: Number(m[1]), ...(m[2] ? { abilities: [m[2]] } : {}) }], until: 'phase' }] } };
  }
  if (/^each time this model has shot, select one enemy unit hit by one or more of those attacks\. until the end of the phase, that enemy unit cannot have the benefit of cover\.?$/.test(t)) {
    return { parsed: true, act: { when: 'afterShooting', auto: true, target: { side: 'enemy', hit: true }, do: [{ incoming: { attack: 'ranged', noCover: true }, until: 'phase' }] } };
  }
  if (/^each time this model is selected to shoot, you can re-roll one hit roll, you can re-roll one wound roll and you can re-roll one damage roll when resolving its attacks\.?$/.test(t)) {
    return { parsed: true, freeDie: [{ kind: 'reroll', stage: 'hit', limit: 'phase', attack: 'ranged' }, { kind: 'reroll', stage: 'wound', limit: 'phase', attack: 'ranged' }], status: 'partial', note: 'Damage re-roll: not in the dice tray yet' };
  }
  if (/^once per battle round, after a hit roll, a wound roll,? or a saving throw is made for this model, you can change the result of that roll to a 6\.?$/.test(t)) {
    return { parsed: true, freeDie: { kind: 'setSix', stage: 'any', limit: 'round' }, status: 'partial', note: 'Changing a save to a 6: not in the dice tray yet' };
  }
  if ((m = /^once per turn, you can target this unit with the ([a-z' ]+?) stratagem for 0cp\.?$/.exec(t))) {
    return { parsed: true, effects: [{ stratDiscount: { ids: [m[1].replace(/\s+/g, '-')], cp: 9, limit: 'turn' } }] };
  }
  if (/^you can target this unit with the heroic intervention stratagem, regardless of any other uses of that stratagem this phase\./.test(t)) {
    return { parsed: true, effects: [{ stratRepeat: { ids: ['heroic-intervention'], limit: 'phase' }, ...(/that use is -1 ?cp/.test(t) ? { stratDiscount: { ids: ['heroic-intervention'], cp: 1 } } : {}) }] };
  }
  return null;
}

// ---------- the parser ----------

interface Prefix { scope?: Effect['scope']; range?: number; units?: string[]; if: string[]; kind?: 'melee' | 'ranged' }

/** Leading clauses that say who and when: "While this model is leading a unit, …", "While a friendly X unit is within 6" of this model, …". */
function prefix(s: string): { p: Prefix; rest: string } {
  const p: Prefix = { if: [] };
  let rest = s;
  let m: RegExpExecArray | null;
  for (let guard = 0; guard < 4; guard++) {
    if ((m = /^while this model is leading a unit, /.exec(rest))) { p.scope = 'led'; rest = rest.slice(m[0].length); continue; }
    if ((m = /^while (?:a|an) friendly ([a-z' /-]+?) (?:unit|model) is within (\d+)" of this (?:model|unit), /.exec(rest))) { p.scope = 'aura'; p.range = Number(m[2]); p.units = kwPhrase(m[1]); rest = rest.slice(m[0].length); continue; }
    if ((m = /^while (?:an|a) enemy unit(?: \(excluding ([a-z /]+?) units\))? is within (\d+)" of this (?:model|unit), /.exec(rest))) {
      p.scope = 'enemyAura'; p.range = Number(m[2]);
      p.units = m[1] ? m[1].split(/ and | or |\//).map((x) => `!${x.trim().toUpperCase()}`) : undefined;
      rest = rest.slice(m[0].length); continue;
    }
    if ((m = /^while this unit contains (?:a|an|one or more) ([a-z' -]+?)(?: models?)?, /.exec(rest))) { p.if.push(`contains:${m[1]}`); rest = rest.slice(m[0].length); continue; }
    if ((m = /^while (?:a character|a leader unit|one or more character models?) is leading this unit, /.exec(rest))) { p.if.push('leaderAttached'); rest = rest.slice(m[0].length); continue; }
    if ((m = /^in your shooting phase, /.exec(rest))) { p.if.push('ownShooting'); rest = rest.slice(m[0].length); continue; }
    if ((m = /^in the fight phase, /.exec(rest))) { p.if.push('fightPhase'); rest = rest.slice(m[0].length); continue; }
    if ((m = /^if this unit made a charge move this turn, /.exec(rest))) { p.if.push('charged'); rest = rest.slice(m[0].length); continue; }
    if ((m = /^while this unit is within range of (?:one or more |an )?objective markers?(?: you control)?, /.exec(rest))) { p.if.push('onObjective'); rest = rest.slice(m[0].length); continue; }
    if ((m = /^while this unit is below its starting strength, /.exec(rest))) { p.if.push('belowStarting'); rest = rest.slice(m[0].length); continue; }
    if ((m = /^while this unit is below half-strength, /.exec(rest))) { p.if.push('belowHalf'); rest = rest.slice(m[0].length); continue; }
    break;
  }
  return { p, rest };
}

/** One sentence (after its prefix) -> effects, or null when not fully understood. */
function sentence(s: string, p: Prefix): Effect[] | null {
  let m: RegExpExecArray | null;
  const base = (e: Partial<Effect>, scopeModel = false): Effect => ({
    ...(p.scope ? { scope: p.scope } : scopeModel ? { scope: 'model' } : {}),
    ...(p.range ? { range: p.range } : {}), ...(p.units ? { units: p.units } : {}),
    ...e, ...(p.if.length || e.if ? { if: [...p.if, ...(e.if ?? [])] } : {}),
  } as Effect);
  // "add 1 to the Hit roll if this unit is below its Starting Strength, and add 1 to the Wound roll as well if this unit is Below Half-strength"
  if (/^each time a model in (?:this|that) unit makes an attack, add 1 to the hit roll if (?:this|that) unit is below its starting strength, and add 1 to the wound roll as well if (?:this|that) unit is below half-strength$/.test(s)) {
    return [base({ hit: 1, if: ['belowStarting'] }), base({ wound: 1, if: ['belowHalf'] })];
  }
  // "… makes an attack with a phosphor torch that targets …": the weapon becomes a filter
  if ((m = /^(each time (?:a model in (?:this|that) unit|this model|the bearer) makes an? (?:ranged |melee )?attack) with (?:a|an|its|their|this model's) ([a-z' -]+?)( that targets? .+|, .+| against .+)$/.exec(s))) {
    const rest2 = m[3].replace(/^ against /, ' that targets ');
    const r = sentence(`${m[1]}${rest2}`, p);
    return r ? r.map((e) => ({ ...e, weapon: m![2] })) : null;
  }
  // attacks made by the unit
  if ((m = /^each time (a model in (?:this|that) unit|this model|the bearer) makes an? (ranged |melee )?attack(?: that targets? (.+))?, (.+)$/.exec(s))) {
    // "that targets a CHARACTER, MONSTER or VEHICLE unit, add 1 …": try each comma as the end of the target
    const head = /^each time (?:a model in (?:this|that) unit|this model|the bearer) makes an? (?:ranged |melee )?attack/.exec(s)![0];
    const tail = s.slice(head.length).replace(/^ that targets? /, '');
    const hasTarget = / that targets? /.test(s.slice(head.length, head.length + 14));
    const cuts = hasTarget ? [...tail.matchAll(/, /g)].map((x) => x.index!) : [-2];
    for (const cut of cuts) {
      const tc = hasTarget ? targetConds(tail.slice(0, cut)) : [];
      const mods = attackMods(hasTarget ? tail.slice(cut + 2) : tail.replace(/^, /, ''));
      if (tc === null || !mods) continue;
      return [base({ ...(m[2] ? { attack: m[2].trim() as 'ranged' | 'melee' } : {}), ...mods, ...(tc.length ? { if: tc } : {}) }, m[1] !== 'a model in this unit' && m[1] !== 'a model in that unit')];
    }
    return null;
  }
  if ((m = /^(ranged |melee )?weapons equipped by (?:models in (?:this|that|the bearer's|this model's) unit|this model|the bearer) have the (.+)$/.exec(s))) {
    const l = abilityList(m[2]);
    return l ? [base({ ...(m[1] ? { attack: m[1].trim() as 'ranged' | 'melee' } : {}), abilities: l })] : null;
  }
  if ((m = /^improve the armou?r penetration characteristic of (ranged |melee )?weapons equipped by models in (?:this|that) unit by (\d)$/.exec(s))) {
    return [base({ ...(m[1] ? { attack: m[1].trim() as 'ranged' | 'melee' } : {}), ap: Number(m[2]) })];
  }
  if ((m = /^add (\d) to the (strength|attacks) characteristic of (ranged |melee )?weapons equipped by models in (?:this|that) unit$/.exec(s))) {
    return [base({ ...(m[3] ? { attack: m[3].trim() as 'ranged' | 'melee' } : {}), [m[2] === 'strength' ? 'strength' : 'attacks']: Number(m[1]) })];
  }
  if ((m = /^(?:this|that) (unit|model)'s (ranged |melee )?attacks(?: that target (.+?))? (?:have|can) (.+)$/.exec(s))) {
    const tc = m[3] ? targetConds(m[3]) : [];
    const mods = attackMods(m[4]);
    if (tc === null || !mods) return null;
    return [base({ ...(m[2] ? { attack: m[2].trim() as 'ranged' | 'melee' } : {}), ...mods, ...(tc.length ? { if: tc } : {}) }, m[1] === 'model')];
  }
  // attacks against the unit
  if ((m = /^each time an? (ranged |melee )?attack targets (?:this|that) (?:unit|model), (.+)$/.exec(s))) {
    const d = defendMods(m[2]);
    if (!d) return null;
    if (m[1]) d.vs = m[1].trim() as 'ranged' | 'melee';
    return [base({ defend: d })];
  }
  if ((m = /^each time an attack is allocated to (?:this|a) model(?: in this unit)?, (.+)$/.exec(s))) {
    const d = defendMods(m[1]);
    return d ? [base({ defend: d }, true)] : null;
  }
  if ((m = /^(ranged |melee )?attacks that target (?:this|that) unit have -1 (ap|d|to hit rolls?|to wound rolls?)$/.exec(s))) {
    const d: Defend = m[2] === 'ap' ? { ap: 1 } : m[2] === 'd' ? { damage: -1 } : /hit/.test(m[2]) ? { hit: -1 } : { wound: -1 };
    if (m[1]) d.vs = m[1].trim() as 'ranged' | 'melee';
    return [base({ defend: d })];
  }
  const fnp = fnpClause(s);
  if (fnp) return [base({ defend: fnp }, /^(?:this model|the bearer|that model) /.test(s) && !p.scope)];
  const inv = invClause(s);
  if (inv) return [base({ defend: inv }, /^(?:this model|the bearer|that model) /.test(s) && !p.scope)];
  const u = unitClause(s);
  if (u) return [base(u)];
  const parts = s.split(/ and (?=add|you can|this unit|that unit|models in)/);
  if (parts.length > 1) {
    const all = parts.map((x) => unitClause(x.trim()));
    if (all.every(Boolean)) return [base(Object.assign({}, ...all))];
  }
  return null;
}

function parse(text: string): AbilityRule | undefined {
  if (!text) return undefined;
  const t = text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[‐–—−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  if (/^your army can only include|^this model cannot be your warlord|^if this model is in your army, it must be your warlord|^the bearer is equipped with|^this model has the psychic abilities listed/.test(t)) return { status: 'info' };
  const whole = wholeText(t);
  if (whole) return whole;
  // a choice or a limited-use ability: its parts are not always on, so only the whole-text templates above can read it
  if (/select one of the following|choose one of the following|once per (?:battle|turn|phase|battle round)|can use this ability|you can select|the first time|each time this (?:model|unit) is selected to/.test(t)) return undefined;
  const gear = /\bthe bearer\b|bearer's unit/.test(t);
  const sents = t.split(/(?<=\.)\s+|\s*•\s*/).map((x) => x.trim().replace(/\.$/, '')).filter((x) => x.length > 3);
  const effects: Effect[] = [];
  let missed = 0;
  // a shared leading clause ("While this model is leading a unit, …") applies to every sentence of the ability
  let shared: Prefix | null = null;
  for (const raw of sents) {
    const { p, rest } = prefix(raw);
    const use: Prefix = p.scope || p.if.length ? p : shared && /\bthat unit\b|models in that unit|\bthat model\b/.test(rest) ? shared : p;
    if (p.scope || p.if.length) shared = p;
    const fx = sentence(rest, use);
    if (fx) effects.push(...fx); else missed++;
  }
  if (!effects.length) return undefined;
  const rule: AbilityRule = { parsed: true, effects };
  if (gear) rule.gear = true;
  if (missed) { rule.status = 'partial'; rule.note = 'Partly read by the app: resolve the rest yourself'; }
  return rule;
}
