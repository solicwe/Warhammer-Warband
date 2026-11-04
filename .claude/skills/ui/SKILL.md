---
name: ui
description: Change or check Warhammer Warband's screens: home, army builder, battle setup, the battle screen and board, the campaign screens, sheets and menus, touch controls, accessibility, saving, and how fast the page runs on a phone. Load for any request about how something looks, where a button is, a layout bug, or lag.
---

# Screens

## How it is built

| Screen | File |
|---|---|
| Routing between screens | `src/ui/App.tsx` |
| Home (army library) | `src/ui/Home.tsx`, `library.ts` |
| Army builder | `src/ui/ArmyBuilder.tsx`, `loadout.ts` |
| Battle setup | `src/ui/BattleSetup.tsx` |
| Battle | `src/ui/GameScreen.tsx` (phases, sheets, bot driving, idle), `Board.tsx` (SVG battlefield), `Hud.tsx`, `DiceTray.tsx`, `AttackReport.tsx`, `MapCam.tsx` |
| Effects | `src/ui/BattleFx.tsx` (load `vfx`) |
| Campaign | `src/ui/Campaign.tsx`, `ArmyTree.tsx`, `Relics.tsx` |
| Rule text | `src/ui/RuleText.tsx`, `RuleTable.tsx`, `AbilityBadgePopover.tsx` |
| State and undo | `src/ui/store.ts` (`useGame`: each action clones the state and applies one engine call) |
| Saves | `src/services/storage.ts` (`localStorage`: armies, the battle in progress, the campaign, settings) |
| Look and tokens | `src/ui/styles.css` (colour tokens at the top), `Icon.tsx` (SVG icons, no emoji) |

## Standards (from the README; keep them)

- Phone first: it must work at about 390 px wide in portrait; then check a desktop width.
- WCAG 2.2 AA: text 4.5:1 contrast (colours from the tokens; mix a faction colour toward `--text` before using it as
  text), touch targets 44 px where there is room and never under 24 px, no text under 11 px, page zoom left on.
- Icons from `Icon.tsx`, never emoji.
- The screen never blocks while the bot thinks: the bot runs in the worker (`lookWorker.ts`).

## Inventory first

- Find the component and the CSS class that draw the thing (`grep -rn "<visible text>" src/ui`), and check whether a
  shared component (Sheet, RuleText, Icon, the card styles) already does what you need.
- Read the README section of that screen: it is what players are told.

## Verify

- Screenshot at phone width with Playwright (`devices['iPhone 13']`, dark colour scheme) against `npx vite --port 5179`;
  read the image; compare before and after. Kill vite by PID.
- Lag: measure, do not guess. Effects: time a frame (`verify`). The board: React re-renders per state change
  (`useMemo` on `s` in `GameScreen.tsx`); the bot: the worst step (`bot`).
- `npx vitest run src/ui` for the UI tests.
- The board alone, any layout, in seconds: `src/zz/board.html` + `board.tsx` that fetches `/data/factions/SM.json`,
  calls `createGame({ ..., deploymentId: '<layout id>' })` and renders `<Board s={s} viewer={0} />` full screen; open
  `http://localhost:5179/src/zz/board.html`. For all 45 layouts at once, a vitest in `src/zz/` that writes an SVG of
  `buildTerrain(id)` (plates, raw walls from `data/layouts.json` in red, built walls and boxes on top), then screenshot it.

## Pitfalls seen before

- The army-buff cards are HTML in a `foreignObject` (`Board.tsx`, `.table-cards`). Two traps, both seen:
  a CSS `transform` scaling that HTML clips the cards wrongly (confirmed in Chromium; scale on the SVG side with
  `<g transform>`), and with nothing painted under the cards Chrome left their old positions on screen while the map
  panned (the owner's screenshots: slivers of the card's coloured left border and the header line, only beside the
  board, never on it, because the board's own picture moves with the camera and gets repainted). A strip of the board
  colour under each card column fixes the second (November 2026, fix inferred from the screenshots; headless
  Chromium repaints everything and cannot show it).
- The army-buff cards are not drawn on phones (`isMobileScreen` in `GameScreen.tsx`): iOS Safari draws HTML in an SVG
  as empty boxes. A phone screenshot cannot show a bug in them; use a desktop viewport (1366 x 768).
- Paint bugs (ghosts, trails) often do not show in headless Chromium, which repaints everything. Check the layout
  there, then look for the cause in the code (transforms, filters, `will-change` inside SVG) rather than waiting for a
  screenshot to show it.
- Getting to a battle screen quickly: in a Playwright page on the dev server, write armies from
  `await import('/src/ui/presets.ts')` into `localStorage['w40k11-armies']`, start a **Bot vs Bot** battle and press
  Fast. Editing the save during deployment can leave the battle stuck.
- A hook after an early return (`if (done) return null;` above a `useState`) crashed the battle screen with React
  error #300 the moment the condition changed (`DiceTray.tsx`, when an attack finished). Put every early return
  below the last hook; `src/ui/hooksOrder.test.ts` checks every component in `src/ui`.
- A component file nothing imports can sit for weeks (`UnitActionBar.tsx`, with its CSS): before styling a screen,
  check the component is actually rendered (`grep -rn "<Name" src/ui`).
- The Fight phase is the one phase where the player who is not active acts (they fight back). A guard like
  `selUnit.owner !== s.active` (the quick actions in `GameScreen.tsx`) hid the Fight button from the defender; check
  `fightCandidates(s).player` there instead.
- The live map (`MapCam.tsx`) went through three designs in one week (cover >55%, follow the action, then this one);
  the owner's current wish: a picked unit is shown zoomed whenever a sheet is up; nothing picked, the whole board
  while the sheet hides most of it; no caption, never over the dice tray, no panning or pinching inside it (dragging
  moves the window). Ask before changing it again.
- The board's zoom-out must never lock panning: when the view outgrew the table I pinned the table in place and the
  owner could not drag it any more. The clamp in `Board.tsx` lets the view hang half off the table at every zoom.
- `ModelToken` in `Board.tsx` has a hand-written memo comparator: a new field that changes how a model is drawn
  (its facing `rot` was missing, so turning a vehicle in place showed nothing until it moved) must be added there.
- A terrain shape that looks wrong on the board ("the green L should be a box") is usually made in `buildTerrain`
  (`src/engine/game.ts`), not drawn wrong in `Board.tsx`: the layouts are traced outlines, and the clean-up passes
  there turn them into walls. The small solid blocks (4 per layout: plain on the strip plates, stepped or
  cross-shaped on the small plates) were traced as outlines and the stub pass made them Ls; the owner wants boxes, so
  `outlineBox` keeps each as the piece's `box` (November 2026). A box changes play: `autoApproach` had to learn to
  keep models off it (pile-in failed whole otherwise), and random test setups can land on one (skip those).
