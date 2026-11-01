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
| Army plan | `src/ai/botPlan.ts` | `armyPlan(s, p)` gives each unit a role: home, anchor (holds an objective), hammer (hunts), screen, firebase, support, taxi; `stanceFor`; `pointsFirst(s)` (campaign or idle): objectives get holders before units hunt |
| Turn styles | `src/ai/botLook.ts` | `STYLES` (steady, aggressive, careful, objectives, hunt, rogue); `chooseTurnStyle` plays copies of the turn to pick one; the campaign always plays `rogue` (objectives first) |
| CP and stratagems | `src/ai/botStrats.ts` | which stratagem, when; re-rolls |
| Choices | `src/ai/botPlus.ts`, `botRituals.ts` | doctrines, abilities with a decision, Rituals |
| Deployment | `src/ai/deploy.ts` | where units start |
| Idle / auto-play | `src/ai/autoPlay.ts`, `src/ui/GameScreen.tsx` (Idle button: `s.idleBots`, `s.bots = [0, 1]`) | the same bot plays the player's side |
| In the browser | `src/ui/lookWorker.ts`, `GameScreen.tsx` | the bot thinks in a Web Worker; a step that takes over 90 s falls back to the main thread |
| Baseline | `src/ai/baseline/` | a frozen copy the live bot is measured against (`scripts/bot-baseline/snapshot.mjs`) |

Both sides go through the same code: nothing is special to player 1. Difficulty (`s.botLevel`) sets how much the
look-ahead tries; the campaign and phones skip the look-ahead.

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
- **Speed**: a 2000-point game, worst single step, before and after; `node --cpu-prof` for the hot spot. A step over
  a few seconds on a computer is much slower on a phone.

## Pitfalls seen before

- Too many hunters, too few objective holders: the campaign is won on points, so `pointsFirst` exists; keep it.
- Big games froze: line of sight from every candidate spot was the cost. Keep the quick path for big boards.
- A behaviour change for the enemy also changes idle (the same code); say which sides it applies to.
