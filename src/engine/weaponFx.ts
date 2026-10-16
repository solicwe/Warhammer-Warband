import type { WeaponProfileData } from './types';

/** How a weapon looks when it fires on the board. */
export type WeaponFx =
  | 'bolt' | 'heavyBolt' | 'gatling' | 'shoota' | 'shotgun' | 'sniper' | 'pulse'
  | 'plasma' | 'las' | 'melta' | 'volkite' | 'grav' | 'lightning' | 'psychic'
  | 'flame' | 'missile' | 'shell'
  | 'gauss' | 'shuriken' | 'bio' | 'sonic'
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
  if (/chain|choppa|eviscerator|ripper|saw|buzz|teef|flesh-tearer/.test(n)) return 'chain';
  if (/claw|talon|scything|mandible|pincer|rending|razor|hook|barb/.test(n)) return 'claw';
  if (/hammer|fist|klaw|mace|maul|crozius|wrecker|crusher|smash|gauntlet|hand of dominion|tail|horns|slam|bludgeon|club|battering/.test(n)) return 'crush';
  if (/combat|knife|knives|shiv|armoured|tracks|hull|feet|bulk|ram\b|stock|'eadbutt|’eadbutt|toolz|syringe|impact|buckler|lash whip|whip|tendril|tentacle/.test(n)) return 'slash';
  if (/power|force|relic|blade|sword|axe|spear|lance|glaive|halberd|stave|staff|rod|greatsword|vaultsword|morkai|executioner|hyperphase|warscythe|voidblade|witchblade|singing spear|charnabal/.test(n) || has(p, 'psychic')) return 'power';
  return 'slash';
}

function rangedFx(n: string, p: WeaponProfileData): WeaponFx | null {
  // 1. Psychic / Warp / C'tan powers / Disruptors
  if (has(p, 'psychic') || /smite|psychic|witch|warp|astropathic|mind wipe|thunderclap|d-cannon|distortion|d-scythe|gaze of death|gaze of gork|cosmic insanity|time’s arrow|time's arrow|antimatter meteor|spirit vortex|baleblast|fatecaster|neuro disruptor/.test(n)) return 'psychic';

  // 2. Sonic / Cacophony (Noise Marines, Slaanesh)
  if (/sonic|blastmaster|cacophon|dirgesinger|heartstring|scream of despair|cacophony|noise/.test(n)) return 'sonic';

  // 3. Volkite / Eradication rays
  if (/volkite|eradication ray|eradication caster|radium jezzail/.test(n)) return 'volkite';

  // 4. Flame / Torrent / Acid / Spewers / Vials
  if (has(p, 'torrent') || /flam|burna|skorcha|pyre|acid|drool|spewer|plaguespitter|ignis|firestorm|phosphor|incinerat|cleanser|bile spurt|chemical vials/.test(n)) return 'flame';

  // 5. Melta / Fusion / Thermal / Dark Scythe
  if (/melta|fusion|inferno pistol|heat lance|thermal|magma|solar atomis|firepike|wailing doom|heat ray|dark scythe/.test(n)) return 'melta';

  // 6. Plasma / Bio-plasma
  if (/plasma|mega-blasta|mega-zappa|mega-slugga|bio-plasm|bioplasm|arioch/.test(n)) return 'plasma';

  // 7. Grav / Transdimensional / Force fields
  if (/grav|transdimensional|transmatter/.test(n)) return 'grav';

  // 8. Lightning / Tesla / Arc / Haywire
  if (/zzap|tesla|lightning|arc rifle|arc pistol|arc blaster|shokk|storm of|taser|galvanic|electro|haywire|voltaic/.test(n)) return 'lightning';

  // 9. Las / Lance / Beam / Lenses
  if (/\blas\b|\blas-|lascannon|laspistol|lasgun|laser|arachnus|bright lance|dark lance|lance\b|prism|hot-shot|hellgun|lasblaster|lascutter|hawk’s talon|hawk's talon|fury of the tempest|bale eye|lantern|sol’s righteous gaze|sol's righteous gaze|eye of wrath/.test(n)) return 'las';

  // 10. Gauss / Necron energy beams / Enmitic
  if (/gauss|staff of light|staff of the destroyer|rod of covenant|death ray|scouring eye|doomsday blaster|aeonstave|sceptre of eternal glory|staff of stars|enmitic/.test(n)) return 'gauss';

  // 11. Shuriken / Eldar monomolecular blades
  if (/shuriken|bloody twins|silent death|maugetar|triskele|chainsabres/.test(n)) return 'shuriken';

  // 12. Tyranid Bio / Symbiote projectiles / Lashes / Toxins
  if (/fleshborer|devourer|deathspitter|spinefist|spine banks|spinemaws|tentaclid|barblauncher|barbed strangler|spore mine|toxinjector|bio-weapon|ossefactor|grasping tongue|living whip|lashes|lash of|scourging whip|malefic lash|dartmask|jindarii|anzuq/.test(n)) return 'bio';

  // 13. Sniper / Long-range precision
  if (/sniper|marksman|instigator|stalker|longrifle|fusil|eliminator|exitus|railgun|rail rifle|magna-rail|arquebus|needle|tachyon arrow|condemnor|shade/.test(n)) return 'sniper';

  // 14. Missiles / Rockets / Launchers / Harpoons / Javelins
  if (/missile|rocket|rokkit|krak\b|tankbusta|cyclone|stormstrike|icarus|hunter-killer|hunter-slayer|skyhammer|typhoon|blackstar|vengor|launcher|launcha|stinger pod|shardlauncher|warhead|apm|salvo|harpoon|javelin|tribalest|snagga klaw|grabba dragga/.test(n) && !/frag|grenade/.test(n)) return 'missile';

  // 15. Shells / Mortars / Grenades / Artillery / Explosives / Heavy ordnance
  if (/cannon|kannon|mortar|thunderfire|whirlwind|vengeance|bombard|lobba|artillery|orbital|grenade|frag|demolisher|bomb|rift|stranglethorn|venom cannon|rupture cannon|earthshaker|blight launcher|demolition|explosive|breacher ordnance|tremor shells|bubblechukka|seismic|skullhurler|death’s heads|death's heads|plague flail|bloodflail|doomweaver|shadow weaver|star bolas|grenadier gauntlet|stikka/.test(n) && !/autocannon|bolt cannon|burst cannon|shuriken cannon|assault cannon/.test(n)) return 'shell';

  // 16. Gatling / Rotary / Assault cannon / Multi-barrel
  if (/gatling|gatler|assault cannon|rotor|avenger|minigun|ripper gun|hurricane|accelerator|punisher|onslaught|shardstorm|defensive array|anvillus|ardex-defensor/.test(n)) return 'gatling';

  // 17. Shoota / Orky ballistic weapons
  if (/shoota|dakka|slugga|kustom|snazz|blasta|zappa|mork’s roar|mork's roar|mek speshul|boomstikk|squigstoppa|saddlegit/.test(n)) return 'shoota';

  // 18. Shotgun / Scatter / Flechette
  if (/shotgun|scatter|flechette/.test(n)) return 'shotgun';

  // 19. Pulse / Tau / Adrathic / Exotic energy
  if (/\bpulse|\bion\b|disintegrat|adrathic|conversion|beam|las-pulser|splinter|starcannon|synaptic|particle|burst cannon|neutron blaster|blaster|support turret|drone defenders/.test(n)) return 'pulse';

  // 20. Heavy Bolter / Autocannon / Heavy Stubber
  if (/heavy bolt|macro|autocannon|auto cannon|stubber|assault bolter|ironhail|executioner|bolt cannon|kinetic destroyer|heavy slugger|autostub|eagle's scream|gnosis|fidelis|talon of horus|hand of dominion|gauntlets of ultramar|blackout|perdition|lion's wrath|the deliverer|foehammer|ferocity|gorgon's wrath|maimer/.test(n)) return 'heavyBolt';

  // 21. Standard Bolt / Pistol / Rifle
  if (/bolt|pistol|rifle|carbine|gun|spear|axe|blade|firearm|combi|small arms|kill shot/.test(n)) return 'bolt';

  return null;
}
