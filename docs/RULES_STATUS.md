# Rules status

Which rules the game actually runs, faction by faction. Generated from an audit of the rule data against the engine code; re-run it after changing `data/`.

## How a rule is graded

- **Works**: the rule has executable data (effects, triggers, choices) and every condition, trigger and key in it is one the engine reads, or the rule is implemented in a faction module.
- **Partial**: the main effect runs; the rest is left to the player (shown on the rule card).
- **Text only**: the rule is shown with its text but nothing in the engine does it. The player has to resolve it by hand, and the bot never uses it.
- **Bug**: there is data for it, but it uses a key or trigger the engine does not have, so it silently does nothing.

"Works" means the rule runs. It does not prove every number matches the card; see "Accuracy" below.

## Summary

Each cell: works / partial / text only / bug.

| Faction | Army rules | Detachment rules | Enhancements | Stratagems | Unit abilities |
|---|---|---|---|---|---|
| Adepta Sororitas (AS) | 1 / 0 / 0 / 0 | 8 / 0 / 0 / 0 | 21 / 2 / 2 / 0 | 29 / 5 / 2 / 0 | 79 / 3 / 1 / 0 |
| Adeptus Custodes (AC) | 3 / 0 / 2 / 0 | 13 / 0 / 0 / 0 | 28 / 0 / 1 / 0 | 41 / 0 / 0 / 0 | 42 / 0 / 5 / 0 |
| Adeptus Mechanicus (AdM) | 1 / 0 / 0 / 0 | 9 / 1 / 0 / 0 | 31 / 0 / 3 / 0 | 49 / 0 / 1 / 0 | 75 / 0 / 3 / 0 |
| Adeptus Titanicus (TL) | 2 / 0 / 3 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 4 / 0 / 4 / 0 |
| Aeldari (AE) | 4 / 0 / 0 / 0 | 15 / 0 / 0 / 0 | 52 / 0 / 0 / 0 | 78 / 0 / 0 / 0 | 152 / 0 / 1 / 0 |
| Astra Militarum (AM) | 1 / 0 / 0 / 0 | 9 / 2 / 0 / 0 | 37 / 0 / 1 / 0 | 49 / 4 / 4 / 0 | 146 / 0 / 18 / 0 |
| Chaos Daemons (CD) | 3 / 0 / 0 / 0 | 8 / 1 / 0 / 0 | 27 / 0 / 2 / 0 | 43 / 0 / 3 / 0 | 131 / 0 / 5 / 0 |
| Chaos Knights (QT) | 3 / 0 / 0 / 0 | 8 / 0 / 0 / 0 | 27 / 0 / 1 / 0 | 39 / 0 / 0 / 0 | 45 / 0 / 0 / 0 |
| Chaos Space Marines (CSM) | 1 / 0 / 1 / 0 | 17 / 0 / 0 / 0 | 61 / 0 / 1 / 0 | 92 / 0 / 1 / 0 | 118 / 0 / 1 / 0 |
| Death Guard (DG) | 2 / 0 / 0 / 0 | 9 / 0 / 0 / 0 | 30 / 0 / 0 / 0 | 45 / 0 / 0 / 0 | 70 / 0 / 0 / 0 |
| Drukhari (DRU) | 4 / 0 / 0 / 0 | 9 / 0 / 0 / 0 | 30 / 0 / 0 / 0 | 45 / 0 / 0 / 0 | 102 / 0 / 0 / 0 |
| Emperor’s Children (EC) | 1 / 0 / 1 / 0 | 10 / 0 / 0 / 0 | 34 / 0 / 0 / 0 | 51 / 0 / 0 / 0 | 46 / 0 / 0 / 0 |
| Genestealer Cults (GC) | 3 / 0 / 0 / 0 | 8 / 1 / 0 / 0 | 29 / 0 / 1 / 0 | 43 / 0 / 2 / 0 | 164 / 0 / 14 / 0 |
| Grey Knights (GK) | 1 / 0 / 0 / 0 | 9 / 0 / 0 / 0 | 28 / 1 / 1 / 0 | 40 / 3 / 2 / 0 | 44 / 0 / 0 / 0 |
| Imperial Agents (AoI) | 2 / 0 / 0 / 0 | 5 / 0 / 0 / 0 | 20 / 0 / 0 / 0 | 29 / 0 / 1 / 0 | 88 / 0 / 0 / 0 |
| Imperial Knights (QI) | 4 / 0 / 0 / 0 | 8 / 0 / 0 / 0 | 26 / 0 / 0 / 0 | 39 / 0 / 0 / 0 | 55 / 0 / 0 / 0 |
| Leagues of Votann (LoV) | 1 / 0 / 0 / 0 | 10 / 0 / 0 / 0 | 28 / 0 / 6 / 0 | 48 / 0 / 3 / 0 | 55 / 0 / 0 / 0 |
| Necrons (NEC) | 1 / 0 / 0 / 0 | 11 / 1 / 0 / 0 | 38 / 0 / 4 / 0 | 54 / 1 / 8 / 0 | 105 / 0 / 6 / 0 |
| Orks (ORK) | 2 / 0 / 2 / 0 | 15 / 0 / 0 / 0 | 34 / 0 / 4 / 0 | 40 / 0 / 0 / 0 | 106 / 0 / 3 / 0 |
| Space Marines (SM) | 2 / 0 / 3 / 0 | 35 / 0 / 0 / 0 | 92 / 0 / 1 / 0 | 140 / 0 / 1 / 0 | 310 / 0 / 20 / 0 |
| Thousand Sons (TS) | 1 / 0 / 1 / 0 | 9 / 0 / 0 / 0 | 30 / 0 / 0 / 0 | 45 / 0 / 0 / 0 | 58 / 0 / 4 / 0 |
| Tyranids (TYR) | 2 / 0 / 0 / 0 | 9 / 0 / 1 / 0 | 29 / 2 / 3 / 0 | 41 / 3 / 7 / 0 | 68 / 7 / 6 / 0 |
| T’au Empire (TAU) | 1 / 0 / 0 / 0 | 7 / 0 / 0 / 0 | 20 / 2 / 1 / 0 | 23 / 2 / 3 / 0 | 89 / 4 / 2 / 0 |
| World Eaters (WE) | 1 / 0 / 1 / 0 | 8 / 0 / 0 / 0 | 25 / 0 / 1 / 0 | 39 / 0 / 0 / 0 | 59 / 0 / 0 / 0 |
| **All** | 47 / 0 / 14 / 0 | 249 / 6 / 1 / 0 | 777 / 7 / 33 / 0 | 1142 / 18 / 38 / 0 | 2211 / 14 / 93 / 0 |

## Known bugs (engine work needed)

No rule uses a key, condition or trigger the engine does not read.

Still open in the engine:

| Faction | Rule | Problem |
|---|---|---|
| AE / DRU | Agile Manoeuvres (Battle Focus) | tokens are counted and shown; nothing lets you spend them |
| all | multi-target stratagems (`extraTargets`) | the player can pick extra units; the bot never uses these stratagems |

## Bot use of stratagems in real games

Measured before the stratagem books of AM, GK, TAU, AS, TYR, GC, NEC, CD, AdM and LoV were rewritten; those rows are out of date. Two bot-vs-bot games per faction with its quick-play list. Only the list's own detachment can be used, so this samples one detachment per faction.

| Faction | Detachment | Detachment stratagems used / available | Game stuck |
|---|---|---|---|
| AC | Guardians of the Throne | 3 / 6 (IN AURAMITE CLAD, SHIELD OF HONOUR, SUPERHUMAN FOCUS) | 0 of 2 |
| AE | Warhost | 3 / 6 (BLITZING FIREPOWER, FEIGNED RETREAT, LIGHTNING-FAST REACTIONS) | 0 of 2 |
| AM | Combined Arms | 1 / 6 (FIELDS OF FIRE) | 0 of 2 |
| AS | Hallowed Martyrs | 0 / 6 (none) | 0 of 2 |
| AdM | Rad-Zone Corps | 1 / 6 (LETHAL DOSAGE) | 0 of 2 |
| AoI | Ordo Malleus Daemon Hunters | 0 / 6 (none) | 0 of 2 |
| CD | Daemonic Incursion | 0 / 6 (none) | 0 of 2 |
| CSM | Veterans of the Long War | 1 / 6 (CONTEMPTUOUS DISREGARD) | 0 of 2 |
| DG | Virulent Vectorium | 2 / 6 (CREEPING BLIGHT, PUTRID DETONATION) | 0 of 2 |
| DRU | Skysplinter Assault | 2 / 6 (NIGHT SHIELD, SKYBORNE ANNIHILATION) | 0 of 2 |
| EC | Mercurial Host | 4 / 6 (CAPRICIOUS REACTIONS, DARK VIGOUR, HONOUR THE PRINCE, VIOLENT EXCESS) | 0 of 2 |
| GC | Host of Ascension | 1 / 6 (COORDINATED TRAP) | 0 of 2 |
| GK | Warpbane Task Force | 0 / 6 (none) | 0 of 2 |
| LoV | Hearthband | 2 / 6 (BRËKKEKNOTS, FURY OF THE HEARTH) | 0 of 2 |
| NEC | Awakened Dynasty | 0 / 6 (none) | 0 of 2 |
| ORK | War Horde | 3 / 6 (CLOSE-RANGE DAKKA, HIT 'EM HARDER, ORKS IS NEVER BEATEN) | 0 of 2 |
| QI | Spearhead-At-Arms | 1 / 6 (EXEMPLAR’S WISDOM) | 0 of 2 |
| QT | Traitoris Lance | 1 / 6 (DISDAIN FOR THE WEAK) | 0 of 2 |
| SM | Gladius Task Force | 4 / 6 (ADAPTIVE STRATEGY, ARMOUR OF CONTEMPT, RESPONSIVE TACTICS, STORM OF DEVASTATION) | 0 of 2 |
| TAU | Mont’ka | 1 / 6 (AGGRESSIVE MOBILITY) | 0 of 2 |
| TS | Hexwarp Thrallband | 1 / 6 (WARDING HEX) | 0 of 2 |
| TYR | Invasion Fleet | 1 / 6 (RAPID REGENERATION) | 0 of 2 |
| WE | Berzerker Warband | 2 / 6 (BERZERKER’S WRATH, SKULLS FOR THE SKULL THRONE!) | 0 of 2 |

## Accuracy

Every faction's abilities, enhancements, detachment rules and stratagem books are now written by hand from the card text. Where the engine can only do part of a rule, the entry is marked partial and its note says what is left to the player (or what differs from the card). Faction modules (`src/factions`) work out the army rules and the rules that need state the data cannot express (Miracle dice, For the Greater Good, Gate of Infinity, Synapse, Orders, Reanimation Protocols, Shadow of Chaos, Acquisition, Yield Points and the like).

## Text-only and partial rules by faction

<details><summary>Adepta Sororitas (AS): 15</summary>

**Enhancements** (4): Divine Aspect — partial; Hagiomnifex — partial; Psalm of Righteous Judgement; Verse of Holy Piety

**Stratagems** (7): DIVINE GUIDANCE — partial; DIVINE INTERVENTION — partial; FAITH AND FURY — partial; INSPIRATIONAL BATTLE CANTICLES; RIGHTEOUS BLOWS — partial; RITES OF FIRE — partial; SANCTIFIED IMMOLATION

**Unit abilities** (4): Denuncia Oratory (Celestian Insidiants); Holy Judgement (Daemonifuge) — partial; Rapturous Blows (Palatine) — partial; Recount the Deeds of the Saints (Aestred Thurga And Agathae Dolan) — partial

</details>

<details><summary>Adeptus Custodes (AC): 8</summary>

**Army rules** (2): Aquila Commander; Special Move Types

**Enhancements** (1): Emperor's Light

**Unit abilities** (5): Supreme Commander (Trajann Valoris); Vexilla (Allarus Custodians); Vexilla (Custodian Guard); Vexilla (Custodian Wardens); Vexilla (Sentinel Guard Sodality)

</details>

<details><summary>Adeptus Mechanicus (AdM): 8</summary>

**Detachment rules** (1): Haloscreed Battle Clade — partial

**Enhancements** (3): Artisan; Emotionless Clarity; Radial Suffusion

**Stratagems** (1): INFOSLAVE SKULL

**Unit abilities** (3): Canticles of the Omnissiah (Belisarius Cawl); Repulsor Grid (Kastelan Robots); Rod of the War Forge (Thulia Ghuld)

</details>

<details><summary>Adeptus Titanicus (TL): 7</summary>

**Army rules** (3): Designer’s Note; Titanicus Traitoris; Towering Example

**Unit abilities** (4): Flank Speed (Warhound Titan); God-machine (Reaver Titan); Titanic Fire Support (Warbringer Nemesis Titan); Wrath of the Omnissiah (Warlord Titan)

</details>

<details><summary>Aeldari (AE): 1</summary>

**Unit abilities** (1): Linked Fire (Fire Prism)

</details>

<details><summary>Astra Militarum (AM): 29</summary>

**Detachment rules** (2): Armoured Infantry — partial; Steel Hammer — partial

**Enhancements** (1): Engine Speaker

**Stratagems** (8): CALLOUS SACRIFICE; CLOSE-RANGE DETECTION — partial; COORDINATED ACTION; COURAGEOUS DIVERSION — partial; IMPOSING ARRIVAL; STALWART PROTECTOR — partial; SUMP-SMOG SCREEN — partial; VOX-RELAY

**Unit abilities** (18): Airborne Insertion (Valkyrie); Armour Obliteration (Banesword); Close-range Titan Killer (Doomhammer); Counterstrategist (Commissar Yarrick); Death Befitting An Officer (Leman Russ Commander); Deathstrike Missile (Deathstrike); Decisive Command (Commissar Yarrick); Defence Line (Aegis Defence Line); Grim Determination (Krieg Command Squad); Independent Operatives (Cadian Recon Squad); Mechanised Spearhead (Commissar Graves); Mobile Command Vehicle (Chimera); Mount Up! (Stormlord); One-man Army (Sly Marbo); Plasma Warhead (Deathstrike); Servo-scribes (Krieg Command Squad); Servo-sentry (Tempestus Aquilons); Vox-relay Beacon (Cadian Recon Squad)

</details>

<details><summary>Chaos Daemons (CD): 11</summary>

**Detachment rules** (1): Legion of Excess — partial

**Enhancements** (2): Cankerblight; Gateway Unto Damnation

**Stratagems** (3): FICKLEFIRE; IMPOSSIBLE ECLIPSE; THIEVES OF PAIN

**Unit abilities** (5): Altered Reality (Psychic) (Fluxmaster); Formless Horror (The Changeling); Reverberating Summons (Great Unclean One); Seed the Garden of Nurgle (Horticulous Slimux); Tally of Pestilence (Epidemius)

</details>

<details><summary>Chaos Knights (QT): 1</summary>

**Enhancements** (1): Malevolent Heraldry

</details>

<details><summary>Chaos Space Marines (CSM): 4</summary>

**Army rules** (1): Cult of the Dark Gods

**Enhancements** (1): Crown of Worms

**Stratagems** (1): DETONATOR

**Unit abilities** (1): Malign Cover (Noctilith Crown)

</details>

<details><summary>Emperor’s Children (EC): 1</summary>

**Army rules** (1): Pact of Excess

</details>

<details><summary>Genestealer Cults (GC): 18</summary>

**Detachment rules** (1): Brood Brother Auxilia — partial

**Enhancements** (1): Cartographic Data-leech

**Stratagems** (2): ACCEPTABLE LOSSES; PSI SURGE

**Unit abilities** (14): Armour Obliteration (Banesword); Close-range Titan Killer (Doomhammer); Death Befitting An Officer (Leman Russ Commander); Death Korps Medi-pack (Death Korps Of Krieg); Deathstrike Missile (Deathstrike); Defence Line (Aegis Defence Line); Grim Demeanour (Death Korps Of Krieg); Grim Determination (Krieg Command Squad); Mobile Command Vehicle (Chimera); Mount Up! (Stormlord); Parasitic Infection (Parasite Of Mortrex); Plasma Warhead (Deathstrike); Psychic Familiar (Magus); Servo-scribes (Krieg Command Squad)

</details>

<details><summary>Grey Knights (GK): 7</summary>

**Enhancements** (2): Radiant Champion — partial; Sigil of Exigence

**Stratagems** (5): BY THOUGHT ALONE; FIRES OF COVENANT — partial; HALLOWED BEACON — partial; HEXWROUGHT REPRISAL; WARDING CHANT — partial

</details>

<details><summary>Imperial Agents (AoI): 1</summary>

**Stratagems** (1): MASTERS OF THE VOID

</details>

<details><summary>Leagues of Votann (LoV): 9</summary>

**Enhancements** (6): Ancestral Crest; Dêlvwerke Navigator; Mantle of Elders; Multiwave System Jammer; Nomad Strategist; Signature Restoration

**Stratagems** (3): ADAPTABLE AVARICE; SECURE POSITIONS; VENGEANCE FLARE

</details>

<details><summary>Necrons (NEC): 20</summary>

**Detachment rules** (1): Pantheon of Woe — partial

**Enhancements** (4): Autodivinator; Metalodermal Tesla Weave; Reletavistic Tether; Relocational Optimiser

**Stratagems** (9): DIMENSIONAL CORRIDOR; DISHARMONISATION CASCADE; HYPERPHASIC RECALL; PHASE MELDING; PROTOCOL OF THE VENGEFUL STARS; SOLAR PULSE — partial; SYNERGISTIC EMPOWERMENT; UNTAPPED POWER; YOUR TIME IS NIGH

**Unit abilities** (6): Atomic Energy Manipulator (Illuminor Szeras); Eternity Gate (Monolith); Hyperspace Hunters (Deathmarks); Multi-threat Eliminator (Hexmark Destroyer); Surrogate Hosts (Trazyn The Infinite); Transdimensional Displacement (Transcendent C’tan)

</details>

<details><summary>Orks (ORK): 9</summary>

**Army rules** (2): Special Move Types; Unstable Energies

**Enhancements** (4): 'Eadbanger; Da Gobshot Thunderbuss; Da Krunch; Smoky Gubbinz

**Unit abilities** (3): Ramshackle Cover (Big’ed Bossbunka); Waaagh! Energy (psyker level 1) (Weirdboy); Wurrboy (psyker level 1) (Kill Rig)

</details>

<details><summary>Space Marines (SM): 25</summary>

**Army rules** (3): Hunter; Special Move Types; Transhuman Strategist

**Enhancements** (1): Imperium's Sword

**Stratagems** (1): VENGEFUL ANIMUS

**Unit abilities** (20): Blizzard Shield (Venerable Dreadnought); Blizzard Shield (Wulfen Dreadnought); Captain of the Honour Guard (Cato Sicarius); Chief Librarian (psyker level 3) (Chief Librarian Mephiston); Chief Librarian (psyker level 3) (Chief Librarian Tigurius); Chief Librarian (psyker level 3) (Ezekiel); Combat Shield (Vanguard Veteran Squad With Jump Packs); Embarking within Transports (Logan Grimnar); Force of Untamed Destruction (Murderfang); Librarian (psyker level 1) (Librarian In Phobos Armour); Librarian (psyker level 1) (Librarian In Terminator Armour); Librarian (psyker level 1) (Librarian); Relic Shield (Captain With Jump Pack); Relic Shield (Captain); Relic Shield (Chaplain In Terminator Armour); Relic Shield (Death Company Captain with Jump Pack); Rune Priest (psyker level 3) (Njal Stormcaller); Shield Dome (Black Templars Impulsor); Shield Dome (Impulsor); Supreme Commander (Roboute Guilliman)

</details>

<details><summary>Thousand Sons (TS): 5</summary>

**Army rules** (1): Pact of Sorcery

**Unit abilities** (4): Arch-Sorcerer of Tzeentch (Psychic) (Ahriman); HORRORS ARE PINK. HORRORS ARE BLUE. WHEREONCE THERE WAS ONE, NOW THERE ARE TWO. (Pink Horrors); Immaterial Flare (Aura) (Mutalith Vortex Beast); Lord of the Planet of the Sorcerers (Psychic) (Magnus The Red)

</details>

<details><summary>Tyranids (TYR): 29</summary>

**Detachment rules** (1): Talons of the Norn Queen

**Enhancements** (5): Biophagic Flow (Aura); Hunting Grounds; Parasitic Biomorphology — partial; Psychostatic Disruption — partial; Regenerating Monstrosity

**Stratagems** (10): ADAPTIVE OPTIMISATION — partial; CORROSIVE VISCERA; OVERRUN — partial; PRESERVATION IMPERATIVE; RECLAIM BIOMASS; REPLENISHING SWARMS; SURPRISE ASSAULT — partial; SYNAPTIC GOADING; THE SMOTHERING SHADOW; TUNNEL NETWORK

**Unit abilities** (13): Bio-minefield (Mucolid Spores); Bio-minefield (Spore Mines); Floating Death (Mucolid Spores) — partial; Floating Death (Spore Mines) — partial; Frenzied Metabolism (Harridan) — partial; Grasping Tendrils (Toxicrene) — partial; Harpooned (Norn Assimilator); Parasitic Infection (Parasite Of Mortrex); Psychological Saboteur (Aura) (Neurolictor) — partial; Seed Mucolids (Sporocyst); Seed Spore Mines (Biovores); Spore Mine Cysts (Harpy) — partial; Swallow Whole (The Red Terror) — partial

</details>

<details><summary>T’au Empire (TAU): 14</summary>

**Enhancements** (3): Internal Grenade Racks — partial; Strike Swiftly — partial; Student of Kauyon

**Stratagems** (5): A TEMPTING TRAP — partial; EMP GRENADES — partial; FAIL-SAFE DETONATOR; MICRODRONE SUPPORT; THE GRISLY FEAST

**Unit abilities** (6): Crack Shot (Cadre Fireblade) — partial; Grav-inhibitor Drone (Pathfinder Team); Homing Beacon (Stealth Battlesuits) — partial; Neocapacitor Shields (The Twin Lance); Rites of Feasting (Kroot Flesh Shaper) — partial; Stealth Drones (Ghostkeel Battlesuit) — partial

</details>

<details><summary>World Eaters (WE): 2</summary>

**Army rules** (1): Pact of Blood

**Enhancements** (1): Malicious Vigour

</details>
