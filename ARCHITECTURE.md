# Architecture

A Warhammer 40,000 (11th edition) battle simulator that runs entirely in the browser: army builder, a rules engine
that plays the five phases, a bot opponent, and a roguelite campaign. React 19 + TypeScript + Vite, tested with Vitest.

## Layers

```
data/ (rule data, JSON)            public/data/factions/*.json (datasheets, generated)
        \                                  /
         +--> src/engine/  (pure TypeScript, no DOM) <-- src/ui/ (React)
                  |   game state in, game state out          |
                  +--> bot*.ts (the bot uses the same API) --+
```

- **`src/engine/`** knows nothing about React. Every rule is a function of `GameState` (see `types.ts`). The UI and
  the bot call the same functions, so anything the player can do the bot can do, and every game can be replayed
  from its seed.
- **`src/ui/`** renders a `GameState` and turns taps into engine calls. Game state lives in `store.ts` (`useGame`):
  each action clones the state, applies one engine call and keeps an undo snapshot.
- **`data/`** holds the rules as data. Most rules are added or fixed here without touching code.

## The game loop

`game.ts` owns the flow: `createGame` -> deployment -> battle rounds -> `startTurn` -> Command, Movement, Shooting,
Charge, Fight (`endPhase` moves from one to the next) -> end of turn -> end of round -> game over.

Faction rules that keep state of their own (Knights' Code Chivalric, Drukhari Pain tokens, Daemons' Shadow of
Chaos ...) do not live in `game.ts`. The loop emits **lifecycle events** and each faction subscribes:

| Event | Emitted | Payload |
|---|---|---|
| `setup` | end of `createGame`, before deployment | - |
| `battleStart` | first turn, before its Command phase | - |
| `turnBegin` | a turn begins, before anything else | `p` |
| `roundStart` | the first player's turn starts a new round | - |
| `turnStart` | after the round start, before the Command phase | `p` |
| `commandStart` / `commandEnd` | Command phase | `p` |
| `movementEnd` | end of Movement, after Reinforcements | `p` |
| `shootingStart` | start of the Shooting phase | `p` |
| `phaseEnd` | any phase ends | `phase` |
| `turnEnd` / `roundEnd` | end of a turn / battle round | `p` / - |
| `shockResult` | any Battle-shock test is resolved | `u`, `passed` |
| `moved` | a Normal, Advance or Fall Back move ends | `u`, `kind`, `paths` |
| `unitMoved` | a unit moved or arrived (enemy reactions) | `u` |

Values several rules can change are **modifiers**, summed or combined in `events.ts`: `battleShock` (added to a
Battle-shock test) and `deepStrikeDistance` (the closest a Deep Striking unit may arrive).

`events.ts` defines the events, `factionHooks.ts` is the one place factions subscribe. Handlers run in the order
they are registered there; the dice come from one seeded generator, so that order is part of the game's
behaviour and must not change by accident.

## The rules pipeline

Most rules are not code but data, read by three engines:

1. **Effects** (`effects.ts`): passive rules. An `Effect` changes attacks (`hit`, `wound`, `ap`, `reroll`, weapon
   `abilities` ...), defence (`defend`: `inv`, `fnp`, `hit`, `damage` ...) or the unit (`move`, `oc`, `stealth`,
   `eligible` ...). `scope` says who gets it (`unit`, `model`, `led`, `aura` with `range`, `enemyAura`, `army`).
   `if` lists conditions, all evaluated by `cond()`. `effectsFor(s, u)` collects everything in force on a unit
   from its abilities, enhancements, detachment rules, army rules and timed buffs.
2. **Activations** (`activations.ts`): rules used at a moment. An `act` has `when` (a trigger such as
   `commandStart`, `selectedToShoot`, `enemyMovedNear`), `limit` (once per phase / turn / round / battle), a
   `target` filter and `do` (actions: `move`, `mortals`, `heal`, `buff` with `until`, `mark` ...). With `auto: true`
   it fires by itself; otherwise the player gets a button and the bot decides with `botUse` / `botIf`.
3. **Stratagems** (`stratagems.ts`): a hand-written entry in `data/stratagems/<FACTION>.json` wins; otherwise the
   card text (WHEN / TARGET / EFFECT) is read into the same `effects` / `do` form. `canUseStratagem` and
   `spendStratagem` (`state.ts`) check the timing and target and take the CP for every stratagem.

Timed effects (`addTimed`) carry an `until` (`phase`, `turn`, `nextCommand` ...) and are removed by `expireTimed`
at that point, so nothing a rule grants outlives it.

Where the data cannot express a rule, the faction has a module (`knights.ts`, `drukhari.ts`, `rituals.ts` ...)
hooked in through `factionHooks.ts`, and `cond()` / the effect collectors ask the module.

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
scored in `botMove.ts` with weights from `data/bot-weights.json` (tuned by `scripts/tune.mjs`); `botPlan.ts` gives
the army a plan per phase, `botLook.ts` tries a few lines of play ahead, `botStrats.ts` spends CP, `botPlus.ts`
handles choices (doctrines, abilities with a decision). In the browser the bot thinks in a Web Worker
(`ui/lookWorker.ts`) so the screen stays live.

## UI

`App.tsx` routes between Home (army library), the army builder, battle setup, the campaign map and
`GameScreen.tsx` (the battle). `Board.tsx` draws the battlefield in SVG. Saved data is in `localStorage`:
`w40k11-armies` (army lists), `w40k11-save` (the battle in progress), `w40k11-battle` (last setup),
`w40k11-portraits` (custom photos).

## Tests

`npm test` runs everything (about 30 minutes: many tests play whole bot-vs-bot games). Per-faction rules have
their own test files (`knights.test.ts`, `drukhari.test.ts` ...). CI (`.github/workflows/ci.yml`) builds and runs
the full suite on every push to `main` and every pull request.
