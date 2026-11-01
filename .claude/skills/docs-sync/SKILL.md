---
name: docs-sync
description: Keep Warhammer Warband's README (the GitHub page), ARCHITECTURE.md, AI_GUIDE.md, docs/ and the .claude skills true after a change. Load after any change a player or developer would notice, and before committing.
---

# Keep the docs true

The README is the project's GitHub page: players read it to learn what the game does, developers to learn how to run
and change it. A doc that describes something that no longer works is worse than no doc.

## What to update for what

| The change | Update |
|---|---|
| Something a player sees or does differently (a mode, a screen, a rule of play, the campaign) | README: the section of that feature (Playing, How the battle works, Building an army, Reading the rules, Campaign, On your phone, Saves) |
| A rule now runs, or stops running | `docs/RULES_STATUS.md` (counts and the per-faction lists) |
| A data file moved or a new kind of rule data | `docs/EDITING.md`, `AI_GUIDE.md`, `ARCHITECTURE.md` (Data table) |
| A new hook, event, layer or module | `ARCHITECTURE.md` (Events, Modifiers, Other extension points, Layers) |
| A common change got a new step | `AI_GUIDE.md` |
| Campaign tree, relics, saves | `docs/04-campaign-tree.md` (design, then "How it is checked"), README Campaign |
| Bot behaviour or strength | `ARCHITECTURE.md` (The bot), `docs/03-bot-competitive.md` if it is about CP and stratagems, the `bot` skill |
| Battle effects | the `vfx` skill (styles table, parts list) |
| A new way to verify something, a new scratch harness | the `verify` skill |
| The workflow, the owner's rules | `CLAUDE.md`, the `start-here` skill |
| A bug or debt item found or fixed, an audit | `docs/05-tech-debt.md` |
| Something learned the hard way (a trap, a skill line that was wrong, a faster check) | the area skill: "Pitfalls seen before", or fix the wrong line (`start-here`, step 7) |
| New screenshots of a changed screen | `docs/images/*.jpg` referenced from the README table |

## How the docs are written

- English for README, ARCHITECTURE, AI_GUIDE and the skills (the GitHub audience); `docs/02`, `docs/03` and
  `docs/EDITING.md` are in Thai and stay so.
- Plain words, short sentences, no emoji, no marketing. Say what it does and where it lives.
- Numbers that change (node counts, test counts, factions) are written as "about" or checked when you touch them.
- A design change gets its reasoning in the area's doc ("why", not only "what"), so the next session does not undo it.
- Do not rewrite sections you did not change.

## Check before committing

- `grep -n "<old name>" README.md ARCHITECTURE.md AI_GUIDE.md CLAUDE.md docs/*.md .claude/skills/*/SKILL.md` for
  every name, number or path you changed.
- Links in the README point to files that exist (`ls` them).
- The README's developer section still matches `package.json` scripts.
