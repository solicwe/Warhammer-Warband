# Campaign: the army tree

Status: being built. It replaces Battle Honors, unit experience and ranks, and the old 9-node tech tree per family,
with one passive tree for the whole army, in the spirit of Path of Exile's passive tree and Diablo's paragon board.

## Why

Per-unit progression (experience, ranks, honors bought per datasheet) grows with the army: ten units means ten
things to level and ten menus to visit after each battle. One army tree is one decision per battle, and its nodes
reach units through keywords (INFANTRY, VEHICLE, CHARACTER, MONSTER, BATTLELINE...). A new recruit gets everything
that already applies to its keywords.

## Currency

- **Renown** is earned by the army, never by units: battle 3, elite 5, boss 6, a loss 1. A new run starts with 3.
  One sector (about 6 fights) gives about 25 Renown.
- Each Renown point allocates one node. The tree has about 115 nodes, so one sector fills a fifth of it and each run
  has to pick a direction.
- **Scrap** stays as it is: recruits, wargear, enhancements, detachments. The tree never costs Scrap.
- **Respec**: at an armory or a medicae tent, refund one node for Scrap (20, then 10 more for each refund in the
  run). A node can only be refunded if everything else stays connected to the start.

## Shape

A graph, not tiers. The start is the centre; a node can be taken once it links to a taken node.

- **Eight slots** around the start: seven shared spokes and the army's own branch.
- **Spoke**: a main line of 7 nodes (small, small, notable, small, small, notable, keystone) and two side clusters
  of 3 nodes (two small and a notable), one leaving at depth 2 and one at depth 5. 13 nodes.
- **Inner ring**: a bridge node between each pair of neighbouring slots at depth 4, so a build can cross into the
  next spoke halfway out instead of walking back to the centre.
- **Outer ring**: a keystone between the tips of neighbouring shared spokes. These keystones convert keywords.

| Spoke | Theme |
|---|---|
| Fire | ranged hit, wound, AP, range |
| Assault | melee attacks, strength, charge |
| Armour | toughness, saves, Feel No Pain |
| Speed | move, advance, charge re-rolls |
| Command | CP, Leadership, battle-shock, CHARACTER |
| Objectives | OC, BATTLELINE, holding ground |
| Logistics | Scrap income, VETERAN units, titanic requisition |

## Node kinds

- **Small**: one small number for one keyword group. "+1\" Move for MOUNTED units".
- **Notable**: a named rule at the end of a short run. Some have a **threshold bonus** (Diablo style): an extra
  effect once enough nodes of the same spoke are taken ("+1 Damage when 6 Assault nodes are allocated"). Some are
  **round-conditional**: active only in rounds 1-2 (alpha strike) or from round 3 on (the long game).
- **Keystone**: changes how the army plays, with a cost ("all weapons +1 Damage; all units -1 to saving throws").
- **Conversion keystone** (outer ring): a keyword counts as another for the tree. "Mechanised Infantry: INFANTRY units
  also count as VEHICLE for tree nodes."

Every effect uses the existing `Effect` fields, so the engine and the bot need no new rules code. CP and Scrap
nodes are read by the campaign code.

## The army's own branch

Hybrid design: the big shared tree is the same for every army; the eighth slot is a branch of 10 nodes for the
army itself, using its real keywords and leaning on its army rule.

- First: a branch per family (Imperium, Chaos, Necrons, Orks, Tyranids, other Xenos) so every army has one now.
- Then: a branch for each army, five at a time, starting with Space Marines, Thousand Sons, Orks, Necrons and
  Tyranids. An army without its own branch uses its family's.

## VETERAN

No screen, no button. A unit that has fought 3 battles gets the VETERAN tag in the roster, and tree nodes that name
VETERAN reach it. A unit led by a VETERAN character, or leading a VETERAN squad, counts as VETERAN in battle.

## What is removed

- `BATTLE_HONORS` and everything that buys or shows them, `xp`, `honors`, the ranks and `rankCombatBonus`, the
  auto-upgrade, and `FACTION_TECH_TREES`. Titanic units are unlocked by the Logistics keystone instead of tier 4.
- Old saved runs: honors and experience are dropped, the old tech nodes too; the run gets Renown equal to its wins
  x 3 plus 3, and each unit keeps its battles count from its old experience.

## Later

- Enemy trees: elites and bosses get tree points (elite = loop x 3, boss = loop x 6) spent by a bot along one spoke.
- Relic sockets on the ring that change the nodes around them.
- A list view of the tree for people who prefer reading.
- Balance pass with bot-against-bot runs.
