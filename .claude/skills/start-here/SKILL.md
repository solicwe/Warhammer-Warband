---
name: start-here
description: The workflow for every task in Warhammer Warband. Load first for any request (a feature, a fix, a tweak, a question about the code), before reading or writing code. It says what to check before building, how to decide between extending, replacing or adding, and what "done" means.
---

# Start here

This project has grown fast, mostly by AI sessions. The main risk is not bad code but **duplicate code**: a second
scale factor next to the first, a relic that does what a tree node does, a new helper that already existed under
another name. Every task therefore starts with an inventory, and nothing is built until it is clear what exists.

## 1. Understand the ask

- Restate the request in one line. The owner writes short Thai messages, often several asks at once: split them into
  a numbered list and keep it to the end; every item gets done or is named as skipped.
- If a word can mean two things (a "skill" can be a hero ability or a Claude skill; "idle" is the auto-play mode),
  pick the meaning that fits the recent conversation and say which one you took.
- Ask only when the answer changes what you build and nothing in the repo or the conversation decides it.
- When the owner sends a screenshot, look at the image itself and describe what is literally in it before guessing a
  cause; a summary of the picture loses the detail that matters.

## 2. Inventory before building (never skip)

Find everything that already touches the ask. Do all of these, not just the first that hits:

1. **Search the code** for the nouns of the ask and their synonyms:
   `grep -rn -i "<word>" src data --include=*.ts --include=*.tsx --include=*.json | head -50`.
   Also search the names the UI shows (button labels, log lines) and the type names (`types.ts`).
2. **Read the area's skill and doc** (table below). They hold earlier decisions and the reasons for them.
3. **Read the lists that define the feature set**: README (what players are told exists), `docs/RULES_STATUS.md`
   (rules that run), `docs/04-campaign-tree.md` (tree and relics), `ARCHITECTURE.md` (hooks and layers), the test
   names of the area (`find src -name '*.test.ts*'`, then `grep -n "it(" <file>`): a test name often says exactly
   what a feature promises.
4. **Look at the history**: `git log --oneline -30 -- <file>` and `git log --all --oneline --grep "<word>"`. A
   reverted change or a "no longer" in a message is a decision you must not undo by accident.
5. **Check the helpers you are about to need already exist**: effect parts in `BattleFx.tsx` (Glow, Sparks,
   Shockwave, Arcs...), engine queries in `effects.ts` / `state.ts` / `geometry.ts`, bot scores in `botMove.ts`.
6. **Check the field is really read.** Before relying on a data field or an `Effect` key, find the code that reads it
   for the path you use. (Example: `mobile` on a timed effect did nothing; only `throughTerrain` was read.)

Write the result down (in your notes or the reply), in this shape:

```
Exists:   <what>  in <file>  does <what>, used by <who>
Gap:      <what is missing or wrong, with evidence>
Decision: extend <x> | replace <x> (and delete it) | new <y>, because <reason>
```

## 3. Decide: extend, replace or new

- **Extend** when what exists is right but incomplete. The default.
- **Replace** when what exists is wrong at its root. Then remove the old one in the same change, move its callers,
  and keep its error handling. Never leave two ways to do one thing.
- **New** only when nothing fits, and name the reason. Put it next to its siblings and follow their conventions.
- **Keep shared ideas in one place.** One scale factor, one list of tree keys, one relic text writer, one style
  classifier. If you need a variant, parameterise the original.
- A change in one area often needs the matching change elsewhere (a new `SkillStyle` needs colours in `BattleFx.tsx`,
  a test, and a line in the vfx skill). List those places before editing.

## 4. Build

Follow `ponytail`: the smallest complete change, no options nobody asked for, a one-line comment for a reason the
code cannot show. Scratch work (sheets, benches, one-off games) goes in `src/zz/`, which is never committed.

## 5. Verify, for real

Load `verify`. Prove the change with the checks that fit it, and report the actual numbers (test counts, VP, ms,
before and after). A passing type check is not proof that a game plays differently. If you could not check
something, say so plainly.

## 6. Document and ship

Load `docs-sync` and update every doc the change makes wrong. Then commit (message: what changed and why, for a
player or a developer; the trailer lines the session gives), push the branch, run the full suite, and fast-forward
`main` only when it passes. Before pushing, run `git remote set-url origin https://github.com/solicwe/Warhammer-Warband`.

## 7. Learn: make the skills better (every task)

The skills are this project's memory between sessions. A session that learns something and does not write it down
makes the next one pay for it again. Before the final commit, ask: what cost me time, what did the owner correct,
what worked that I would want to know next time? Then write it where the next session will read it:

| What you learned | Where it goes |
|---|---|
| A trap: a symptom whose cause was not where it looked | the area skill's "Pitfalls seen before" |
| A skill told you something wrong, or left out a step you needed | fix that line of the skill itself (do not add a pitfall next to a wrong rule) |
| A faster way to reproduce or check something (a harness, a command, a setup) | the `verify` skill, or the area skill's Verify section |
| The owner corrected you or chose between two ways | "Owner decisions" below, if it is a decision; else the area's pitfalls |
| Where something lives that was hard to find | the "Where things are" table, or the area skill's "How it is built" |

How a lesson is written:

- One entry, two or three lines: **the symptom** as the owner or a test shows it, **the cause**, **what to do**.
  Name the file and function. Example: "The army-buff cards were clipped wrongly (desktop): a CSS transform scaling
  the HTML inside a `foreignObject`; scale on the SVG side (`<g transform>`) instead."
- Only what was checked. Mark what is inferred but not yet seen ("fix inferred, owner to confirm"), and update the
  entry when it is confirmed or proved wrong.
- Keep each list short (about 12 entries). When one fills up, merge entries that say the same thing, and delete those
  a test or the code now prevents (the test is the better memory). Delete a lesson that turned out wrong.
- The lesson goes in the same commit as the change that taught it, and the reply says which skill got it.

If nothing new was learned, say so in one line; do not invent a lesson.

## Definition of done

- Every item of the ask is done or named as skipped.
- The inventory was made and the decision is stated.
- Checks that prove the change ran and their numbers are in the reply.
- Docs match the code. The branch is pushed; `main` is fast-forwarded after the full suite passed.
- What the task taught is in the skills (step 7), or the reply says nothing new was learned.
- The reply (in Thai) ends with what was skipped or not checked, and the risks.

## Owner decisions (do not reverse without asking)

Made in conversation, so they are not all visible in the code. A change that would undo one needs the owner's yes.

- **Normal games follow the official rules.** House changes live in the campaign only: random Force Dispositions,
  both sides drawing their Secondary cards at round 1, the small kill bonus (1 VP a unit, 2 for a character, vehicle
  or monster, at most 12 a battle).
- **Campaign battles are normal battles**: an official primary, Tactical secondaries, five rounds; won on points.
- **Campaign events never pile on a losing player**: enemy reinforcements only while the player is ahead, on a roll,
  at most once a battle. A loss still pays Scrap; the Scrap reward card pays 80-120 ("more relic" meant that card); BATTLELINE and
  DEDICATED TRANSPORT copies stay cheaper for longer (their copy limit is doubled in the rules).
- **The bot plays for points in the campaign and in idle mode** (`pointsFirst`); normal games against the bot keep
  the usual plan.
- **The army tree fits each army** (no node for a keyword it cannot field), **tree and relics never overlap** (the tree
  changes numbers and re-rolls, relics give special rules, no shared names), relic text is written from the effect.
- **Effects**: fire only for torrent weapons (a psychic power is a psychic bolt, plasma is plasma); no drifting smoke
  or haze as the main event; every effect sized to the model and the zoom through the one scale (`VIS`, `TRACE`);
  blasts about the size of the unit hit; Deep Strike keeps the old lightning arrival the owner liked; mortal wounds
  are a flash and a shockwave, no lightning; Sonic is not drawn as rings; every ability style keeps its own shape.
- **Reserves are declared before deployment**, once (battle formation); no per-unit Reserves button while deploying, no
  automatic deploy buttons. The Idle tactic is chosen in Settings only.
- **Big games must not freeze**: the bot's quick planning on big boards and the worker fallback stay.
- No emoji anywhere; replies in Thai.

When the owner makes a new decision of this kind, add it here in the same change.

## Docs that are history, not specs

- `docs/02-game-design.md` is the original MVP plan (October 2026, in Thai): its roadmap and open questions are old.
  Read it for intent, not as the current design.
- `docs/unit-audit.md` is a dated snapshot (11 Oct 2026).
- The current truth is the code, the tests, README, ARCHITECTURE.md, AI_GUIDE.md, docs/RULES_STATUS.md,
  docs/04-campaign-tree.md and these skills. `docs/05-tech-debt.md` lists known bugs and debt by priority: read it
  before a cleanup, and update it when you fix or find one.

## Where things are

| Area | Code | Data | Doc / skill |
|---|---|---|---|
| Turn loop, dice, attacks, terrain, missions | `src/engine/game.ts`, `attack.ts`, `geometry.ts`, `config.ts` | `data/core-rules.json`, `missions.json`, `layouts.json` | `ARCHITECTURE.md`, `docs/01-rules-11e-reference.md` |
| Rules as data | `src/rules-engine/effects.ts`, `activations.ts`, `stratagems.ts` | `data/abilities/`, `data/stratagems/`, `data/detachment-rules.json` | `rules-data`, `AI_GUIDE.md`, `docs/EDITING.md`, `docs/RULES_STATUS.md` |
| Army rules with state | `src/factions/*.ts`, registered in `src/factions/index.ts` | | `ARCHITECTURE.md` (hooks) |
| Datasheets | generated into `public/data/factions/<ID>.json` | `data/raw`, `data/packs`, `data/overrides/<ID>.json` | `rules-data` |
| Bot | `src/ai/` (`bot.ts`, `botMove.ts`, `botPlan.ts`, `botLook.ts`, `botStrats.ts`) | `data/bot-weights.json`, `data/bot-elo.json` | `bot`, `docs/03-bot-competitive.md` |
| Campaign | `src/engine/campaign.ts`, `campaignTree.ts`, `campaignTreeArmies.ts`, `treeFielded.ts`; UI `src/ui/Campaign.tsx`, `ArmyTree.tsx`, `Relics.tsx` | | `campaign`, `docs/04-campaign-tree.md` |
| Screens | `src/ui/` (`App.tsx`, `GameScreen.tsx`, `Board.tsx`, `ArmyBuilder.tsx`, `styles.css`) | | `ui` |
| Battle effects | `src/ui/BattleFx.tsx`, `fxTextures.ts`, `src/engine/weaponFx.ts`, `skillStyle` in `src/engine/state.ts` | | `vfx` |
| Saves | `src/services/storage.ts`, `src/ui/library.ts` | | `ui` |
| Scripts | `scripts/build-data.mjs` (`npm run data`), `build-images.mjs`, `elo.mjs`, `tune.mjs`, `audit_*.ts` (write `audit_report.json`, `integration_audit_report.json`) | | |

The faction pack PDFs in the repository root (`aoi_update.pdf`, `tyranids_faction_pack.pdf`) are sources for data
imports; read them, never edit them.
