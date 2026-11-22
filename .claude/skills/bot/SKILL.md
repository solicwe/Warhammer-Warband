---
name: bot
description: Change, measure or debug Warhammer Warband's bot (movement, roles, targets, stratagems, play style, difficulty, speed, idle auto-play). Load for any request about the bot playing badly, not scoring, being slow or freezing, or about idle mode.
---

# The bot

## How it is built

| Part | File | What it does |
|---|---|---|
| Entry | `src/ai/bot.ts` | `botStep(s, p)` plays one step for side p; `botShouldAct`; shooting order (`botShootOne`) |
| Movement | `src/ai/botMove.ts` | scores places to move with weights from `data/bot-weights.json`; quick planning on big boards (`bigBoard`: more than 150 models brought; `isFastPlanning`) |
| Army plan | `src/ai/botPlan.ts` | `armyPlan(s, p)` gives each unit a role: home, anchor (holds an objective), hammer (hunts), screen, firebase, support, taxi; `stanceFor`; `pointsFirst(s)`: objectives get holders before units hunt unless `s.idleTactic === 'assault'` |
| Turn styles | `src/ai/botLook.ts` | `STYLES` (steady, aggressive, careful, objectives, hunt, rogue, assault); `chooseTurnStyle` plays copies of the turn to pick one |
| CP and stratagems | `src/ai/botStrats.ts` | which stratagem, when; re-rolls |
| Choices | `src/ai/botPlus.ts`, `botRituals.ts` | doctrines, abilities with a decision, Rituals |
| Deployment | `src/ai/deploy.ts` | where units start |
| Idle / auto-play | `src/ai/autoPlay.ts`, `src/ui/GameScreen.tsx` (Idle button: `s.idleBots`, `s.bots = [0, 1]`) | the same bot plays the player's side |
| In the browser | `src/ui/lookWorker.ts`, `GameScreen.tsx` | the bot thinks in a Web Worker; a step that takes over 90 s falls back to the main thread |
| Baseline | `src/ai/baseline/` | a frozen copy the live bot is measured against (`scripts/bot-baseline/snapshot.mjs`) |

Both sides go through the same code: nothing is special to player 1. Difficulty (`s.botLevel`) sets how much the
look-ahead tries; phones skip the look-ahead.

## Inventory first

- Find the role, weight or style that decides the behaviour you want to change before adding a new one
  (`grep -n "role:" src/ai/botPlan.ts`, `STYLES` in `botLook.ts`, `data/bot-weights.json`).
- Check `docs/03-bot-competitive.md` (CP and stratagem thinking) and recent commits on `src/ai/` for decisions.
- Watch a real game before guessing: count roles, VP per side, primary versus secondary, what the bot does each phase.

## Measure, do not guess

- **Mirror games** (fast, in `src/zz/`): the same army on both sides, each game played from both sides, the change
  switched on for one side only. Report wins, VP totals and the role counts per side.
- **Arena**: `ARENA=1 ARENA_GAMES=12 npx vitest run src/engine/arena.test.ts` (live bot against the baseline).
- **Elo**: `node scripts/elo.mjs --games 48 --workers 4 --label "<what>"`; `--promote` makes the live bot the new baseline.
- **Tuning weights**: `node scripts/tune.mjs --iters 30 --games 24 --workers 4`.
- **Read an Elo run by pairs, not by score**: about two pairs in three are split (each army wins once), so the army
  decides most games and 48 games give +-100 Elo. The sum of a pair's two margins cancels the armies; compare that sum
  seed by seed with another run on the same seeds (games are deterministic: the same code and seed give the same
  margin). A 48-game run takes about 30 min with two runs side by side on this machine; use seeds 7000 and 9000.
- **Speed**: a 2000-point game, worst single step, before and after; `node --cpu-prof` for the hot spot. A step over
  a few seconds on a computer is much slower on a phone.

## Pitfalls seen before

- Too many hunters, too few objective holders: a battle is won on points, so `pointsFirst` exists; keep it.
- Big games froze: line of sight from every candidate spot was the cost. Keep the quick path for big boards.
- A behaviour change for the enemy also changes idle (the same code); say which sides it applies to.
- Every person is on auto rules and also in `s.decides` (`withAutoRules`). Any `autoPlay.ts` helper that presses a
  button or spends CP for them must check `decides(s, p)` first: `autoSelectToShoot` once spent a Sorcerer's
  once-per-battle Twisted Sorceries the moment it was picked to shoot.
- `autoDue` must also check `decides` for Fight substeps such as Pile-in and Consolidation; otherwise a human's Consolidation goes through `botFightStep` even when the Fight panel offers a manual choice.
- The bot never made an Overrun fight: a unit whose foe died just ended. `botFightStep` now piles in when an enemy is
  within 5" (`canOverrun`). Melee weapons with strike / sweep still always use the first profile for the bot.
- Consolidation is part of each unit's fight before the next activation; a bot that fails to get an Overrun into Engagement Range must be marked as not eligible to consolidate.
- Deployment (smartPlacement in src/ai/deploy.ts): watchers sampled from the enemy zone must span both X and Y fully and include placed models; sampling a few points row-by-row and slicing to 8 left most of the enemy zone unchecked, so units thought they were hidden when they were exposed. Candidates also need shelter detection (isBehindTerrain) so spots standing behind obscuring footprints or solid walls rank high enough in the pre-sight pool.
- Firing Deck squads (owner, 21 Nov 2026: "3 Eradicators in an Impulsor fire melta while it moves"): `deckShooters` passengers (a squad whose best guns score 20+ in `deckScore`) stay aboard and fire through the transport all battle only when the deck fires the whole squad (`deckWhole`: Firing Deck X >= the squad's models); they get out only late (pace 3+) when an objective needs bodies. A 10-model squad that fires 2 guns out of a Rhino keeps the old rule (out once the enemy is close or by round 3), or it would sit in the Rhino all game instead of holding objectives. Three checks decide it: `wantsOut` (before the transport moves), `botRapidDisembark` (after it moved: the Rapid branch had no deck guard, so they hopped out in round 1-2) and the Tactical branch. Check with a seeded bot game: the Eradicators' status stays `embarked` and the Impulsor's attack fx carries `melta` volleys.
- Reserves (22 Nov 2026): the bot put every deep striker in Strategic Reserves (up to half its points) and lost about
  5 VP a game to the October baseline for it, which never reserves: turning it off gave +10.8 +- 4.3 VP per pair
  over 96 games. Now only units that must start in Reserves (Drop Pod, Tyrannocyte) go there. Measured at the same
  time, against the bot of that day, VP per pair: faction archetype nudges off +0.4 +- 3.8, October squad layouts
  instead of `grandmasterPositioning` +6.5 +- 5.3 (and +-0 on top of no Reserves), the grandmaster arrival spot scored
  like the others +0.5 +- 3.4, wargear as the meta +4.4 +- 5.1 (none of them proven). Before the change the live bot
  lost mostly primary VP in rounds 3-5 (48 games, `src/zz` VP split); after it, it still wins only 42% of games
  against the October baseline (-58 Elo) though its VP margin is close to level (-3.3 +- 4.2 VP per pair).
- `node scripts/elo.mjs` failed on Windows until 21 Nov 2026 (`spawn npx ENOENT`; fixed with `shell: true` on win32), so no Elo was measured between 9 Oct and 21 Nov. To tell whether a change hurt the bot, run the same seed on the commit before it as well (a `git -c core.longpaths=true worktree add` in a short path such as `C:/Users/prem2/wtb`, with a junction to `node_modules`) and compare the two runs, not the run with the October numbers. On 21 Nov both were near 32% against the October baseline: the drop came between October and 20 Nov, not from that day's rules.
