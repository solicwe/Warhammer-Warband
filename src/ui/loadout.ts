// Which model is which in a squad with mixed wargear: a short label (the weapon that sets it apart) for every model
// whose kit differs from what the whole squad carries.
import type { ModelState, UnitState } from '../engine/types';

const FILLER = /^(astartes|master-crafted|archeotech|relic|artificer)\s+/i;

/** "Master-crafted Power Weapon" → "Power Weapon", long names cut to fit under a token. */
export function shortItem(name: string, max = 13): string {
  let n = name.replace(FILLER, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  if (n.length > max) n = n.slice(0, max - 1).trimEnd() + '…';
  return n;
}

const items = (m: ModelState) => [...new Set([...m.weapons.map((w) => w.name), ...(m.gear ?? [])])];
const isGun = (m: ModelState, name: string) => m.weapons.some((w) => w.name === name && w.profiles.some((p) => p.range !== 'Melee'));
const isPistol = (name: string) => /pistol/i.test(name);

const namedSquad = (ms: ModelState[]) => new Set(ms.map((m) => m.name).filter((n) => n && n !== ms[0].source)).size >= 3;

/** "Twin Lightning Claws" → "Claws", "Thunder Hammer" → "Hammer", "Storm Shield" → "Shield": the word that tells kits apart. */
export function itemTag(name: string): string {
  if (/storm shield/i.test(name)) return 'Shield';
  return name.replace(/^((twin|master-crafted|astartes|archeotech|relic|artificer|lightning|thunder|power)[\s-]+)+/i, '').replace(/\s*\(.*?\)\s*/g, ' ').trim() || name;
}

/** model id → what sets its kit apart (`tag` for the token, `full` for the unit card). */
function loadouts(u: UnitState): Map<string, { tag: string; full: string }> {
  const out = new Map<string, { tag: string; full: string }>();
  const bySource = new Map<string, ModelState[]>();
  for (const m of u.models) bySource.set(m.source, [...(bySource.get(m.source) ?? []), m]);
  for (const ms of bySource.values()) {
    if (ms.length < 2) continue;
    // a squad of named characters (Wardens of Ultramar): each model goes by its name
    if (namedSquad(ms)) {
      for (const m of ms) if (!m.dead) out.set(m.id, { tag: m.name.split(' ').pop()!, full: `${m.name}: ${items(m).join(', ')}` });
      continue;
    }
    const sets = ms.map(items);
    const sig = sets.map((x) => [...x].sort().join('|'));
    if (sig.every((x) => x === sig[0])) continue; // everyone carries the same
    const common = sets[0].filter((x) => sets.every((y) => y.includes(x)));
    // the squad's usual kit: when nearly everyone carries it (9 bolters and a plasma gun) only the odd ones out get a
    // label; a real split (3 hammers and shields, 2 pairs of claws) labels every model
    const count = new Map<string, number>();
    for (const x of sig) count.set(x, (count.get(x) ?? 0) + 1);
    const [usualSig, usualN] = [...count].sort((p, q) => q[1] - p[1])[0];
    const labelUsual = usualN / ms.length < 0.7;
    const usual = sets[sig.indexOf(usualSig)];
    ms.forEach((m, i) => {
      if (m.dead) return;
      if (sig[i] === usualSig && !labelUsual) return;
      const own = sets[i].filter((x) => !(labelUsual ? common : usual).includes(x));
      if (!own.length) return;
      // guns first (not pistols), then melee weapons, then wargear
      const rank = (x: string) => (isGun(m, x) && !isPistol(x) ? 0 : m.weapons.some((w) => w.name === x) ? 1 : 2);
      const sorted = [...own].sort((p, q) => rank(p) - rank(q));
      const tag = sorted.slice(0, 2).map(itemTag).join('+') + (sorted.length > 2 ? ' +' : '');
      out.set(m.id, { tag, full: sorted.join(' + ') });
    });
  }
  return out;
}

/** model id → short label for the token, only for models whose kit needs telling apart. */
export function loadoutLabels(u: UnitState): Map<string, string> {
  return new Map([...loadouts(u)].map(([id, l]) => [id, l.tag]));
}

/** For the unit card: who carries what in a mixed squad ("3× Thunder Hammer + Storm Shield", "Lucia Vestha: …"). */
export function loadoutSummary(u: UnitState): string[] {
  const out = new Map<string, number>();
  for (const [, l] of loadouts(u)) out.set(l.full, (out.get(l.full) ?? 0) + 1);
  return [...out].map(([k, n]) => (k.includes(':') ? k : `${n}× ${k}`));
}
