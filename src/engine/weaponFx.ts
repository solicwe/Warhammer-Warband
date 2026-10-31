import { exprAverage } from './dice';
import type { WeaponProfileData } from './types';

/** How a weapon looks when it fires on the board. */
export type WeaponFx =
  | 'bolt' | 'heavyBolt' | 'gatling' | 'shoota' | 'shotgun' | 'sniper' | 'pulse'
  | 'plasma' | 'las' | 'melta' | 'volkite' | 'grav' | 'lightning' | 'psychic'
  | 'flame' | 'missile' | 'shell'
  | 'gauss' | 'shuriken' | 'bio' | 'sonic' | 'cryo'
  | 'slash' | 'power' | 'chain' | 'crush' | 'claw';

const has = (p: WeaponProfileData, a: string) => (p.abilities ?? []).some((x) => x.toLowerCase().startsWith(a));

/** Pick the look of a weapon from its name and abilities (the profile name first: "Kombi-rokkit / Shoota"). */
export function weaponFx(weapon: string, p: WeaponProfileData, melee: boolean): WeaponFx {
  if (melee) return meleeFx(`${weapon} ${p.name ?? ''}`.toLowerCase(), p);
  if (has(p, 'torrent')) return 'flame';
  // psychic fire (Coruscating Flames, Fires of the Abyss) burns like a flamer, in the warp's colours
  if (has(p, 'psychic') && /flame|fire\b|fires|firestorm|blaze|burn|pyre/i.test(`${weapon} ${p.name ?? ''}`) && !/fireball/i.test(`${weapon} ${p.name ?? ''}`)) return 'flame';
  // a profile name only wins when it names a real weapon kind ("/ frag", "/ Shoota"), not a generic word ("Kill Shot")
  const prof = p.name && p.name !== weapon ? rangedFx(p.name.toLowerCase(), p, false) : null;
  return prof ?? rangedFx(weapon.toLowerCase(), p, true) ?? (has(p, 'psychic') ? 'psychic' : 'bolt');
}

/** How hard a weapon hits, for the size of its effect: about 0.85 for a lasgun, 1 for a bolter, 1.8 for a lascannon.
 *  Flamers are sized by the weapon instead (their Strength and Damage barely differ): a hand flamer small, a heavy or
 *  twin flamer big. */
export function weaponPow(p: WeaponProfileData, weapon = ''): number {
  if (has(p, 'torrent') || (has(p, 'psychic') && /flame|fire/i.test(`${weapon} ${p.name ?? ''}`))) {
    const n = `${weapon} ${p.name ?? ''}`.toLowerCase();
    if (has(p, 'pistol') || has(p, 'close-quarters') || /hand|pistol|tendril|spurt/.test(n)) return 0.7;
    if (has(p, 'twin-linked') || has(p, 'blast 2') || /heavy|storm|breath|cannon|roar|abyss|focused/.test(n) || (p.S ?? 4) >= 6) return 1.45;
    return 1.05;
  }
  return Math.max(0.7, Math.min(1.8, 0.55 + (p.S ?? 4) / 16 + exprAverage(p.D || 1) / 8));
}

/** The colour of a flame that is not ordinary promethium: warpfire, daemon fire, plague or C'tan fire. */
export function flameTint(weapon: string, p: WeaponProfileData): string | undefined {
  const n = `${weapon} ${p.name ?? ''}`.toLowerCase();
  if (/pink/.test(n)) return '#ec4899';
  if (/blue/.test(n)) return '#3b82f6';
  if (/yellow/.test(n)) return '#facc15';
  if (/cacophon/.test(n)) return '#ec4899';
  if (/plague|rot|nurgl/.test(n)) return '#84cc16';
  if (/cosmic|gauntlet of fire|c'tan|c’tan/.test(n) || has(p, "c'tan power")) return '#22c55e';
  if (/darkflame|balefire/.test(n)) return '#65a30d';
  if (/hellfire breath|burning blood|burning roar|blood/.test(n)) return '#dc2626';
  if (/purif|holy|sanctif|blessed/.test(n)) return '#bfdbfe'; // a Grey Knight's purifying fire burns silver
  if (has(p, 'psychic') || /warpflame|warp|tzeentch|flickering|abyss|coruscating|witchfire/.test(n)) return '#a855f7';
  return undefined;
}

function meleeFx(n: string, p: WeaponProfileData): WeaponFx {
  if (/chain|choppa|eviscerator|ripper|saw|buzz|teef|flesh-tearer|gorechild|fleshmower|lopping shears/.test(n)) return 'chain';
  if (/claw|talon|scything|mandible|pincer|rending|razor|hook|barb|maw|bite|jaw|fang|tusk|teeth|mouth|chompa|wulfen/.test(n)) return 'claw';
  // stomps, rams and hulls hit like a hammer
  if (/hammer|fist|klaw|mace|maul|crozius|wrecker|crusher|smash|gauntlet|hand of dominion|tail|horns|hooves|slam|bludgeon|club|battering|armoured|tracks|hull|feet|footfalls|bulk|\bram\b|wreckin|'eadbutt|’eadbutt|stock|drill|dreadnought combat|mining tool|graviton|powerful limbs|knucklebusta|krumpa/.test(n)) return 'crush';
  if (/combat|knife|knives|shiv|toolz|syringe|buckler|lash|whip|tendril|tentacle|flail/.test(n) && !/power|force|electro|arc |taser|nemesis/.test(n)) return 'slash';
  // power fields, force weapons, relic blades, and the crackling shock weapons
  if (/power|force|relic|blade|sword|sabre|axe|spear|lance|glaive|halberd|stave|staff|rod\b|scythe|klaive|khopesh|cleaver|great weapon|encarmine|frostfang|drach|wailing doom|plasma|electro|arc scourge|taser|crackling|agoniser|weapons of|exalted weapon|accursed weapon|forge weapon|wolf guard weapon|morkai|executioner|hyperphase|warscythe|voidblade|witchblade|singing spear|charnabal/.test(n) || has(p, 'psychic')) return 'power';
  // a named relic with strike and sweep profiles is a master-crafted blade
  if (/ (strike|sweep)$/.test(n)) return 'power';
  return 'slash';
}

function rangedFx(n: string, p: WeaponProfileData, catchAll: boolean): WeaponFx | null {
  // 1. Psychic / Warp / C'tan powers / Disruptors / D-weapons
  if (has(p, 'psychic') || /smite|psychic|psycannon|psilencer|witch|warp|astropathic|mind wipe|thunderclap|d-cannon|wraithcannon|distortion|d-scythe|gaze of death|gaze of gork|cosmic insanity|time’s arrow|time's arrow|antimatter meteor|spirit vortex|baleblast|fatecaster|neuro disruptor|eldritch/.test(n)) return 'psychic';

  // 2. Sonic / Cacophony (Noise Marines, Slaanesh), Eldar vibro and Drukhari screamers
  if (/sonic|blastmaster|cacophon|dirgesinger|heartstring|scream of despair|noise|vibro cannon|screamer/.test(n)) return 'sonic';

  // 3. Frost: helfrost beams freeze, they do not burn
  if (/helfrost|cryo/.test(n)) return 'cryo';

  // 4. Volkite / Eradication rays
  if (/volkite|eradication ray|eradication caster|radium jezzail/.test(n)) return 'volkite';

  // 5. Flame / Torrent / Acid / Spewers / Vials
  if (has(p, 'torrent') || /flam|burna|skorcha|pyre|acid|drool|spewer|plaguespitter|ignis|firestorm|phosphor|incinerat|cleanser|bile spurt|chemical vials|daemonbreath spear/.test(n)) return 'flame';

  // 6. Melta / Fusion / Thermal / Dark Scythe
  if (/melta|fusion|inferno pistol|heat lance|thermal|magma|solar atomis|firepike|wailing doom|heat ray|dark scythe/.test(n)) return 'melta';

  // 7. Plasma / Bio-plasma / Eldar starcannons
  if (/plasma|mega-blasta|mega-zappa|mega-slugga|bio-plasm|bioplasm|arioch|starcannon|suncannon/.test(n)) return 'plasma';

  // 8. Grav / Transdimensional / Ork traktor beams
  if (/grav|transdimensional|transmatter|traktor|smasha gun/.test(n)) return 'grav';

  // 9. Lightning / Tesla / Arc / Haywire / EMP
  if (/zzap|tesla|lightning|arc rifle|arc pistol|arc blaster|shokk|storm of|taser|galvanic|electro|haywire|voltaic|bio-electric|\bemp\b|spear of the void dragon/.test(n)) return 'lightning';

  // 10. Las / Lance / Beam / Lenses / Drukhari dark-light blasters / solar carbines
  if (/\blas\b|\blas-|lascannon|laspistol|lasgun|lascarbine|lasblaster|lascutter|long-las|laser|hylas|arachnus|bright lance|dark lance|blast pistol|^blaster$|twin blaster|lance\b|prism|hot-shot|hellgun|hawk’s talon|hawk's talon|fury of the tempest|bale eye|lantern|sol’s righteous gaze|sol's righteous gaze|eye of wrath|volcano cannon|solar carbine|sunpistol|conversion beam/.test(n)) return 'las';

  // 11. Gauss / Necron energy beams / Enmitic / particle weapons
  if (/gauss|staff of light|staff of the destroyer|rod of covenant|death ray|scouring eye|doomsday|aeonstave|sceptre of eternal glory|staff of stars|enmitic|entropy cannon|torsion cannon|annihilator beam|particle|radium/.test(n)) return 'gauss';

  // 12. Shuriken / Eldar monomolecular blades
  if (/shuriken|bloody twins|silent death|maugetar|triskele|chainsabres/.test(n)) return 'shuriken';

  // 13. Bio / poison: Tyranid symbiotes, Drukhari splinter and shard weapons, toxin injectors
  if (/fleshborer|devourer|deathspitter|spinefist|spine banks|spinemaws|tentaclid|barblauncher|barbed strangler|spore mine|toxinjector|bio-weapon|bio-cannon|impaler cannon|harvester cannon|ichor cannon|venom cannon|stranglethorn|ossefactor|grasping tongue|living whip|lashes|lash of|scourging whip|malefic lash|dartmask|jindarii|anzuq|splinter|shardcarbine|stinger pistol|spike rifle|injector pistol|ichor/.test(n)) return 'bio';

  // 14. Sniper / Long-range precision / rail weapons
  if (/sniper|marksman|instigator|stalker|longrifle|long rifle|long gun|fusil|eliminator|exitus|railgun|rail rifle|rail cannon|magna-rail|magnarail|arquebus|needle|tachyon arrow|condemnor|shade|hexrifle|magna-coil rifle|tankstopper|synaptic disintegrator/.test(n)) return 'sniper';

  // 15. Missiles / Rockets / Launchers / Harpoons / Javelins
  if (/missile|rocket|rokkit|krak\b|tankbusta|cyclone|stormstrike|icarus (rocket|array)|hunter-killer|hunter-slayer|skyhammer|typhoon|blackstar|vengor|launcher|launcha|stinger pod|shardlauncher|warhead|apm|salvo|harpoon|javelin|tribalest|snagga klaw|grabba dragga/.test(n) && !/frag|grenade|blight|squig|tanglebomb|bolt launcher/.test(n)) return 'missile';

  // 16. Gatling / Rotary / Assault cannon / Multi-barrel / Mega-bolters
  if (/gatling|gatler|assault cannon|rotor|rotary|chaincannon|avenger|minigun|ripper gun|hurricane|punisher|onslaught|shardstorm|defensive array|anvillus|ardex-defensor|mega-bolter|mega bolter|volley gun|soulreaper|iliastus/.test(n)) return 'gatling';

  // 17. Shoota / Orky ballistic weapons
  if (/shoota|dakka|slugga|kustom|snazz|[a-z] blasta|zappa|mork’s roar|mork's roar|mek speshul|boomstikk|squigstoppa|saddlegit/.test(n) && !/rokkit|skorcha|kannon/.test(n)) return 'shoota';

  // 18. Shotgun / Scatter / Flechette
  if (/shotgun|scatter|flechette/.test(n) && !/\bion\b|laser/.test(n)) return 'shotgun';

  // 19. Pulse / Tau ion and burst cannons / Votann exotic energy
  if (/\bpulse|\bion\b|disintegrat|adrathic|conversion|beam|las-pulser|synaptic|burst cannon|neutron blaster|blaster|support turret|drone defenders/.test(n)) return 'pulse';

  // 20. Heavy Bolter / Autocannon / Heavy Stubber / heavy kinetic cannons
  if (/heavy bolt|macro|accelerator|autocannon|auto cannon|stubber|assault bolter|ironhail|executioner|bolt cannon|bolt launcher|kinetic destroyer|heavy slugger|autostub|rivet|ferrumite|icarus|eagle's scream|gnosis|fidelis|talon of horus|hand of dominion|gauntlets of ultramar|blackout|perdition|lion's wrath|the deliverer|foehammer|ferocity|gorgon's wrath|maimer/.test(n)) return 'heavyBolt';

  // 21. Shells / Mortars / Grenades / Artillery / Explosives / Heavy ordnance (after every named cannon above)
  if (/cannon|kannon|mortar|thunderfire|whirlwind|vengeance|bombard|lobba|artillery|orbital|grenade|grenadier|frag|demolisher|bomb|rift|earthshaker|blight|demolition|explosive|breacher ordnance|tremor|bubblechukka|seismic|skullhurler|death’s heads|death's heads|plague flail|bloodflail|doomweaver|shadow weaver|star bolas|stikka|squig launcha|thump gun|phlegm/.test(n)) return 'shell';

  if (!catchAll) return null;
  // 22. Standard Bolt / Pistol / Rifle
  if (/bolt|pistol|rifle|carbine|gun|spear|axe|blade|firearm|combi|small arms/.test(n)) return 'bolt';

  return null;
}
