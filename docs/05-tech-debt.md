# Bugs and technical debt (audit of 17 November 2026)

A whole-project check: every tracked file listed and sized, the engine core (`game.ts`, `attack.ts`, `visibility.ts`,
`state.ts`, `types.ts`) read line by line against the 11th edition text, a scan for code nothing uses, the test and
build tooling, and the docs against the code. Update this file when an item is fixed or a new one is found; delete an
item once it is gone.

- **P0**: the game plays differently from the 11th edition text, or a tool silently does nothing.
- **P1**: structure that makes every change slower or riskier.
- **P2**: tidy-up.

The rules were checked against the official text: the Core Rules and the Rules Appendix of the 11th edition as shown on
Wahapedia (`wahapedia.ru/wh40k11ed/the-rules/`), read on 17 November 2026. Section numbers below are the official ones.
`docs/01-rules-11e-reference.md` is this project's summary of that text; where the two differ it is said here.

## Removed on 17 November 2026

The owner's rule from this day: there is no campaign / roguelike mode, and code nothing uses is deleted.

| What | Why it was dead | Lines |
|---|---|---|
| `createFactionTitan`, `makeUnitState`, `expandRoguelikeMap`, `polygonArea`, `fightingArmyPoints`, `isFightEvenlyMatched` (`game.ts`) | Roguelike leftovers. The "titan boss" units had invented profiles (a T12 W30 "Wraithlord Heavy Construct", a "Broadside Battlesuits Heavy Team" with TITANIC); nothing called them | 268 |
| `screenShake` (state), `shake-expand` / `shake-titan` (styles) | Set by nothing since the roguelike map growth went | 20 |
| Campaign styles in `styles.css` (`.campaign`, `.cmp-*`, `.relic*`, `.tree*`, reinforcement and garrison roads) | No component uses these class names | about 810 |
| `src/ui/AbilityBadgePopover.tsx` and `abilityBadge.test.ts` | Only its own test imported the component | 659 |
| `src/ui/TabletopSetupGuide.tsx` | Imported by `TabletopScreen.tsx`, never rendered | 266 |
| `src/ui/MapCam.tsx` | Two stubs returning null, imported by nothing | 10 |
| `evaluateUnitVisibility`, `unitVisibilityCache`, `losUnitPairCache`, `getSquadBoundingBox` (`visibility.ts`) | Called by nothing. The cache key left out who had shot and the terrain, so it would have answered wrongly if used | about 130 |
| `tuneTournamentWeights`, `getActiveTournamentWeights`, `setActiveTournamentWeights` (`tournamentTrainer.ts`) | Called by nothing; the tuner used `Math.random` | about 55 |
| `segLengthInPoly`, `pathDistance`, `OBJECTIVE_MARKER_R`, `activeLabels`, `resetCoach`, `loadoutSummary`, `isPlaceholderIcon`, `loseWoundsForTest`, `CoreStratagemId` | Exports with no reference anywhere | about 60 |
| `scratch/update_primary_btn.cjs` | A one-off style patch script, committed by mistake | 82 |
| The 44x90 and 60x90 tables of the 3000+ point games | Not in the rules; the owner keeps the 3000, 4000 and 5000 point sizes on the 44" x 60" table | 20 |
| Seven per-battle-size tables (Aeldari, Genestealer Cults, Death Guard, Warp Portals, Sagas ...) | Each knew only Incursion / Strike Force / Onslaught, so 4000 and 5000 point games got the Strike Force number. Now one helper, `bySize` (`state.ts`); bigger sizes use the Onslaught number | 20 |
| `aoi_update.pdf`, `tyranids_faction_pack.pdf` | Games Workshop files in a public repository; owner decision. Moved to `data/raw/` (ignored) | |
| Docs and skills | `CLAUDE.md`, `ARCHITECTURE.md`, `AI_GUIDE.md` and five skills still described the campaign, its files and its tests | |

## Rules that differ from the 11th edition text read on 17 November 2026 (kept, owner decision)

The owner says the code follows newer rules than that text, so these rows stay as they are (owner, 17 Nov 2026);
they are a record, not a to-do list. Change one only with the owner's yes. "Earlier fix" marks behaviour an earlier
session added on purpose.

| # | Rule (section) | The text says | The code does | Where |
|---|---|---|---|---|
| R1 | Charge targets (11.04) | A target must be within 12" and within the charge roll, measured to the unit itself. The rule's own example: a 7" roll cannot pick a unit more than 7" away even though the charger could end within 2" of it | Accepts a target within the roll plus 2", so an 8.5" charge needs a 7+ instead of a 9+ (58% instead of 28%). It also accepts an enemy out of reach when a friendly unit touching it is in reach. Earlier fix | `chargeTargetOptions`, `declareCharge` (`game.ts`), bot charge odds |
| R2 | Charge move (11.04), charge roll (02.02.01) | Each model that can end within 1" of a target must, each that can end engaged must. A charge roll above 12 after modifiers counts as 12 | A dragged charge is only checked for "ends closer". No cap at 12 | `validateMove`, `declareCharge` |
| R3 | When units consolidate (12.07) | One step after every fight, the player whose turn it is first | Each unit consolidates right after it fights, the rest at the end. Earlier fix | `markFought`, `endConsolidateStep` |
| R4 | Consolidation modes (12.08) | Ongoing if engaged. Else Engaging, only if within 3" of an enemy: must end engaged with every enemy picked. Else Objective, only if within 3" of an objective: must end in range and unengaged. Else no move. An engaged enemy that has not fought must then be selected to fight | Engaging against any enemy anywhere on the table, Objective towards the nearest objective at any distance, and any 3" move that keeps engagement is accepted: a free 3" move. `consolidate.range` in `core-rules.json` is never read. Earlier fix | `consolidateMode`, `validateMove` |
| R5 | Pile-in (12.03) | Each moved model ends closer to the closest pile-in target, and engaged with it if possible | A dragged pile-in is only checked for "the unit ends engaged" | `validateMove` |
| R6 | Engaged through a friend (03.04, 04.02) | No such rule: a model is engaged within 2" (5" up or down) of an enemy model, and attacks units it is engaged with | A model touching a friendly model that touches an enemy counts as engaged and may fight (a 10th edition habit) | `engagedEnemies` (`state.ts`), `engagedAt`, `buildFightPools` (`behindFriend`) |
| R7 | Fire Overwatch target (15.08, 15.09) | One visible enemy unit within 24" | Only units that moved or were set up this turn. Earlier fix | `overwatchTargets` |
| R8 | "Infantry Beast" Lone Operative 15" | Not a rule. Hidden (13.09) is the rule and `isHidden` already does it | A second rule beside Hidden with other conditions, which also writes `Lone Operative` into `u.keywords` from inside a query; its test is titled "Custom Logic" | `isInfantryBeastLoneOpActive`, `getUnitLoneOpRange` (`visibility.ts`), `Board.tsx`, `overhaulAudit.test.ts` |
| R9 | Benefit of Cover (13.08) | Every model of the target is INFANTRY / BEASTS / SWARM within a terrain area, or not fully visible because of terrain. Nothing about where the attacker stands | No cover when the attacker stands in the same terrain area, or in any terrain area ("Rules 3 and 4" of a "Strict Footprint Matrix") | `hasCover` |
| R10 | Obscuring (13.10), "within" (01.04.01) | An area that either of the two models is within is ignored. Within means any part of the base | The observing side counts its whole unit (comment: "10th Ed core"), the observed side one model. A small base must have its centre, or half its radius, on the plate. Cover and Hidden each use another test. `docs/01` section 5.4 also says "unit" and "centre on the plate" | `standsIn`, `modelInPiece`, `hasCover`, `isHidden` |
| R11 | Lethal Hits (24.23) | The attacker may choose the automatic wound | Always automatic, so a weapon that also has Devastating Wounds or Anti-X can never roll for the critical wound | `hitsForWounding` |
| R12 | Hazardous (24.15) | One hazard roll for each Hazardous weapon selected | One roll for each weapon type: five plasma guns roll one die | `finishAttack` |
| R14 | Strategic Reserves cap (20.01) | Half of the battle size's points limit, counting units embarked in a transport that is in Reserves; no FORTIFICATIONS | Half of the army's own points; embarked units are not counted; AIRCRAFT are left out (the text makes no exception for them); FORTIFICATIONS are not refused | `declareReserves`, `reservesPoints` |
| R15 | Reserves destroyed (20.04) | At the end of round 3, except units in a transport that arrived and repositioned units | Every unit in Reserves at the end of round 3 and of each later round, so a unit an ability sends back to Reserves dies | `endTurn` |
| R16 | Desperate Escape (09.07) | A unit that is not Battle-shocked may choose it, then takes a Battle-shock roll | Only when Battle-shocked or forced; no roll afterwards | `commitMove` |
| R17 | Coherency removal (03.03.01) | Models removed do not trigger "when destroyed" rules | Uses `killModel`: Deadly Demise can go off, death reactions fire, the model counts for kill missions | `endTurn` |
| R18 | Emergency Disembark (18.05), Rapid after Ingress (18.04.01) | Models are set up unengaged if possible, else engaged; only a model that cannot be set up is destroyed. After the transport's Ingress the passengers obey the Ingress limits | The whole unit is destroyed when its formation does not fit. Only Drop Pods keep the 8" | `emergencyDisembark`, `validateDisembark` |
| R19 | Objective control (14.02) | A model's OC counts for every objective it is in range of | Each unit is given to one objective only | `assignedObjective` (`missions.ts`), `levelOfControl` |
| R20 | Leadership limits (02.02.01) | Never better than 5+ or worse than 8+ | No limit | `bestLd` |
| R21 | Allocation order (05.03) | The defender orders the groups, within the limits | A fixed order | `allocationGroups` |
| R22 | Firing Deck (24.14), Torrent (24.37) | No ONE SHOT weapons through a Firing Deck; Torrent cannot be used for Indirect Fire | Not checked | `firingDeck`, `buildShootPools` |

Not in the engine at all, because the board is flat: heights (Plunging Fire from terrain 3" or higher, 22.05; the 5"
vertical distances; climbing; upper floors). `docs/RULES_STATUS.md` should say so.

### Checked and right

Engagement Range 2", coherency 2" and 9" with removal at the end of the turn, Battle-shock kept until a passed roll,
+1 CP to both players, free pivots, the pile-in step at the start of the Fight phase, Fights First and the player whose
turn it is choosing first, the charge roll before the targets, cover as -1 BS for each attacking model, Hidden 15" and
Gone to Ground -3", Lone Operative 12", TOWERING Plunging Fire, Heavy, Indirect Fire, Snap Shooting (6s, no criticals,
no re-rolls), the engaged MONSTER / VEHICLE rules, Blast X, Cleave X, Melta, Rapid Fire, Lance, Anti-X, the wound table,
save groups rolled together and applied lowest first, no spill of damage, Feel No Pain per wound, mortal wounds after
normal damage, Devastating Wounds on one model, hazard rolls failing on 1-2 (3 mortal wounds for an all MONSTER /
VEHICLE unit), the +1 / -1 cap on hit and wound rolls (02.02.01: this closes the note in `docs/01` sections 1.6 and
17), BS / WS 2+ to 6+, saves no better than 2+, Deep Strike and Ingress more than 8", wholly within 6" of an edge, no
enemy zone before round 3, Infiltrators and Scouts 8", the three disembark modes, the Dedicated Transport rule, the ten
core stratagems' costs and timings, Toughness of an attached unit, Incursion and Strike Force numbers.

### Not checked yet

- The mission deck (Chapter Approved 2026-27) was not read: who picks Attacker, the Tactical discard for CP (the code
  gives 1 CP for each card discarded at any moment of the player's own turn, with no limit), the cap of 20 VP on a Fixed
  card, every Primary and Secondary card's wording.
- Explosives and Smokescreen as they are coded; who starts "Remaining combats" (12.04); the Shock disembark (18.07),
  which `docs/01` does not mention.
- Unit abilities, enhancements, stratagems, detachment rules: see S2.

## Structure and tooling

| # | P | Item | Evidence | Plan |
|---|---|---|---|---|
| S1 | P0 | The slow tests and the bot tools cannot run | `vite.config.ts` excludes `sim`, `autoPlay`, `botLook`, `tune`, `arena` and `*Games*` tests by pattern, and Vitest applies that to a file named on the command line too: `npx vitest run src/engine/sim.test.ts` prints "No test files found". `scripts/elo.mjs` and `scripts/tune.mjs` start Vitest on `tune.test.ts` with its output hidden, so they do nothing. No whole bot-vs-bot game runs in CI. `test:ci` is the same as `test` | A second Vitest config or project for the slow group (`npm run test:slow`), used by the scripts and by a nightly CI job; `npm test` stays fast |
| S2 | P0 | `docs/RULES_STATUS.md` is not true and cannot be rebuilt | It shows 0 text-only rules in 2,318 unit abilities. 183 of the 3,080 entries in `data/abilities` carry no rule data (Genestealer Cults 79, T'au 17), and entries marked `"code": true` are not checked against any code. The generator is gone. Ten `*Status.test.ts` files only assert the label `status: auto` | One test that builds the table from the data and the engine and fails on `auto` without `effects`, `act` or a registered hook; delete the label tests; then a hand check of 10 rules per faction against the card (the old item 1) |
| S3 | P0 | A red test run still deploys | `deploy.yml` builds and publishes on every push to `main` without waiting for `ci.yml` | Deploy after CI passes (`workflow_run`, or one workflow with `needs`) |
| S4 | P1 | Games Workshop material in a public repository | The two faction pack PDFs left the repository on 17 Nov 2026 (now in `data/raw/`, `*.pdf` ignored), but they are still in the git history (33 MB of the 37 MB). Datasheet text and 1,441 unit photos remain | Removing them from history means rewriting it and a force push: owner decision |
| S5 | P1 | Faction rules inside the core | 47 checks of a named rule in `src/engine` (`army.ts` 19, `game.ts` 17, `attack.ts` 8, `state.ts` 2), the 25-name `REDEPLOY` table, set-up code for Chaos Spawn, Spore Mines and Poxwalkers in `createGame`, special cases in `killModel` and `rollWounds`. `layers.test.ts` passes because names are strings, not imports | Move each to rule data or to a hook in `src/factions`; add a test that fails on a quoted rule name in `src/engine` |
| S6 | P1 | Every faction adds fields to the core state | 157 optional fields on `UnitState` (46), `PlayerState` (72) and `GameState` (39), most of them one faction's bookkeeping; `types.ts` imports a type from `src/factions`; `(u as any).hasFiredThisTurn` in three files | A per-faction `ext` slot with typed access, used for new rules first |
| S7 | P1 | Very large units of code | `GameScreen` is one React component of about 4,450 lines (49 `useState`, 22 `useEffect`, 24 `useMemo`, 17 `useRef`); `Board.tsx` 2,531; `TabletopScreen.tsx` 2,333; `ArmyBuilder.tsx` 1,898; `game.ts` 2,880; one stylesheet of about 3,000 lines | One panel and one hook per phase, moved when a change touches it; `buildTerrain` (290 lines that repair traced layouts at every game start) into `npm run data` with a snapshot of the 45 layouts; `sanitizeGameState` into storage |
| S8 | P1 | No linter, no formatter, unused code not blocked | `noUnusedLocals` is off: 64 unused imports and locals in production files, 66 in tests (`npx tsc --noEmit -p . --noUnusedLocals --noUnusedParameters`). 52 `any` in production code | Remove them, turn the flag on; ESLint with `typescript-eslint` and `react-hooks` |
| S9 | P1 | The engine trusts the screen | `swapSecondary`, `chooseFixedSecondaries`, `discardSecondary`, `useCounteroffensive`, `crushingImpact` and others change the state without checking that the action is legal; the screen and the bot each check again | Every action checks and returns an error text; then a replay can be the seed plus the actions |
| S10 | P1 | A game cannot be replayed from its seed | Unit and marker ids come from `Date.now()` (`newUid`, `missions.ts`); the bot's look-ahead stops on the wall clock; replays store whole states, and `storage.ts` has four levels of pruning for their size | Ids from a counter in the state; later a log of actions |
| S11 | P2 | Tests named after sessions, fixtures that hide mistakes | `userFeedbackFixes` (853 lines), `uiFixes`, `newMechanics`, `overhaulAudit`, `fullSystemAudit`, `engineIntegrationAudit`, `rulesAudit`, `ruleGaps`; tests that read source files as text; four faction tests ask for the primary `takeAndHold`, which does not exist, and `primaryById` quietly gives Meatgrinder; `createGame({ primaryId })` forces the Purge the Foe disposition | Move cases to the feature's file when touched; an unknown id throws; the option takes its disposition from the primary |
| S12 | P2 | The README promises more than is checked | "10th / 11th Edition", "100% faithful", "9\" exclusion zones", "max 3 enhancements", "Rule of Three", offline play (there is no service worker), Node 18 (`.nvmrc` is 22), `npm run test:watch` (no such script), "Replay compression", the self-play trainer. `index.html` keywords name the 10th edition | Rewrite to what runs; `docs-sync` says no marketing |
| S13 | P2 | A trainer that trains nothing | `runHeadlessGame` takes two weight sets and never uses them; the "optimized tournament weights" are constants nothing reads. The real tuner is `scripts/tune.mjs` (see S1) | Delete it with its README section, or wire it to `botWeights` |
| S14 | P2 | Still unused | About 100 more style classes no component mentions (a list comes from scanning class names against `src`); 16 one-off scripts (`gen-*`, `generate_ae_abilities.js`, `update-*`, five layout patches) whose output has since been edited by hand, so running one again would overwrite fixes; two audit scripts outside the type check with their October reports in the root (`audit_report.json`, `integration_audit_report.json`); `presets.ts` (1,041 lines) used by tests and scripts only; `names.json` twice (`src/ui`, `public/images`); `core-rules.json` numbers nothing reads (`consolidate.range`, `objectiveMarkerRange`, `loneOperativeRange`, `plungingFire.height`, `charge.mustEndWithin`) | Delete or wire, one kind at a time |
| S15 | P2 | Owner decision and code differ | "Normal games against the bot keep the usual plan": `pointsFirst` is now true in every game unless the Idle tactic is assault | Ask the owner which one stands |
| S16 | P2 | Legacy campaign keys | `storage.ts` removes four old campaign keys on every start | Delete after January 2027 |
| S17 | P2 | `foreignObject` cards on the board | Safari draws them empty; Chrome needed two fixes | If it breaks again, draw the cards as SVG text or an HTML layer that follows the camera |
| S18 | P2 | Dependencies a patch behind | react 19.3.1, vite 8.3.5, vitest 5.0.5 | Update together, run the suite |

## Order of work

One session, one numbered item or one row group that touches the same files.

1. Tooling first, so later work is measured: S1 (slow tests and bot tools), S3 (deploy after tests), S8 (unused
   code flag).
2. Truth in the docs: S2 (rules status from a test), S12 (README).
3. Structure, one piece per session: S5 with its guard test, S6, S7 by phase, S9, S10.
4. Tidy-up: S11, S13, S14, S16-S18; ask the owner about S15 and S4 (history).

## Fixed in the audit of 1-5 November 2026

| Item | What was wrong | Fix |
|---|---|---|
| Ghost copies of the army-buff cards beside the map (desktop) | The cards are HTML in an SVG `foreignObject`. A CSS transform inside it clipped them wrongly, and nothing painted under them, so Chrome left their old positions on screen while the map panned or zoomed | Scale on the SVG side; a strip of the board colour under each card column that moves with the camera (`Board.tsx`) |
| Stale bot "thinking" state | The commander panel was removed on 21 Oct, but the battle screen still stored the bot's thinking progress and re-rendered on every update | State removed |
| Bot level notes on the setup screen | They promised thinking "during your turn" and "up to ~20 s / ~40 s" and the wrong number of ways; the app has not pondered since 9181a17 and caps a turn's look at 0.25 s | Notes now say what each level tries (`BattleSetup.tsx`) |
| Thinking during the player's turn, switched off since 9181a17 | The worker code, its helpers (`playToMovement`, `lookSig`, `boardSig`), the Commander panel and the Enemy plan button (fed only by that thinking, so it never appeared) were still in the code | Removed with their CSS and their one test |
| Battle screen crash after an attack (React error #300) | `DiceTray` returned before two of its hooks | Return moved below the hooks; `hooksOrder.test.ts` guards every component |
| `UnitActionBar.tsx` | A whole component and its CSS that nothing rendered | Removed |
| Fire Overwatch on a unit that did not move | The end-of-Movement window let any enemy within 24" be shot | Reopened as R7: the text allows any visible enemy unit within 24" |
| The defender could not fight back | The map's unit actions were for the active player only | The side whose pick it is gets the Fight action, and the panel has a Fight button |
| A stale comment | `fitFormation` said objective markers block a model; they do not (`pathing.ts`) | Comment corrected, unused filter removed |
| Charge rolls failing at engagement distance | Target checks compared the full base-to-base gap with the rolled movement | Reopened as R1: the text measures the roll to the target unit itself |
| Consolidation waited until all units had fought | The fight step collected every consolidation at the end of the phase | Reopened as R3: the text has one Consolidate step after every fight |
| Quarter and movement guides missing on some maps / units | Faint quarter lines were drawn beneath terrain, and model range circles were hidden for units with more than six models (three for charges) | Active quarter scoring labels all quarters and the centre exclusion area; range circles render for every model in a draft |
| Consolidation unavailable after a nearby enemy was destroyed | The player could choose a position only if an enemy or objective was already within 3" | Reopened as R4: within 3" is the rule's own condition |
| Player Consolidation moved before a choice appeared | `autoDue` sent a player who decides through the Fight-step bot path | The Fight-step auto path now respects `decides`; the screen keeps automatic Pile-in and waits for the player's Consolidation choice |
| Replaying a finished battle skipped actions, snapped movement, and had no seek bar | Replay synchronized snapshots but only bot-owned moves animated; the controls advanced one snapshot at a time | Replay now auto-plays with Play/Pause and a seek bar, animates both players' moves, and waits for attack reports before advancing |
| Mission sheets were hard to close or scroll, and the live map covered them | The sheet handle was decorative, touch scrolling was not enabled, and the map stayed at the board's top edge | The handle taps or swipes down to close, touch panels scroll, and the map moves above the tray |
| Deep Strike placement hid the required enemy distance | The placement panel showed the unit and Confirm but not its actual keep-away range | The panel now displays the unit's Deep Strike range from enemy units |
| Reinforcement placement showed only the normal distance around Knight Tyrant | Placement validation enforced Bastion of Corruption's 12" reserve denial, but the board guide used only the normal distance | Board rings now use the larger of the normal keep-away distance and each enemy's reserve-scrambler range; Infiltrate keeps its existing guide |
| Crushing Impact prompt stayed open after use | The skip button dismissed the panel, but using Crushing Impact did not record the same dismissal | Both using Crushing Impact and continuing without it dismiss the prompt for that unit this turn |
| Compound wargear text could become a fake item name | `parseWargearOption` kept the "is replaced with" sentence as a weapon choice | Extract the replacement item before canonicalising choices; regenerated faction data |
| Tzaangor Enlightened Malign Trickery and Prophesied Doom | Malign Trickery fell back to enemyMovedNear when sheet name was Tzaangor Enlightened; Prophesied Doom rolled 1 die when 0 models in ER | Keyed Malign Trickery for both base and unit-specific keys to opponentMovementEnd (12" range); added !n guard in activations.ts |
| Deep Strike / Reserves placement dragging lag | nudgePlacement ran up to 192 iterations per model on every pointer frame during onDraft | onDraft updates draft position and validation only; nudgePlacement executes on drag release (onDragEnd) with max 2 passes and 8 steps |
| LOS leak behind green walls and ruins | Target model behind green walls/ruins could be shot due to unit-aware standsIn disabling obscuring for all squadmates, missing t.box area blocker, and paper-thin WALL_HALF (0.04") corner grazing | Restricted standsIn unit-awareness to shooter (target uses modelStandsIn), added t.box as obscuring area blocker, and set WALL_HALF to 0.18" (matching rendered wall thickness, reducing 1,959 ray leaks to 0 across 25,339 layout tests). See R10: the shooter side should be per model too |

## How it was checked

- `git ls-files` with line counts; the engine core read in full.
- The official text: three reads of the Core Rules and the Rules Appendix on Wahapedia on 17 November 2026, each
  question answered with its section number; what could not be read is under "Not checked yet".
- Unused code: a scan of every export for a reference in another file, a walk of the imports from `src/main.tsx`,
  every style class name against `src`, and `npx tsc --noEmit -p . --noUnusedLocals --noUnusedParameters`.
- The suite before and after the removal: see the commit message of this audit for the counts.
