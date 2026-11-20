# Working on a rule

How to add, fix or check a rule without guessing. The step lists for each kind of rule are in `AI_GUIDE.md`, the data
files in `docs/EDITING.md`; this page is the loop around them.

## The official text

The rules come from Games Workshop's downloads: <https://www.warhammer-community.com/en-gb/downloads/warhammer-40000/>
(Core Rules, Rules Appendix, the faction packs, Chapter Approved, FAQs and errata).

1. Download what you need into `data/official/` (git-ignored: Games Workshop material is never committed).
2. `npm run rules:text` turns each PDF into a `.txt` next to it (needs `pdftotext` from Poppler).

A number or a wording is never written from memory: it is checked against these documents. Where the code and the
text differ on purpose, the owner decided it: see "Owner decisions" in `.claude/skills/start-here/SKILL.md` and
`docs/05-tech-debt.md`.

## The loop

1. **Look it up:** `npm run rule -- "<name>"` (add `--faction TS` to narrow it). One report with the card text, the
   rule data entry (`data/abilities`, `data/stratagems`, `data/overrides`, `data/detachment-rules.json`), every line of
   code and every test that mentions it, and the official text if `data/official/*.txt` has it.
2. **Decide:** data first (`AI_GUIDE.md`), a faction module in `src/factions/` only for state. Never an invented rule.
3. **Change it:** the data file, or the module registered in `src/factions/index.ts`. Wrong datasheet numbers go in
   `data/overrides/<ID>.json`, then `npm run data` rebuilds `public/data` (check `git diff --stat public/data`: only
   the faction you meant should change).
4. **Test it:** a case in that faction's test file that builds the unit and checks the number the rule changes.
5. **Check the data as a whole:** `npm run rules:check` (about 5 seconds; the 25 minute detachments test is left to the full suite). It fails on an unknown key, condition or
   trigger, on a stale `docs/RULES_STATUS.md` (`UPDATE_STATUS=1 npx vitest run src/engine/rulesStatus.test.ts`
   rewrites it), on an enhancement nobody can take, on a stratagem TARGET that fits no unit, and on a layer break.
6. **Try it in the game:** the Test range (a small empty table, pick it in New battle) for shooting and rules; or
   build the game from the browser console and press Continue (`.claude/skills/ui/SKILL.md`, "Testing a battle screen quickly").
7. **Full suite before `main`:** `npx vitest run --maxWorkers=4` (20 to 35 minutes).

## Where things are

| You want | Look at |
|---|---|
| a card's text as the game has it | `public/data/factions/<ID>.json` (generated: never edit) |
| what a rule does | `data/abilities/<ID>.json`, `data/stratagems/<ID>.json`, `data/detachment-rules.json` |
| a wrong number on a datasheet | `data/overrides/<ID>.json` |
| a rule with state (tokens, dice, marks) | `src/factions/<faction>.ts` |
| who may take an enhancement / who a stratagem targets | `enhancementFits` in `src/engine/army.ts`, `stratTargetOk` in `src/rules-engine/stratagems.ts` |
| which rules run | `docs/RULES_STATUS.md` (built by a test) |
