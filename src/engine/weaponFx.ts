import type { WeaponProfileData } from './types';

/** How a weapon looks when it fires on the board. */
export type WeaponFx =
  | 'bolt' | 'heavyBolt' | 'gatling' | 'shoota' | 'shotgun' | 'sniper' | 'pulse'
  | 'plasma' | 'las' | 'melta' | 'volkite' | 'grav' | 'lightning' | 'psychic'
  | 'flame' | 'missile' | 'shell'
  | 'slash' | 'power' | 'chain' | 'crush' | 'claw';

const has = (p: WeaponProfileData, a: string) => (p.abilities ?? []).some((x) => x.toLowerCase().startsWith(a));

/** Pick the look of a weapon from its name and abilities (the profile name first: "Kombi-rokkit / Shoota"). */
export function weaponFx(weapon: string, p: WeaponProfileData, melee: boolean): WeaponFx {
  if (melee) return meleeFx(`${weapon} ${p.name ?? ''}`.toLowerCase(), p);
  if (has(p, 'torrent')) return 'flame';
  const prof = p.name && p.name !== weapon ? rangedFx(p.name.toLowerCase(), p) : null;
  return prof ?? rangedFx(weapon.toLowerCase(), p) ?? (has(p, 'psychic') ? 'psychic' : 'bolt');
}

function meleeFx(n: string, p: WeaponProfileData): WeaponFx {
  if (/chain|choppa|eviscerator|ripper|saw|buzz|teef/.test(n)) return 'chain';
  if (/claw|talon/.test(n)) return 'claw';
  if (/hammer|fist|klaw|mace|maul|crozius|wrecker|crusher|smash|gauntlet|hand of dominion/.test(n)) return 'crush';
  if (/combat|knife|knives|shiv|armoured|tracks|hull|feet|bulk|ram\b|stock|'eadbutt|’eadbutt|toolz|syringe|impact|buckler/.test(n)) return 'slash';
  if (/power|force|relic|blade|sword|axe|spear|lance|glaive|halberd|stave|staff|rod|greatsword|vaultsword|morkai|executioner/.test(n) || has(p, 'psychic')) return 'power';
  return 'slash';
}

function rangedFx(n: string, p: WeaponProfileData): WeaponFx | null {
  if (/flam|burna|skorcha|pyre/.test(n)) return 'flame';
  if (/plasma|mega-blasta|mega-zappa|mega-slugga/.test(n)) return 'plasma';
  if (/melta|fusion|inferno pistol/.test(n)) return 'melta';
  if (/volkite/.test(n)) return 'volkite';
  if (/grav/.test(n)) return 'grav';
  if (/\blas\b|\blas-|lascannon|laspistol|lasgun|laser|arachnus/.test(n)) return 'las';
  if (/zzap|tesla|lightning|arc rifle|arc pistol|shokk|storm of/.test(n)) return 'lightning';
  if (has(p, 'psychic') || /smite|psychic|witch|warp|astropathic|mind wipe|thunderclap/.test(n)) return 'psychic';
  if (/gatling|gatler|assault cannon|rotor|avenger|minigun|ripper gun|hurricane|accelerator|big shoota|supa shoota|supa-shoota|mega-shoota|deffgun/.test(n)) return 'gatling';
  if (/missile|rocket|rokkit|krak\b|tankbusta|cyclone|stormstrike|icarus|hunter-killer|hunter-slayer|skyhammer|typhoon|blackstar|vengor|castellan launcher|salvo/.test(n) && !/frag/.test(n)) return 'missile';
  if (/cannon|kannon|mortar|thunderfire|whirlwind|vengeance|bombard|lobba|artillery|orbital|grenade|frag|demolisher|bomb|rift/.test(n) && !/autocannon|bolt cannon/.test(n)) return 'shell';
  if (/shoota|dakka|slugga|kustom|snazz|blasta|zappa/.test(n)) return 'shoota';
  if (/shotgun|scatter/.test(n)) return 'shotgun';
  if (/sniper|marksman|instigator|stalker|longrifle|fusil|eliminator|exitus/.test(n)) return 'sniper';
  if (/\bpulse|\bion\b|disintegrat|adrathic|gauss|conversion|beam|las-pulser/.test(n)) return 'pulse';
  if (/heavy bolt|macro|autocannon|auto cannon|stubber|assault bolter|ironhail|executioner|bolt cannon|kinetic destroyer/.test(n)) return 'heavyBolt';
  if (/bolt|pistol|rifle|carbine|gun|spear|axe|blade|firearm|combi/.test(n)) return 'bolt';
  return null;
}
