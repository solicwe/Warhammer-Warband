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
| Battle | `src/ui/GameScreen.tsx` (phases, sheets, bot driving, idle), `Board.tsx` (SVG battlefield), `Hud.tsx`, `UnitActionBar.tsx`, `DiceTray.tsx`, `AttackReport.tsx`, `MapCam.tsx` |
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
