# Bugs and technical debt (audit of 1 November 2026; updated 5 November 2026)

A whole-project check: type check with unused-code warnings, a search for exports nobody uses, the engine's
determinism rule, dependencies, the docs against the code, and a bot-vs-bot battle in the browser. Update this file
when an item is fixed or a new one is found; delete an item once it is gone.

Priority = (impact + risk) x (6 - effort), each scored 1 to 5.

## Fixed in this audit

| Item | What was wrong | Fix |
|---|---|---|
| Ghost copies of the army-buff cards beside the map (desktop) | The cards are HTML in an SVG `foreignObject`. A CSS transform inside it clipped them wrongly, and nothing painted under them, so Chrome left their old positions on screen while the map panned or zoomed | Scale on the SVG side; a strip of the board colour under each card column that moves with the camera (`Board.tsx`) |
| `Math.random` in the campaign engine | Unit ids and the next sector's seed came from `Math.random`, against the project's determinism rule | ids from `newUid`; the next sector's seed from the run's seed (`campaign.ts`) |
| Dead code | 33 exported functions nobody called (the removed Sync/Backup and photo export, `RelicStrip`, three engine aliases, an unused allied-reinforcement builder), 49 unused imports, 20 unused locals | Removed (about 490 lines) |
| Stale bot "thinking" state | The commander panel was removed on 21 Oct, but the battle screen still stored the bot's thinking progress and re-rendered on every update | State removed |
| Bot level notes on the setup screen | They promised thinking "during your turn" and "up to ~20 s / ~40 s" and the wrong number of ways; the app has not pondered since 9181a17 and caps a turn's look at 0.25 s | Notes now say what each level tries (`BattleSetup.tsx`) |
| Campaign reinforcements every battle | The code fired at round 3 in every campaign battle, though its comment said only when the player was ahead | The guard now exists, with a 40% roll; tested (`campaignRules.test.ts`) |
| Thinking during the player's turn, switched off since 9181a17 | The worker code, its helpers (`playToMovement`, `lookSig`, `boardSig`), the Commander panel and the Enemy plan button (fed only by that thinking, so it never appeared) were still in the code | Removed with their CSS and their one test |
| Battle screen crash after an attack (React error #300) | `DiceTray` returned before two of its hooks | Return moved below the hooks; `hooksOrder.test.ts` guards every component |
| `UnitActionBar.tsx` | A whole component and its CSS that nothing rendered | Removed |
| Fire Overwatch on a unit that did not move | The end-of-Movement window let any enemy within 24" be shot | `overwatchTargets`: only units that moved or were set up this turn, for the player and the bot |
| The defender could not fight back | The map's unit actions were for the active player only | The side whose pick it is gets the Fight action, and the panel has a Fight button |
| A stale comment | `fitFormation` said objective markers block a model; they do not (`pathing.ts`) | Comment corrected, unused filter removed |
| Charge rolls failing at engagement distance | Target checks compared the full base-to-base gap with the rolled movement, although a charge only needs to reach Engagement Range | Target selection and charge result feedback now include the 1" Engagement Range; `autoCharge.test.ts` covers a charge that ends 1" away |
| Consolidation waited until all units had fought | The fight step collected every consolidation at the end of the phase | A unit can now consolidate immediately after its attacks and before the next fight; `fightChoices.test.ts` checks the return to the next fighter |
| Quarter and movement guides missing on some maps / units | Faint quarter lines were drawn beneath terrain, and model range circles were hidden for units with more than six models (three for charges) | Active quarter scoring labels all quarters and the centre exclusion area; range circles render for every model in a draft |
| Consolidation unavailable after a nearby enemy was destroyed | The player could choose a position only if an enemy or objective was already within 3" | Fought units can now consolidate toward any remaining enemy or the nearest objective; `fightChoices.test.ts` covers both cases |
| Replaying a finished battle skipped most actions and remounted at each step | Replay recorded only turn changes, and its changing key recreated the game screen for Previous / Next | Replay now stores compressed action snapshots, syncs them without remounting, supports Play/Pause, and stays read-only |
| Mission sheets were hard to close or scroll, and the live map covered them | The sheet handle was decorative, touch scrolling was not enabled, and the map stayed at the board's top edge | The handle taps or swipes down to close, touch panels scroll, and the map moves above the tray |
| Deep Strike placement hid the required enemy distance | The placement panel showed the unit and Confirm but not its actual keep-away range | The panel now displays the unit's Deep Strike range from enemy units |
| Crushing Impact interrupted a successful charge or had no clear decline action | Successful manual and automatic charges opened the stratagem prompt immediately, and the later charge panel had no explicit skip button | The charge completes without a prompt; the player can choose Crushing Impact or dismiss its panel for the current turn |
| Tyranid campaign arsenal had no named end node when no priced Bio-titan was recruitable | The Titan keystone was removed to match the current recruit pool, leaving the ordinary keystone empty | Added the Great Devourer ordinary keystone and checked that every army's arsenal has a named keystone |
| Compound wargear text could become a fake item name | `parseWargearOption` kept the "is replaced with" sentence as a weapon choice | Extract the replacement item before canonicalising choices; regenerated faction data |

## Open, by priority

| # | Item | Kind | Impact | Risk | Effort | Priority | Why it matters / plan |
|---|---|---|---|---|---|---|---|
| 1 | Rule numbers in script-generated factions | Code / data | 4 | 4 | 4 | 16 | A hand check of 30 "Works" abilities found 8 wrong (`docs/RULES_STATUS.md`, Accuracy). Check 10 per faction against the card, starting with the factions generated by `scripts/gen-*` |
| 2 | Full suite takes about 20 minutes | Test | 4 | 2 | 3 | 18 | Every change to `main` waits on it. Split whole bot-vs-bot games into a slow group CI runs, keep a fast group for local runs |
| 3 | Very large files | Code | 4 | 3 | 4 | 14 | `GameScreen.tsx` (about 3,500 lines), `game.ts` (about 3,300), `Board.tsx` (about 2,300). Split by phase when a change touches one: move a phase's panel or rules into its own file, one at a time |
| 5 | 48 `any` casts | Code | 2 | 2 | 2 | 16 | Most in `visibility.ts`, `campaign.ts`, `game.ts`. Replace when touching those lines |
| 6 | `noUnusedLocals` is off | Code | 2 | 2 | 2 | 16 | Production code is clean now; test files still have unused imports. Clean the tests, then turn the flag on so dead code cannot pile up again |
| 7 | HTML inside the SVG board | Architecture | 2 | 2 | 3 | 12 | `foreignObject` is fragile: Safari draws it empty (the cards are off on phones), Chrome needed two fixes. If it breaks again, draw the cards as SVG text or as an HTML layer that follows the camera |
| 8 | One-off scripts in `scripts/` | Code | 1 | 1 | 1 | 10 | `gen-*`, `update-*`, `fix-*`, `extract-layouts*` did one import each. Keep them as history or move them to `scripts/oneoff/` |
| 9 | Test-only presets in `src/ui/presets.ts` | Code | 1 | 1 | 1 | 10 | About 1,000 lines used only by tests (the Quick armies left the app). Move to a test fixtures folder |
| 10 | Dependencies a patch behind | Dependency | 1 | 1 | 1 | 10 | react 19.3.1, vite 8.3.5, vitest 5.0.5 are out; `npm audit` finds 0 vulnerabilities. Update together, run the full suite |
| 11 | Dice fallback seed | Code | 1 | 1 | 1 | 10 | `nextRandom` in `dice.ts` seeds from `Math.random` when a state has no seed (only a broken save). Acceptable; noted so it is not mistaken for a pattern |

## How it was checked

- `npx tsc --noEmit -p . --noUnusedLocals` (production files): 69 findings, now 0.
- A script listing exports no other file uses: 35, 33 removed (2 in the frozen bot baseline stay).
- `grep Math.random src/engine`: 5, now 1 (item 11).
- `npm outdated`, `npm audit --omit=dev`.
- The README, ARCHITECTURE and the skills read against the code for removed features (none claimed).
- A bot-vs-bot battle in the browser at desktop size: no page errors; the army-buff cards render whole.
