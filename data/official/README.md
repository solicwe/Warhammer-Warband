# Official rules documents (local only)

Put the Games Workshop PDFs here (Core Rules, Rules Appendix, faction packs, Chapter Approved mission pack, FAQs and
errata), downloaded from <https://www.warhammer-community.com/en-gb/downloads/warhammer-40000/>.

Everything in this folder except this file is git-ignored: Games Workshop material is never committed. Then run

    npm run rules:text

to turn each PDF into a `.txt` next to it. `npm run rule -- "<name>"` searches those texts together with the card
data and the code, so a rule can be checked against the official wording in one step. See `docs/RULES_WORKFLOW.md`.
