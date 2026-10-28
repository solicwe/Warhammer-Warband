# Campaign: one deep army tree (proposal)

Status: proposal, not built. It replaces Battle Honors, unit experience and ranks with a single passive tree for
the whole army, in the spirit of Path of Exile's passive tree and Diablo's paragon board.

## Why

Per-unit progression (experience, ranks, honors bought per datasheet) grows with the army: ten units means ten
things to level and ten menus to visit after each battle. A single army tree is one decision per battle, and its
nodes reach units through keywords (INFANTRY, VEHICLE, CHARACTER, MONSTER, BATTLELINE...). A new recruit gets
everything that already applies to its keywords.

## Currency

- **Renown** is earned by the army, never by units: win 2, draw 1, loss 1, elite +1, boss +2.
- Each Renown point allocates one node. A first loop (about 9 battles) gives about 15 points. The tree has about
  90 nodes, so one run fills a sixth of it. Each run has to pick a direction.
- **Scrap** stays as it is: recruits, wargear, enhancements, detachments. The tree never costs Scrap.
- **Respec**: at an armory or medicae node, refund one node for Scrap (cost rises with each refund in a run).
  A node can only be refunded if the rest stays connected to the start.

## Shape

A graph, not tiers. The start is the centre; a node can be taken once it is linked to a taken node.

```
                 [Logistics]
                      |
     [Command] ---- START ---- [Assault]
        |           /    \         |
  [Objectives]  [Fire]  [Armour] [Speed]
```

Seven spokes leave the centre, each about 12 nodes deep, with cross-links on the outer ring so late builds can
mix two neighbouring spokes:

| Spoke | Theme | Example keywords |
|---|---|---|
| Fire | ranged hit, wound, AP, range | all, or INFANTRY / VEHICLE branches |
| Assault | melee attacks, strength, charge | INFANTRY, MONSTER, MOUNTED |
| Armour | toughness, saves, FNP, wounds | VEHICLE, MONSTER, TERMINATOR |
| Speed | move, advance, charge rerolls, deep strike | MOUNTED, FLY, JUMP PACK |
| Command | CP, stratagem cost, battle-shock, leadership | CHARACTER, whole army |
| Objectives | OC, sticky objectives, actions | BATTLELINE, INFANTRY |
| Logistics | Scrap income, recruit discount, titanic unlock | none (run-level) |

## Node kinds

- **Small** (about 70% of nodes): one small number for one keyword group. "+1\" Move for MOUNTED units",
  "INFANTRY: +1 Leadership". Cheap stepping stones.
- **Notable** (about 25%): a named rule at the end of a short branch. "Gun Line: INFANTRY that Remained
  Stationary re-roll Hit rolls of 1". "Hammer Blow: CHARACTER melee weapons have [LETHAL HITS]".
- **Keystone** (one at the tip of each spoke, plus two on the ring): changes how the army plays, with a cost.
  - *Glass Cannon*: all weapons +1 Damage; all units -1 Save.
  - *Iron Discipline*: no unit can Advance; ranged attacks +1 to Hit.
  - *Endless Ranks*: destroyed BATTLELINE units return once per battle at half strength; -1 CP each round.
  - *Titan Requisition*: Knights, Titans and other TITANIC units can be recruited; Scrap income -25%.

Every effect uses the existing `Effect` fields (`hit`, `ap`, `defend`, `units` keyword filter and so on), so the
engine and the bot need no new rules code for small nodes and most notables.

## Faction flavour

Small nodes are shared by all factions. Notables and keystones come in six families (Imperium, Chaos, Necrons,
Orks, Tyranids, other Xenos), using the family list the current tech tree already has: same position, different
name and effect. That is about 7 x 4 notables x 6 families = 170 named nodes to write, not 6 whole trees.

## Enemy scaling

Elite and boss enemies get tree points too: elite = loop x 3, boss = loop x 6, spent by a simple bot that follows one
spoke. The player sees the enemy's allocated keystones on the node card before the fight.

## Phone UI

- A full-screen tree with the same pan and pinch as the battle map. Taken nodes lit, reachable nodes outlined,
  the rest dim.
- Tap a node: a card with its effect, which of your units it reaches ("Applies to 4 units: ..."), and Allocate.
- A list view as an alternative for people who prefer reading: spokes as sections, nodes in path order.
- The army-buffs card in battle shows everything the tree grants, grouped by keyword.

## What is removed

- `BATTLE_HONORS`, `buyHonorForUnit`, `getSmartBattleHonors`, `datasheetHonorCost` and their UI section.
- `xp`, `honors`, rank labels (Recruit, Blooded...) and `rankCombatBonus`.
- The current 9-node tech tree per family (its effects move into the new tree).

Old saved runs: honors and experience are dropped; the run is given Renown equal to its battles won x 2, so nothing
is lost in value.

## Building it, in order

1. Data file `data/campaign-tree.json` (nodes, links, positions, effects) and a test that every node is reachable,
   every effect is a valid `Effect`, and each family has its notables.
2. Engine: Renown, allocate, refund, apply to units by keyword (replaces the tech tree and honor code).
3. Remove honors and experience; migrate old runs.
4. Phone UI: tree view, node card, list view.
5. Enemy trees for elites and bosses.
6. Balance pass with bot-against-bot runs (win rate per loop with and without the tree).
