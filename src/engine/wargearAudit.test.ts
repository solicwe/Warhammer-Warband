import fs from 'node:fs';
import { expect, it } from 'vitest';
import { buildUnits, wargearMax, wargearProblems, wkey } from './army';
import type { ArmyList, DatasheetData, FactionData } from './types';

/** Every wargear option of every datasheet can be picked, and the chosen weapons end up on the built models.
 *  KNOWN lists the options the card text itself makes unpickable alone, or whose replaced weapon is not in the datasheet loadout. */
const KNOWN = [
  'Corsair Voidreavers #4', // needs the shuriken rifle swap first
  'Wracks #2', // needs a torturer's tool, which no model starts with
  'Krieg Command Squad #0', 'Einhyr Hearthguard #3', 'Knight Destrier #1', 'Thunderhawk Gunship #1', // replaced weapon absent from the loadout
  'Havocs #2', // the lascannon is offered back as a choice, so keeping it removes nothing
];
it('every wargear option can be picked and shows on the models', () => {
  const out: string[] = [];
  let opts = 0, choices = 0, bad = 0;
  for (const f of fs.readdirSync('public/data/factions')) {
    const fac = JSON.parse(fs.readFileSync(`public/data/factions/${f}`, 'utf8')) as FactionData;
    for (const d of fac.datasheets as DatasheetData[]) {
      const sizes = d.points.flatMap((t) => t.options).map((o) => o.models);
      const size = Math.max(...sizes, 1);
      const pts = d.points.flatMap((t) => t.options).find((o) => o.models === size)?.pts ?? 0;
      const weaponKeys = new Set(d.weapons.map((w) => wkey(w.name)));
      (d.wargearOptions ?? []).forEach((o, i) => {
        opts++;
        const max = wargearMax(d, o, size, [], []);
        if (max <= 0 && !o.requires?.length && !o.perItem && !o.requiresNot?.length) { out.push(`${f} ${d.name} #${i} NOMAX: ${o.text.slice(0, 120)}`); bad++; }
        const all = [...o.choices.map((c, ci) => ({ c, ci })), ...(o.pick && o.pickFrom ? [{ c: o.pickFrom.slice(0, o.pick), ci: -1 }] : [])];
        for (const { c, ci } of all) {
          choices++;
          // gained items that are not weapons: gear is fine, but a split name ("Knives", "Fists") is a parse error
          const notWeapons = c.filter((n) => !weaponKeys.has(wkey(n)));
          const looksWeapon = notWeapons.filter((n) => !/shield|banner|icon|standard|drone|pack|auspex|vox|cloak|plate|armour|grenade|relic|orb|wings|totem|medi|tome|helm|gem|veil|mask|sigil|horn|crown|amulet|beacon|field|stave of|cyber|fang|familiar|launcher pod|shroud|teleport|attendant|servo|mantle|gauntlet of|reliquary|wreath|instrument|loudmouth|cyborg|grot|bomb|trophy|totem|gun drone|signum|reclusiam|jump|ammo|stikkbomb|rokkit|spear|ogryn|brute shield/i.test(n));
          if (max > 0) {
            let picks: any[] = [{ opt: i, choice: ci, count: Math.min(max, o.scope === 'all' ? max : 1), ...(ci < 0 ? { picks: c } : {}) }];
            let e: any = { uid: 'x', datasheet: d.name, models: size, pts, wargear: picks };
            let probs = wargearProblems(d, e);
            // a swap of an item another option gives: take that option first
            if (probs.length) {
              const first = (d.wargearOptions ?? []).map((x, j) => ({ x, j })).find(({ x, j }) => j !== i && x.choices.some((cc) => cc.some((y) => o.replace.some((r) => wkey(r) === wkey(y)))));
              if (first) { const fc = first.x.choices.findIndex((cc) => cc.some((y) => o.replace.some((r) => wkey(r) === wkey(y)))); picks = [{ opt: first.j, choice: fc, count: 1 }, ...picks]; e = { ...e, wargear: picks }; probs = wargearProblems(d, e); }
            }
            if (probs.length) { out.push(`${f} ${d.name} #${i}/${ci} PROBLEM ${probs.join('; ').slice(0, 160)} | ${o.text.slice(0, 120)}`); bad++; continue; }
            const list = { name: 't', factionId: fac.id, battleSize: 'strike', detachments: [], units: [e] } as ArmyList;
            let built;
            try { built = buildUnits(list, fac, 0)[0]; } catch (err) { out.push(`${f} ${d.name} BUILD ${err}`); bad++; continue; }
            const carried = built.models.flatMap((m) => [...m.weapons.map((w) => wkey(w.name)), ...(m.gear ?? []).map(wkey)]);
            const missing = c.filter((n) => !carried.includes(wkey(n)));
            if (missing.length) { out.push(`${f} ${d.name} #${i}/${ci} NOTCARRIED ${missing.join(', ')} | ${o.text.slice(0, 120)}`); bad++; }
            const base = buildUnits({ ...list, units: [{ ...e, wargear: [] }] }, fac, 0)[0].models.flatMap((m) => [...m.weapons.map((w) => wkey(w.name)), ...(m.gear ?? []).map(wkey)]);
            const gone = o.replace.filter((r) => !c.some((x) => wkey(x) === wkey(r)));
            // "X or Y": one of the alternatives is enough
            if (gone.length && !gone.some((r) => base.includes(wkey(r)) && carried.filter((y) => y === wkey(r)).length < base.filter((y) => y === wkey(r)).length) && !base.some((x) => carried.filter((y) => y === x).length < base.filter((y) => y === x).length)) { out.push(`${f} ${d.name} #${i}/${ci} NOTREMOVED ${gone.join(', ')} | ${o.text.slice(0, 120)}`); bad++; }
          }
          if (looksWeapon.length) out.push(`${f} ${d.name} #${i}/${ci} NOTWEAPON ${looksWeapon.join(', ')} | ${o.text.slice(0, 120)}`);
        }
        // replaced items no model has
        const loadout = Object.values(d.loadout ?? {}).flat().map((x) => wkey(String(x)));
        const missRep = o.replace.filter((r) => !loadout.includes(wkey(r)) && !(d.wargearOptions ?? []).some((p) => p.choices.some((c) => c.some((x) => wkey(x) === wkey(r)))));
        if (missRep.length) out.push(`${f} ${d.name} #${i} REPLACE-UNKNOWN ${missRep.join(', ')} | ${o.text.slice(0, 120)}`);
      });
    }
  }
  const unexpected = out.filter((l) => !/ (NOTWEAPON|REPLACE-UNKNOWN) /.test(l) && !KNOWN.some((k) => l.includes(` ${k.split(' #')[0]} #${k.split('#')[1]}`)));
  expect(opts).toBeGreaterThan(1000);
  expect(unexpected).toEqual([]);
}, 120000);
