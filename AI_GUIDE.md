# Guide for changing this project

Start with `CLAUDE.md` and the `start-here` skill (`.claude/skills/start-here/SKILL.md`): every task begins with an
inventory of what already exists, a written decision (extend, replace or new) and ends with real checks (`verify`)
and true docs (`docs-sync`), and leaves what it taught in the area's skill. Read `ARCHITECTURE.md` for how the code fits together. This file is the checklist for the
common changes; each area also has a skill in `.claude/skills/` (`rules-data`, `bot`, `campaign`, `ui`, `vfx`).

## Ground rules

- Rules are data first. Only write engine code when the data cannot express the rule.
- The engine is deterministic: all dice come from the seeded generator in `dice.ts`. Never use `Math.random()` in
  `src/engine/`. Changing the order of rolls changes every seeded game; if you do it on purpose, say so in the commit.
- After changing anything in `data/` run `npx vitest run src/engine/rulesData.test.ts`. It fails on conditions,
  triggers or keys the engine does not read.
- Keep `docs/RULES_STATUS.md` honest: a rule entry with `"status": "auto"` and no `effects` / `act` does nothing.

## Fix or add a unit ability / enhancement

1. Find the rule text in `public/data/factions/<ID>.json`.
2. Add or fix the entry in `data/abilities/<ID>.json`. Key: the ability name, or `Name@Datasheet` when two
   datasheets share a name with different rules. Enhancements use the same file and the enhancement name.
3. Passive rule: `"effects": [...]`. Rule used at a moment: `"act": { "when": ..., "do": [...] }`. Copy a similar
   entry from `data/abilities/SM.json`; the field reference is the `Effect` interface in `src/rules-engine/effects.ts`
   and `Action` in `src/rules-engine/activations.ts`.
4. Conditions go in `if` and must be ones `cond()` in `effects.ts` handles. Need a new one: add a case to `cond()`
   (keep it a pure function of the context) and use it.
5. Add a test in the faction's test file that builds a unit and checks the number the rule changes.

## Fix or add a stratagem

Entry in `data/stratagems/<ID>.json`, key = card name in capitals (or `NAME@Detachment`). Without an entry the
card text is parsed; write one when the parse is wrong or partial. `bot` (`attack` / `defend` / `never`) says
whether the generic bot logic considers it.

## Add a detachment rule or army rule

Entry in `data/detachment-rules.json`, key = detachment name (army rules: rule name plus `"armyRule": true`).
`auto` is `full` when everything is automatic, `partial` with a `manual` note for the rest.

## Add a faction

1. `npm run data -- --fetch` (or put CSVs in `data/raw/`), then fix wrong values in `data/overrides/<ID>.json`.
2. Create `data/abilities/<ID>.json` and `data/stratagems/<ID>.json`; register them in `FACTION_RULES`
   (`src/rules-engine/effects.ts`) and `BOOKS` (`src/rules-engine/stratagems.ts`).
3. Detachment rules in `data/detachment-rules.json`.
4. Army rule mechanics that keep state (tokens, marks, per-round choices): write `src/factions/<faction>.ts` with
   plain functions of `GameState`, then register them in `src/factions/index.ts`: `on(event, fn)` for
   something that happens, `addModifier` for a value several rules adjust, `addCombatMods` for attack modifiers,
   `addCondition` / `addEffectSource` for rule data. ARCHITECTURE.md lists every hook. Never import a faction module
   or bot code from `src/engine/` or `src/rules-engine/`; `src/engine/layers.test.ts` fails if you do.
5. A quick-play list in `PRESETS` (`src/ui/presets.ts`) so the faction can be picked for a fast game and is
   covered by the bot-vs-bot tests.
6. Tests: `src/factions/<faction>.test.ts`, then the whole suite.

## Add a game mode

Modes are options on `createGame` (`NewGameOptions` in `game.ts`): `maxRounds` (short battle), `primaryId`
(mission), `secondaryMode`. Campaign rules live in `campaign.ts`. A new mode adds an option there and a choice in
`src/ui/BattleSetup.tsx`; keep the default behaviour unchanged when the option is absent.

## Add unit photos

Put files in `public/images/units/<ID>/` named after the datasheet in lower case with dashes
(`Intercessor Squad` -> `intercessor-squad.webp`), then `npm run images` to rebuild the manifest. See
`public/images/README.md`.

## Change the campaign tree or relics

Read the "Tree v3" section of `docs/04-campaign-tree.md` and the `campaign` skill first. A tree node changes numbers
and re-rolls only (`TREE_KEYS` in `campaignTree.ts`); a relic gives special rules only. Run
`npx vitest run src/engine/campaign*.test.ts`; after changing which keywords nodes name, regenerate the table with
`UPDATE_FIELDED=1 npx vitest run src/engine/campaignTreeFit.test.ts`. A change to what a saved id means needs a
migration (`treeVersion`) and a test that loads the old save.

## Add or change a battle effect

Load the `vfx` skill: it lists every effect that exists, the parts to build from and the style of each ability.
Check the result on a rendered sheet at phone board scale, not only in the code.

## Change the bot

Load the `bot` skill. Measure before and after (mirror games, the arena or `scripts/elo.mjs`) and report the numbers.

## Before you push

`npx tsc --noEmit -p .`, the tests of what you touched, and for engine changes a seeded bot-vs-bot game for the
factions involved. Run the full suite (`npx vitest run`, about 20 minutes) before anything reaches `main`; CI runs it
too. Update the docs the change touches (`docs-sync`).
