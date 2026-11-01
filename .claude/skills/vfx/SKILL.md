---
name: vfx
description: Design, audit and build battle effects (VFX) for Warhammer Warband in src/ui/BattleFx.tsx. Use when adding or changing a weapon, ability, Ritual or board effect, or when the user says an effect looks weak, unclear, too big, smoky or the same as another.
---

# Battle VFX for Warhammer Warband

Effects are SVG drawn every frame by `FxLayer` (src/ui/BattleFx.tsx) over a board seen at phone size. They must read in
under a second, at a glance, on a small screen, without slowing the game.

## Principles (what every effect gets checked against)

1. **Three parts, always separate**: wind-up (anticipation, 0-15% of the time), release (the hit: 10-45%), aftermath
   (residue that fades: 40-100%). Write them as separate blocks so each can be tuned alone.
2. **Shape language says what it is** before colour does: forks and zigzags = energy (warp, power fields); vertical
   rays and halos = faith; brackets, chevrons and dashed rings = command and orders; right angles and scan lines =
   technology; domes and facets = shields; spikes and an 8-point star = Chaos; slashes and cracks = rage; bubbles and
   buzzing specks = plague; concentric glyph rings and rising beams = Necron; a ground stomp = Orks.
3. **One identity per effect**: no two abilities or weapons may share the same silhouette. Colour alone is not enough.
4. **Impact over haze**: a bright white core for one or two frames, then the colour. Soft drifting wisps read as smoke;
   use them only as a short trail, never as the main event.
5. **Scale to the source**: an effect is about the size of the model or unit that makes or takes it. Zoomed out it may
   grow a little (`VIS`, up to 1.6x), never as fast as the board shrinks. Helpers multiply by `VIS` themselves: do not
   pass a size that already includes it (blasts were once scaled twice).
6. **Budget**: about 20 shots per attack, 30 frames a second, cheap shapes (line, polyline, circle) before textured
   sprites. Under ~250 elements for a big attack frame.
7. **Readable label**: an ability shows its name in the effect's colour with a dark outline, above the effect.

## Inventory first (start-here applies)

Before adding an effect, list what exists and reuse it:

- Weapon looks: `WeaponFx` in `src/engine/weaponFx.ts` (bolt, heavyBolt, gatling, shoota, shotgun, sniper, pulse,
  plasma, las, melta, volkite, grav, lightning, psychic, flame, missile, shell, gauss, shuriken, bio, sonic, cryo;
  melee slash, power, chain, claw, crush). `weaponFx(weapon, profile)` picks one from the name and abilities;
  `weaponPow` sizes it; `flameTint` colours warp and daemon fire. Each kind is a `case` in `AttackFx` (BattleFx.tsx).
- Board events: `FxView` in BattleFx.tsx routes each `FxEvent` kind (attack, mortal, explosion, place = deep strike,
  shock, heal, move = charge, roll, ritual, extract, skill).
- Abilities: `SkillFx` (big, once per battle) and `SkillLite` (often used) both draw `styleLayers(style, ...)`.
- Scale: `VIS` (board zoom, set by `FxLayer` from `viewW`) and `TRACE` (shots, a little thinner). Use these; never a
  second scale.

## The parts available (BattleFx.tsx)

Glow (soft light), Sparks, Debris, DustRing, Puff (smoke), Sprite (fire, smoke, flash textures), Wisp (energy haze,
use sparingly), Arcs (forked crackling energy), Shockwave (hard ring snapping out), Explosion, LightColumn, Muzzle.

## Ability styles (SkillStyle, picked by `skillStyle` in src/engine/state.ts)

| style | who | wind-up | release | aftermath |
|---|---|---|---|---|
| holy | Imperium faith, default | a beam narrows from above | white-gold flash, halo with ticks, light pillar | gold motes rise |
| command | orders, oaths, rites, doctrines | four corner brackets close on the hero | brackets lock, chevrons fly out, double sonar ping | dashed ring turns and fades |
| psychic | psykers, warp powers | arcs crawl inward | white flash, two shockwaves, forked arcs | sparks |
| chaos | Chaos (not Khorne, not Nurgle) | an 8-point star grows from the hero | the star flares, red flash, hard ring | embers, the star turns and fades |
| fury | Khorne, berserkers, rage | red cracks run along the ground | five slashes across, blood, shockwave | dark drops |
| waaagh | Orks | a green glow pumps bigger | stomp: three quick green rings, big dust, rubble | green sparks bounce |
| tech | Techmarines, vehicles, Mechanicus, T'au, Votann | a radar sweep turns | cyan flash, circuit traces at right angles, grid ping | blinking data squares |
| shield | defensive abilities | a ring forms | a faceted dome flashes | ripples spread |
| plague | Death Guard, Nurgle, contagion | green bubbling | a burst of bubbles and a cloud of flies | bubbles rise and pop |
| necron | Necrons | two glyph rings turn against each other | green flash, beams rise | the glyph ring fades |

Rituals (Thousand Sons) each have their own: Doombolt (a bolt and a blast), Destiny's Ruin (an eye closes on the
target), Twist of Fate (a spiral winds in), Temporal Surge (a clock face, hands spinning backwards).

## How to check a change (see also the verify skill)

Render a sheet: a page under src/zz (never committed) that draws `FxView` for each effect at two or three moments,
with the board at `viewW={44}` (a phone zoomed out), screenshot it with Playwright, and look at it. Compare every
effect against the principles above, and send the sheet to the user.

## Pitfalls seen before

- Blasts twice too big: `Explosion` scaled by `VIS` and then passed the scaled size to helpers that scale by `VIS`
  again. Pass `big / VIS` to the helpers; scale once.
- A new module-level name clashed with an existing record (`SHOT`); the shot scale is `TRACE`. Grep a name before
  adding it to `BattleFx.tsx`.
- The owner judges effects at phone zoom on a real board; a sheet at `viewW={44}` shows size problems that a close-up
  hides.
