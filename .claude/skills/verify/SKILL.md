---
name: verify
description: How to prove a change to Warhammer Warband really works, per kind of change (rules, engine, bot, campaign, UI, effects, performance), with the commands, harnesses and numbers to report. Load before saying a task is done, and before fast-forwarding main.
---

# Verify

"Done" means checked. Pick every row that applies to the change, run it, and put the numbers in the reply.

## Always

| Check | Command | Notes |
|---|---|---|
| Types | `npx tsc --noEmit -p .` | seconds |
| Build | `npx tsc -b && npx vite build` | must print `built in` |
| Tests of what you touched | `npx vitest run <files>` | name the files and the count that passed |
| Full suite before `main` | `npx vitest run` | about 20 minutes, 100+ files; run it in the background and wait for it; never fast-forward `main` on a red or unfinished run |

A test that passes without the change proves nothing. For a fix, make the new test fail first (comment the fix out
or run it on the old code), then pass.

## By kind of change

**Rules data** (`data/abilities`, `data/stratagems`, `data/detachment-rules.json`)
- `npx vitest run src/engine/rulesData.test.ts` (unknown conditions, triggers or keys fail it).
- The faction's test file, with a test that builds the unit and checks the number the rule changes.
- `docs/RULES_STATUS.md` still tells the truth.

**Engine** (`src/engine/`, `src/rules-engine/`)
- Unit tests of the rule, then a seeded bot-vs-bot game for the factions involved (see `src/engine/campaignTreeEngine.test.ts`
  "plays to the end" for the loop: `botShouldAct ? botStep : endPhase` until `gameover`).
- Effect fields: prove the engine reads them. The pattern is the `signature` helper in `campaignTreeEngine.test.ts`:
  apply the effect to a unit and check that stats, rolls, OC or attack and defence modifiers change.

**Bot** (`src/ai/`) — load `bot` too
- `src/ai/*.test.ts` and `src/engine/bot*.test.ts`.
- Strength: mirror games in `src/zz/` (the same army on both sides, every game played from both sides, the change on
  one side only), reported as wins and VP totals per side; or `ARENA=1 ARENA_GAMES=12 npx vitest run src/engine/arena.test.ts`;
  or `node scripts/elo.mjs --games 48 --workers 4 --label "<what>"` against the frozen baseline in `src/ai/baseline/`.
- Speed: time the worst single bot step in a 2000-point game (a node bench in `src/zz/`, bundled with esbuild, or
  `node --cpu-prof` to find the hot spot). Report before and after.

**Campaign** — load `campaign` too
- `src/engine/campaign*.test.ts` (tree shape, fit per army, relics, migration, rules, engine). A save-format change
  needs a migration test that loads the old shape.

**UI and effects** — load `ui` / `vfx` too
- Look at it. Start `npx vite --port 5179 --strictPort` in the background, open the page with Playwright
  (`require('playwright')`, `chromium.launch()`, a phone viewport such as `devices['iPhone 13']`), screenshot, read
  the image. Kill vite by its PID afterwards.
- Effects: a sheet page in `src/zz/` that renders `FxView` (export it for the run, put it back after) at two or three
  moments of each effect, board zoomed out (`<FxLayer fx={[]} viewW={44} />`). Send the sheet to the owner.
- Frame cost: render an attack 61 times with `flushSync` and time it; count the SVG elements.
- `src/ui/battleFx.test.tsx` checks that every weapon kind draws something.

## Reporting

- Give the numbers: "893 tests passed", "8 of 12 games won, 369 VP to 304", "worst step 3.0 s to 1.9 s".
- Say what was not checked (a phone, a faction not covered, few games) and what could still go wrong.
- Never write "should work" or "probably fixed" for something you could have run.

## Pitfalls seen before

- `kill $(pgrep -f "vite --port 5179")` is a kill by pattern: it also matched the shell running it. List the processes
  (`ps -eo pid,args | grep "vite --port"`), then kill the exact PIDs. Start one vite at a time; an old one may still
  hold the port.
- A run of the full suite started while files were changing gave a wrong result. Do not edit `src/` while it runs;
  docs and skills are safe to edit.
