# Architecture

A Warhammer 40,000 (11th edition) battle simulator that runs entirely in the browser: army builder, a rules engine
that plays the five phases, a bot opponent, and a roguelite campaign. React 19 + TypeScript + Vite, tested with Vitest.

## Layers

```
src/ui/            React screens: army builder, battle, campaign map
src/ai/            the bot: movement, targets, stratagems, lookahead (runs in a Web Worker in the browser)
src/factions/      army rules that keep state of their own; index.ts registers them with the engine
src/rules-engine/  rules as data: effects, activations, stratagems, detachment rules, the ability text reader
src/engine/        game state, the turn loop, dice, attacks, line of sight, terrain, missions, events
src/services/      what the app keeps on the device (storage.ts); the place a cloud sync hooks in
data/              the rules as JSON; public/data/factions/*.json holds the datasheets
```

Dependencies go one way: `ui -> ai -> factions -> rules-engine -> engine`. The engine and the rules engine never
import a faction module or bot code (`src/engine/layers.test.ts` checks it); `game.ts` loads `src/factions/index.ts`,
which registers every faction with the hooks below.

- **`src/engine/`** and **`src/rules-engine/`** know nothing about React. Every rule is a function of `GameState`
  (see `src/engine/types.ts`). The UI and the bot call the same functions, so anything the player can do the bot can
  do, and every game can be replayed from its seed.
- **`src/ui/`** renders a `GameState` and turns taps into engine calls. Game state lives in `store.ts` (`useGame`):
  each action clones the state, applies one engine call and keeps an undo snapshot. Live games also record each
  committed state for replay; undo removes the matching replay frame. Replay steps sync into the mounted screen.
- **`data/`** holds the rules as data. Most rules are added or fixed here without touching code.

## The game loop

`game.ts` owns the flow: `createGame` -> deployment -> battle rounds -> `startTurn` -> Command, Movement, Shooting,
Charge, Fight (`endPhase` moves from one to the next) -> end of turn -> end of round -> game over.

Faction rules (Knights' Code Chivalric, Drukhari Pain tokens, Daemons' Shadow of Chaos ...) do not live in the core.
The engine and rules engine import no faction module. They emit events and ask the hooks in `src/engine/events.ts`
and `src/engine/combatMods.ts`; each faction module registers in `src/factions/index.ts`.

### Events (`on(name, handler)`)

| Event | Emitted | Payload |
|---|---|---|
| `setup` | end of `createGame`, before deployment | - |
| `battleSetup` | after battle formations, before the first turn | - |
| `reservesChanged` | after a player moves units to Reserves | `p` |
| `battleStart` | first turn, before its Command phase | - |
| `turnBegin` | a turn begins, before anything else | `p` |
| `roundStart` | the first player's turn starts a new round | - |
| `turnStart` | after the round start, before the Command phase | `p` |
| `commandStart` / `commandEnd` | Command phase | `p` |
| `movementEnd` | end of Movement, after Reinforcements | `p` |
| `shootingStart` | start of the Shooting phase | `p` |
| `fightStart` | start of the Fight phase, before pile-in | - |
| `phaseEnd` | any phase ends | `phase` |
| `turnEnd` / `roundEnd` | end of a turn / battle round | `p` / - |
| `shockResult` | any Battle-shock test is resolved | `u`, `passed` |
| `moved` | a Normal, Advance or Fall Back move ends | `u`, `kind`, `paths` |
| `unitMoved` | a unit moved or arrived (enemy reactions) | `u` |
| `unitSelected` | a unit is selected to shoot or fight | `u`, `kind` |
| `targetChosen` | a unit picked a target to shoot, fight or charge | `attackerId`, `targetId` |
| `attackDone` | a unit finished attacking a target | `A`, `T` |
| `unitDestroyed` | the last model of a unit was destroyed by an attack | `u`, `attackerId` |
| `modelKilled` | a model was destroyed, after the core's own reactions | `u`, `m`, `killerId` |
| `deadlyDemiseHit` | a Deadly Demise explosion hit a unit | `u`, `v` |

### Modifiers (`addModifier(name, fn)`)

Questions several rules can answer; `events.ts` combines the answers.

| Modifier | Answer | Combined |
|---|---|---|
| `battleShock` | added to a Battle-shock test | sum |
| `shockDice` | dice rolled for Battle-shock / Leadership | highest (2 by default) |
| `deepStrikeDistance` | closest a Deep Striking unit may arrive | smallest |
| `deepStrikeKeep` | closest it may arrive to one enemy unit | smallest |
| `deepStrikeZone` | may it arrive here (units bound to a zone) | all must agree |
| `moveBlock` | why a model's move is not allowed | first reason |
| `targetBlock` | why a unit may not shoot / charge / fight a target | first reason |
| `auraRange` | extra inches on aura abilities | sum |
| `eligible` | may it do something it normally cannot (charge after Advancing ...) | any |
| `assaultWeapons` | its ranged weapons count as [ASSAULT] | any |
| `moveThroughModels` / `moveThroughTerrain` | what its moves pass through | first / any |
| `meleeStrength` | melee Strength bonus with its note | all |

### Other extension points

| Hook | Where it is used | Example |
|---|---|---|
| `addCombatMods` (`combatMods.ts`) | every weapon profile of an attack: hit, wound, AP, Strength, re-rolls, weapon abilities, critical thresholds | Doctrina Imperatives, Power from Pain |
| `addDieRescue` | a failed roll can be replaced by a die from a pool | Acts of Faith, Strands of Fate |
| `addCondition` | an `if` condition in the rule data | `inSynapse`, `quality:...` |
| `addEffectSource` | effects a module keeps for a unit outside its abilities | Blessings of Khorne, Plagues |
| `addActionHandler` | faction keys in an ability's `do` actions | Bondsman, Signal Pox |
| `addStratSpecial` | a stratagem's `special` | Malefic Surge |
| `addTargetFilter` | a stratagem target filter | `contagion` |
| `addChoiceHooks` | detachment / army rule choices (why an option is blocked, what picking it does) | Code Chivalric, Nurgle's Gift |

Handlers and providers run in the order they are registered in `src/factions/index.ts`. The dice come from one seeded
generator, so that order is part of the game's behaviour and must not change by accident. Register functions
through an arrow (`(s, u) => fn(s, u)`), not by value: modules can load in either order.

## The rules pipeline

Most rules are not code but data, read by three engines:

1. **Effects** (`effects.ts`): passive rules. An `Effect` changes attacks (`hit`, `wound`, `ap`, `reroll`, weapon
   `abilities` ...), defence (`defend`: `inv`, `fnp`, `hit`, `damage` ...) or the unit (`move`, `oc`, `stealth`,
   `eligible` ...). `scope` says who gets it (`unit`, `model`, `led`, `aura` with `range`, `enemyAura`, `army`).
   `if` lists conditions, all evaluated by `cond()`. `effectsFor(s, u)` collects everything in force on a unit
   from its abilities, enhancements, detachment rules, army rules and timed buffs.
2. **Activations** (`activations.ts`): rules used at a moment. An `act` has `when` (a trigger such as
   `commandStart`, `selectedToShoot`, `enemyMovedNear`, `opponentMovementEnd`), `limit` (once per phase / turn /
   round / battle), a `target` filter and `do` (actions: `move`, `mortals`, `heal`, `buff` with `until`, `mark` ...).
   With `auto: true` it fires by itself; otherwise the player gets a button and the bot decides with `botUse` / `botIf`.
   Phase-end triggers must be offered by the matching turn-loop path in `game.ts`; `opponentMovementEnd` opens its
   reaction before the active player enters Shooting.
3. **Stratagems** (`stratagems.ts`): a hand-written entry in `data/stratagems/<FACTION>.json` wins; otherwise the
   card text (WHEN / TARGET / EFFECT) is read into the same `effects` / `do` form. `canUseStratagem` and
   `spendStratagem` (`state.ts`) check the timing and target and take the CP for every stratagem.

Timed effects (`addTimed`) carry an `until` (`phase`, `turn`, `nextCommand` ...) and are removed by `expireTimed`
at that point, so nothing a rule grants outlives it.

Where the data cannot express a rule, the faction has a module (`knights.ts`, `drukhari.ts`, `rituals.ts` ...)
hooked in through `src/factions/index.ts`, and `cond()` / the effect collectors ask the module.

`rulesData.test.ts` checks the data against the engine: an unknown condition, trigger or misused key fails the
build, because the engine would otherwise skip that rule silently. `docs/RULES_STATUS.md` lists per faction which
rules run and which are still text only.

## Data

| What | Where |
|---|---|
| Datasheets, detachments, enhancements, stratagem cards | `public/data/factions/<ID>.json`, generated by `npm run data` from Wahapedia CSVs (or `data/packs/` for codex packs) |
| Corrections to generated datasheets | `data/overrides/<ID>.json` (merged on every import) |
| Unit abilities and enhancements | `data/abilities/<ID>.json` |
| Detachment rules and army rules | `data/detachment-rules.json` |
| Stratagems | `data/stratagems/<ID>.json` |
| Core rules, core stratagems | `data/core-rules.json` |
| Missions, terrain layouts | `data/missions.json`, `data/layouts.json` |
| Unit photos | `public/images/units/<ID>/`, indexed by `npm run images` |

## The bot

`bot.ts` is the entry (`botAct` plays one step, `botStep` one step for one side). Movement and positions are
scored in `botMove.ts` with weights from `data/bot-weights.json` (tuned by `scripts/tune.mjs`); on a big board (more
than 150 models brought) it plans with a quicker search so a 2000-point game does not freeze. `botPlan.ts` gives
every unit a role for the turn (home, anchor on an objective, hammer that hunts, screen, firebase, support, taxi);
in a battle won on points (the campaign, idle mode) each objective gets a holder before units go hunting
(`pointsFirst`). `botLook.ts` plays a few copies of the turn in different styles and keeps the best (the campaign
always plays the objective-first `rogue` style). `botStrats.ts` spends CP, `botPlus.ts` handles choices (doctrines,
abilities with a decision). In the browser the bot thinks in a Web Worker (`ui/lookWorker.ts`) so the screen stays
live; a step the worker has not answered in 90 s is played on the main thread. Idle mode hands the player's side to
the same code. The live bot is measured against a frozen copy in `src/ai/baseline/` (`arena.test.ts`,
`scripts/elo.mjs`).

## The campaign

`campaign.ts` holds a run: the map (`makeMap`), each battle (`campaignMission`: an official primary, Tactical
secondaries, five rounds, random Force Dispositions), rewards (`makeOffer`, `takeReward`), recruiting, relics
(`RELICS`, text written by `relicText`) and what is put on the armies before a battle (`applyCampaign`). The army tree
is `campaignTree.ts` (shared spokes, ring, keystones; `treeFor(army)` swaps nodes an army cannot use) with each
army's own branches in `campaignTreeArmies.ts` and the keywords each army can field in `treeFielded.ts` (written by its
test). The tree only changes numbers and re-rolls; relics only give special rules; tests keep the two apart. Old saves
go through `migrateRun`. Design: `docs/04-campaign-tree.md`.

## Battle effects

`ui/BattleFx.tsx` draws every effect in SVG over the board (`FxLayer`, about 30 frames a second): one look per weapon
kind (`engine/weaponFx.ts` picks it from the weapon), melee blows, Deep Strike, Deadly Demise, Rituals, and a style
per kind of ability (`skillStyle` in `engine/state.ts`: holy, command, psychic, chaos, fury, waaagh, tech, shield,
plague, necron), each with a wind-up, a release and an aftermath. Sizes follow the board zoom through one factor
(`VIS`). Principles and the parts to build from: the `vfx` skill.

## UI

`App.tsx` routes between Home (army library), the army builder, battle setup, the campaign map and
`GameScreen.tsx` (the battle). `Board.tsx` draws the battlefield in SVG. Saved data is in `localStorage`
(`KEYS` in `services/storage.ts`): `w40k11-armies` (army lists), `w40k11-save` (the battle in progress),
`w40k11-battle` (last setup), `w40k11-portraits` (custom photos), `campaign-run` (the campaign), and settings.

## Working on this project

`CLAUDE.md` and the skills in `.claude/skills/` (start with `start-here`) give the workflow every change follows:
inventory what exists, decide to extend, replace or add, build the smallest complete change, verify with real
checks, update the docs, and write what the task taught into the area's skill (its "Pitfalls seen before"), so
the skills improve with every session.

Known bugs and technical debt, by priority, are in `docs/05-tech-debt.md`.

## Tests

`npm test` runs everything (about 20 to 30 minutes: many tests play whole bot-vs-bot games). Per-faction rules have
their own test files (`knights.test.ts`, `drukhari.test.ts` ...). CI (`.github/workflows/ci.yml`) builds and runs
the full suite on every push to `main` and every pull request.
