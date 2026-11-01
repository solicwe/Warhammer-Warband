---
name: campaign
description: Change or check Warhammer Warband's roguelite campaign: the map, battles and missions, rewards, Scrap, recruiting, the army tree, relics, the enemy's growth and old saves. Load for any campaign request (too hard, unbalanced, a node or relic that makes no sense, a save that breaks).
---

# The campaign

Design and reasoning: `docs/04-campaign-tree.md` (read its "Tree v3" section before touching the tree or relics).
Player view: the README's Campaign section.

## How it is built

| Part | Where | Notes |
|---|---|---|
| A run, the map, rewards, recruiting, relics | `src/engine/campaign.ts` | `Run`, `makeMap`, `makeOffer`, `takeReward`, `afterBattle`, `applyCampaign`, `RELICS`, `relicText`, `relicMaxLevel` |
| Battles | `campaignMission(node)` in `campaign.ts`, started in `src/ui/Campaign.tsx` | a normal battle: official primary, Tactical secondaries, 5 rounds, random Force Dispositions by the node's seed; both sides hold their secondary cards from round 1; idle tactic (`run.idleTactic`: 'objectives' or 'assault') selectable on the node and in battle |
| The army tree | `src/engine/campaignTree.ts` | 7 shared spokes, the army's branch, ring bridges, conversion keystones; `treeFor(army)`; swap pools (`SWAP`); `TREE_KEYS` / `effectKeys` |
| The army's own branches | `src/engine/campaignTreeArmies.ts` | `ARMY_KITS` per army (corps, arsenal, titan keystone); move lists per style; `WIDE` army-wide nodes |
| Keywords an army can field | `src/engine/treeFielded.ts` | written by `campaignTreeFit.test.ts` (`UPDATE_FIELDED=1`); never edit by hand |
| Enemy growth | `enemyTree`, `enemyTreePoints`, `enemyDetachments` | the enemy gets a tree as big as yours (+3 elite, +6 boss) |
| Screens | `src/ui/Campaign.tsx`, `ArmyTree.tsx`, `Relics.tsx` | |
| Old saves | `migrateRun`, `pruneTree` (`treeVersion`) in `campaign.ts` | |

## Rules that must stay true (tests enforce them)

- **Every node fits its army**: no node names a keyword the army cannot field (`campaignTreeFit.test.ts`).
- **The tree and relics never overlap**: the tree uses only `TREE_KEYS` (numbers and re-rolls); every relic gives
  only other keys (special rules), and no relic shares a name with a node.
- **Every node and every relic changes something in the engine** (`campaignTreeEngine.test.ts`).
- **Relic text is written from its effect** (`relicText`), at every level; a relic levels up only while a level
  changes something.
- **Army-wide nodes are small or conditional**, so a swap never makes one army stronger.

## Inventory first

- A node or relic idea: check the tree and relics do not already give it (`grep -n "<effect key>" src/engine/campaign*.ts`),
  and which side it belongs to (numbers and re-rolls: tree; special rules: relic).
- A balance worry: measure first (a run of campaign battles in `src/zz/`, or bot mirror games with campaign settings),
  then change one number at a time.

## Saves

- Changing what a saved id means (a node id, a relic id, a field) needs a migration in `migrateRun` / `pruneTree`:
  bump `treeVersion` (and `newRun`), give Renown or Scrap back rather than losing it, one story line, and a test that
  loads the old shape. Keep relic ids stable.

## Verify

`npx vitest run src/engine/campaign*.test.ts` (fit, tree, rules, relics, engine, a full campaign battle). After a
tree change also check the drawing: nodes keep 24 px apart on every army's tree (tested), and look at the tree screen
at phone width.

## Pitfalls seen before

- A relic test that checks eligibility with `eligibleByRule` misses relics that work through `canDo`; probe what the
  engine actually allows. Test army-wide relics on a unit that does not already have the rule (Intercessors, not
  Guilliman).
- A comment can promise a guard the code does not have: `triggerCampaignReinforcements` said "strictly when player
  has advantage" while it fired in every battle at round 3, losing or not, and the owner felt it every run. Read the
  condition, not the comment, and test the case the comment promises (`campaignRules.test.ts`, campaign events).
- Changing a price can break a test that relied on running out of Scrap (`campaign.test.ts`, combining squads): fix
  the test to ask for what it means, not for the old price.
