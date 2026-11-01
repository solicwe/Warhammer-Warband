# Warhammer Warband: read this first

A Warhammer 40,000 (11th edition) battle game that runs in the browser on a phone: army builder, rules engine, bot,
campaign, battle effects. React 19 + TypeScript + Vite, tests in Vitest. No server.

## Every task, in this order

Load the `start-here` skill (`.claude/skills/start-here/SKILL.md`) and follow it. In short:

1. **Understand** the ask. Restate it; list what is unclear.
2. **Inventory before building.** Find everything that already exists for it: code, data, docs, tests, earlier
   decisions. Read it. Never build a second system next to one that exists.
3. **Decide and write it down**: extend what exists, replace it (and delete the old), or build new (say why nothing
   fits). Put the decision in the reply and, for a design change, in the doc of that area.
4. **Build** the smallest complete change (the `ponytail` skill).
5. **Verify for real** (the `verify` skill): the checks that prove this change, with numbers, not "should work".
6. **Update the docs** the change touches (the `docs-sync` skill), then commit and push.

## Skills (in `.claude/skills/`)

| When the task is about | Load |
|---|---|
| anything (always first) | `start-here` |
| proving a change works | `verify` |
| README, ARCHITECTURE, docs/ | `docs-sync` |
| an ability, stratagem, detachment, army rule, a faction's data | `rules-data` |
| the bot: moves, roles, targets, stratagems, speed, strength | `bot` |
| the campaign: map, rewards, army tree, relics, saves | `campaign` |
| screens, layout, touch, accessibility, performance of the page | `ui` |
| battle effects: weapons, melee, abilities, Rituals | `vfx` |
| writing the code itself | `ponytail` |

The reference docs those skills point to: `ARCHITECTURE.md` (layers, hooks, rules pipeline), `AI_GUIDE.md`
(step lists for common changes), `docs/EDITING.md` (which data file holds which rule), `docs/RULES_STATUS.md`
(which rules run), `docs/04-campaign-tree.md` (tree and relic design), `docs/01-rules-11e-reference.md` (the rules).

## The owner's standing rules

- Reply in Thai. Plain words; no emoji anywhere (code, docs, commits, replies).
- Smallest complete change; end every reply with what was skipped or not checked, and the risks.
- Do not rewrite rules, docs or features beyond what was asked.
- Branch `claude/warhammer-11e-mobile-sim-njcblr`. Before every push run
  `git remote set-url origin https://github.com/solicwe/Warhammer-Warband`. Push the branch; fast-forward `main`
  (`git push origin <branch>:main`) only after the full test suite passes.
- Commit messages end with the Co-Authored-By and Claude-Session lines the session gives; no model names in commits.
- `src/zz/` is scratch (sheets, benches, one-off games): it is git-ignored, never committed, deleted when done.
- Kill a process by its PID, never by a name pattern. Never disable TLS. Do not `git stash` while tests run.
- The engine is deterministic: never `Math.random()` in `src/engine/`.
