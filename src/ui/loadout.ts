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

/** model id → label, only for models whose weapons / wargear differ from the rest of their squad. */
export function loadoutLabels(u: UnitState): Map<string, string> {
  const out = new Map<string, string>();
  const bySource = new Map<string, ModelState[]>();
  for (const m of u.models) bySource.set(m.source, [...(bySource.get(m.source) ?? []), m]);
  for (const ms of bySource.values()) {
    if (ms.length < 2) continue;
    // a squad of named characters (Wardens of Ultramar): each model goes by its name
    if (namedSquad(ms)) {
      for (const m of ms) if (!m.dead) out.set(m.id, m.name.split(' ').pop()!);
      continue;
    }
    const sets = ms.map(items);
    const sig = sets.map((s) => [...s].sort().join('|'));
    if (sig.every((x) => x === sig[0])) continue; // everyone carries the same
    // the squad's usual kit (the most common loadout): only models that differ from it get a label
    const count = new Map<string, number>();
    for (const x of sig) count.set(x, (count.get(x) ?? 0) + 1);
    const usual = sets[sig.indexOf([...count].sort((a, b) => b[1] - a[1])[0][0])];
    ms.forEach((m, i) => {
      if (m.dead) return;
      const own = sets[i].filter((x) => !usual.includes(x));
      if (!own.length) return;
      // the item that tells it apart: a gun first (not a pistol), then a melee weapon, then wargear
      const pick = own.find((x) => isGun(m, x) && !isPistol(x)) ?? own.find((x) => m.weapons.some((w) => w.name === x)) ?? own[0];
      out.set(m.id, pick + (own.length > 1 ? ' +' : ''));
    });
  }
  return out;
}

/** For the unit card: who carries what in a mixed squad ("2× Heavy Bolter", "Lucia Vestha: Archeotech Laspistol, …"). */
export function loadoutSummary(u: UnitState): string[] {
  const out = new Map<string, number>();
  const labels = loadoutLabels(u);
  for (const m of u.models) {
    if (m.dead || !labels.has(m.id)) continue;
    const named = namedSquad(u.models.filter((x) => x.source === m.source)) || (u.models.filter((x) => x.source === m.source && x.name === m.name).length === 1 && m.name !== m.source);
    const kit = [...new Set([...m.weapons.map((w) => w.name), ...(m.gear ?? [])])].join(', ');
    const k = named ? `${m.name}: ${kit}` : labels.get(m.id)!.replace(/ \+$/, '');
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return [...out].map(([k, n]) => (n > 1 ? `${n}× ${k}` : k.includes(':') ? k : `1× ${k}`));
}
