// Rule text with its key terms in bold, so a card reads at a glance: KEYWORDS, re-rolls, +1/-1 modifiers, weapon
// abilities and core rules, distances and rolls, and the names of units, stratagems and abilities the page passes in.
import { Fragment, type ReactNode } from 'react';

const TERMS = [
  // modifiers and re-rolls
  String.raw`re-roll(?:s|ed)?(?: (?:a|the|one|that|any|all|your))? (?:(?:Hit|Wound|Damage|Charge|Advance|saving|Battle-shock|Leadership|Hazardous|Desperate Escape)\s+)?(?:rolls?|tests?)?(?: of \d(?:s| or \d)?)?`,
  String.raw`(?:add|subtract) \d+ (?:to|from) (?:the )?(?:Hit|Wound|Charge|Advance|Damage|Battle-shock|saving|Armour Penetration|Strength|Attacks|Move|Leadership|Objective Control|Toughness)[A-Za-z ]*?(?:roll|test|characteristic)s?`,
  String.raw`(?:improve|worsen) (?:the )?[A-Z][A-Za-z ]*? characteristic[^.]*? by \d+`,
  String.raw`[+−-]\d+(?:"|”)? (?:to (?:the )?)?(?:Hit|Wound|Damage|Charge|Advance|Toughness|Strength|Attacks|AP|Move|OC|Leadership)?(?: rolls?| characteristic)?`,
  // core rules and weapon abilities
  String.raw`(?:Lethal Hits|Sustained Hits(?: [\dD+]+)?|Devastating Wounds|Twin-linked|Precision|Lance|Melta(?: \d+)?|Rapid Fire(?: [\dD+]+)?|Anti-[A-Za-z]+ \d\+|Ignores Cover|Indirect Fire|Torrent|Blast|Heavy|Hazardous|Assault|Pistol|Extra Attacks|One Shot)`,
  String.raw`(?:Feel No Pain \d\+|Deadly Demise [\dD+]+|Deep Strike|Scouts \d+"|Infiltrators|Stealth|Lone Operative|Fights First|Leader|Firing Deck \d+|Benefit of Cover|invulnerable save of \d\+|\d\+ invulnerable save|mortal wounds?|Battle-shock(?:ed)?|Objective Control|Strategic Reserves|Normal move|Fall(?:s)? Back|Advance(?:d|s)?|Heroic Intervention|Fire Overwatch|Oath of Moment|Combat Doctrines?|(?:Assault|Devastator|Tactical) Doctrine|Command points?|\d+CP|sticky|Critical (?:Hit|Wound)s?)`,
  // distances and rolls
  String.raw`\d+(?:\.\d+)?(?:"|”)`, String.raw`D\d(?:\+\d)?`, String.raw`\b\d\+`,
  // KEYWORDS: two or more capital letters, runs of them
  String.raw`\b[A-Z][A-Z'\-]+(?: [A-Z][A-Z'\-]+)*\b`,
];

const BASE = new RegExp(TERMS.join('|'), 'g');
const cache = new Map<string, RegExp>();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function regexFor(names?: string[]): RegExp {
  if (!names?.length) return BASE;
  const key = names.join('\u0001');
  let r = cache.get(key);
  if (!r) {
    const ns = [...new Set(names.filter((n) => n.length > 3))].sort((a, b) => b.length - a.length).map(escape);
    r = new RegExp(`${ns.length ? `\\b(?:${ns.join('|')})\\b|` : ''}${TERMS.join('|')}`, 'g');
    if (cache.size > 50) cache.clear();
    cache.set(key, r);
  }
  return r;
}

/** Split text into plain runs and bold key terms. */
export function emph(text: string, names?: string[]): ReactNode[] {
  const re = regexFor(names);
  re.lastIndex = 0;
  const out: ReactNode[] = [];
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!m[0].trim()) { re.lastIndex++; continue; }
    // single capitals ("A", "I") and lone numbers are not terms
    if (/^[A-Z]$/.test(m[0])) continue;
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(<b key={m.index} className="em">{m[0]}</b>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function Em({ text, names }: { text: string; names?: string[] }) {
  return <Fragment>{emph(text, names)}</Fragment>;
}
