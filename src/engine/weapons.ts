// Parses weapon ability keywords from the data (e.g. "lethal hits: non-monster/vehicle", "anti-infantry 4+").
import type { WeaponProfileData } from './types';

export interface KwCond { neg: boolean; kws: string[] }
export interface ParsedAbility { key: string; value?: string; on?: number; cond?: KwCond }

function parseCond(s?: string): KwCond | undefined {
  if (!s) return undefined;
  let t = s.trim().toUpperCase();
  let neg = false;
  if (t.startsWith('NON-')) { neg = true; t = t.slice(4); }
  return { neg, kws: t.split('/').map((k) => k.trim()).filter(Boolean) };
}

export function parseAbility(raw: string): ParsedAbility {
  const s = raw.trim().toLowerCase();
  const anti = /^anti-(non-)?(.+?)\s+(\d)\+$/.exec(s);
  if (anti) return { key: 'anti', on: +anti[3], cond: parseCond((anti[1] ?? '') + anti[2]) };
  const [head, cond] = s.split(':');
  const m = /^([a-z' -]+?)(?:\s+(d?\d+(?:\+\d+)?))?$/.exec(head.trim());
  const key = (m ? m[1] : head).trim().replace(/\s+/g, '-');
  const norm = key === 'pistol' ? 'close-quarters' : key;
  return { key: norm, value: m?.[2], cond: parseCond(cond) };
}

export function condApplies(cond: KwCond | undefined, targetKeywords: string[]): boolean {
  if (!cond) return true;
  const has = cond.kws.some((k) => targetKeywords.includes(k));
  return cond.neg ? !has : has;
}

export function abilitiesOf(p: WeaponProfileData): ParsedAbility[] {
  return p.abilities.map(parseAbility);
}

/** Returns the ability if present and applicable to this target. */
export function getAbility(p: WeaponProfileData, key: string, targetKeywords: string[] = []): ParsedAbility | undefined {
  return abilitiesOf(p).find((a) => a.key === key && condApplies(a.cond, targetKeywords));
}
export const hasAbility = (p: WeaponProfileData, key: string, targetKeywords: string[] = []) => !!getAbility(p, key, targetKeywords);

export const isMelee = (p: WeaponProfileData) => p.range === 'Melee';
export const isRanged = (p: WeaponProfileData) => p.range !== 'Melee';

const LABEL: Record<string, string> = {
  'close-quarters': 'Close-quarters', 'rapid-fire': 'Rapid Fire', 'lethal-hits': 'Lethal Hits', 'sustained-hits': 'Sustained Hits',
  'devastating-wounds': 'Devastating Wounds', 'twin-linked': 'Twin-linked', 'ignores-cover': 'Ignores Cover', 'indirect-fire': 'Indirect Fire',
  'one-shot': 'One Shot', 'extra-attacks': 'Extra Attacks',
};
export function abilityLabel(a: ParsedAbility): string {
  if (a.key === 'anti') return `Anti-${a.cond?.neg ? 'non-' : ''}${a.cond?.kws.join('/')} ${a.on}+`;
  const name = LABEL[a.key] ?? a.key.replace(/(^|-)(\w)/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase());
  const cond = a.cond ? `: ${a.cond.neg ? 'non-' : ''}${a.cond.kws.join('/')}` : '';
  return `${name}${a.value ? ' ' + a.value.toUpperCase() : ''}${cond}`;
}
