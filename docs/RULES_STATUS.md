# Rules status

Which rules the game runs, faction by faction. The summary table is built by a test from the rule data
(`src/engine/rulesStatus.test.ts`), so it cannot drift from the data; the test fails until the table is rewritten
(`UPDATE_STATUS=1 npx vitest run src/engine/rulesStatus.test.ts`).

## How a rule is counted

- **Data**: the unit ability has executable data in `data/abilities` (effects, a trigger, a choice) that the engine reads.
- **Code**: the ability is done by a faction module in `src/factions` (`"code": true`). Not checked by this table.
- **Text only**: only the card text: the game shows it, the player resolves it by hand, and the bot never uses it.
- Stratagems are graded by the reader the game uses: **auto** (runs), **partial** (the main effect runs, the rest is
  left to the player), **manual** (resolve it as written).

That a rule runs does not prove its numbers match the card: see "Accuracy" below.

## Summary

<!-- status:start -->
| Faction | Unit abilities: data / code / text only | Stratagems: auto / partial / manual |
|---|---|---|
| Adepta Sororitas (AS) | 72 / 21 / 3 | 36 / 0 / 0 |
| Adeptus Custodes (AC) | 65 / 3 / 0 | 41 / 0 / 0 |
| Adeptus Mechanicus (AdM) | 90 / 3 / 5 | 50 / 0 / 0 |
| Adeptus Titanicus (TL) | 5 / 2 / 0 | 0 / 0 / 0 |
| Aeldari (AE) | 156 / 20 / 6 | 78 / 0 / 0 |
| Astra Militarum (AM) | 119 / 29 / 9 | 57 / 0 / 0 |
| Chaos Daemons (CD) | 122 / 14 / 7 | 46 / 0 / 0 |
| Chaos Knights (QT) | 69 / 4 / 1 | 39 / 0 / 0 |
| Chaos Space Marines (CSM) | 163 / 12 / 3 | 93 / 0 / 0 |
| Death Guard (DG) | 86 / 10 / 3 | 45 / 0 / 0 |
| Drukhari (DRU) | 112 / 23 / 4 | 45 / 0 / 0 |
| Emperor’s Children (EC) | 75 / 4 / 0 | 51 / 0 / 0 |
| Genestealer Cults (GC) | 194 / 80 / 16 | 45 / 0 / 0 |
| Grey Knights (GK) | 63 / 20 / 0 | 45 / 0 / 0 |
| Imperial Agents (AoI) | 84 / 7 / 4 | 30 / 0 / 0 |
| Imperial Knights (QI) | 73 / 2 / 1 | 39 / 0 / 0 |
| Leagues of Votann (LoV) | 73 / 11 / 0 | 51 / 0 / 0 |
| Necrons (NEC) | 124 / 14 / 8 | 63 / 0 / 0 |
| Orks (ORK) | 127 / 13 / 0 | 40 / 0 / 0 |
| Space Marines (SM) | 397 / 35 / 11 | 141 / 0 / 0 |
| T’au Empire (TAU) | 85 / 17 / 8 | 28 / 0 / 0 |
| Thousand Sons (TS) | 74 / 22 / 1 | 45 / 0 / 0 |
| Tyranids (TYR) | 95 / 20 / 2 | 51 / 0 / 0 |
| Unbound Adversaries (UA) | 0 / 0 / 0 | 0 / 0 / 0 |
| World Eaters (WE) | 70 / 14 / 0 | 39 / 0 / 0 |
| **All** | 2593 / 400 / 92 | 1198 / 0 / 0 |
<!-- status:end -->

## Known bugs (engine work needed)

| Faction | Rule | Problem |
|---|---|---|
## Bot use of stratagems in real games

Two bot-vs-bot games per faction with its quick-play list. Only the list's own detachment can be used, so this samples one detachment per faction.

| Faction | Detachment | Detachment stratagems used / available | Game stuck |
|---|---|---|---|
| AC | Guardians of the Throne | 3 / 6 (IN AURAMITE CLAD, SHIELD OF HONOUR, SUPERHUMAN FOCUS) | 0 of 2 |
| AE | Warhost | 2 / 6 (BLITZING FIREPOWER, LIGHTNING-FAST REACTIONS) | 0 of 2 |
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

Hand-written factions (SM, ORK, CSM, WE, EC, TS, DG, AC, QI, QT, AoI) were checked rule by rule when they were added. The other factions were filled in by generator scripts (since deleted), and many of their entries only carry the card text; those count as "text only" in the summary.

## Owner-approved rule variations

- Thousand Sons: a failed Ritual remains available to another eligible caster that still has an attempt.
- Thousand Sons: the Rituals panel can be reopened from the Shooting phase after units have shot (owner request).
- Defensive stratagems worded "just after an enemy unit has selected its targets" (e.g. Wrath of the Doomed) are
  offered to a player in a window while the attack waits, before any dice; the bot uses them through its own logic.
- Tzaangor Enlightened with Fatecaster Greatbows: Malign Trickery is offered once at the end of the opponent's
  Movement phase when an enemy is within 12" and the unit is not engaged.

## Text-only and partial rules by faction
