# แก้ / เพิ่ม / ลบ กฎ — คู่มือไฟล์ข้อมูล

กฎทั้งหมดของเกมอยู่ในไฟล์ JSON ข้างล่าง แก้แล้วรัน `npm test` เพื่อเช็ก แล้ว `npm run artifact` เพื่อ build ใหม่
ตอนนี้โฟกัส **Space Marines (SM)**, **Orks (ORK)** และ **Adeptus Custodes (AC)** — faction อื่นใช้ได้แต่ระบบอ่านจากข้อความการ์ดเท่าที่อ่านได้

| อยากแก้อะไร | ไฟล์ |
|---|---|
| ค่าบนการ์ด (M/T/Sv/W, อาวุธ, แต้ม, keyword) | `data/overrides/<FACTION>.json` (ดู `data/overrides/README.md`) — อย่าแก้ `public/data/factions/*.json` ตรง ๆ เพราะถูกสร้างใหม่จาก Wahapedia |
| **Space Marines (Codex 2026)** | `data/packs/SM.listforge-pack.json` (ไฟล์ ListForge) + `data/packs/SM.cards.txt` (การ์ด stratagem) — `npm run data` สร้าง SM จาก pack นี้แทน Wahapedia (ดู `scripts/pack.mjs`) |
| **Adeptus Custodes (Codex 2026)** | `data/packs/AC.listforge-pack.json` — Martial Ka'tah (readied) อยู่ใน `data/detachment-rules.json` key `Martial Ka'tah` |
| Ability ของ datasheet | `data/abilities/SM.json`, `data/abilities/ORK.json`, `data/abilities/AC.json` |
| กฎ Detachment / Army rule | `data/detachment-rules.json` |
| **Stratagem ของ detachment** | `data/stratagems/SM.json`, `data/stratagems/ORK.json`, `data/stratagems/AC.json` |
| Core rules, core stratagems (Command Re-roll ฯลฯ) | `data/core-rules.json` |
| Mission, secondary, terrain kind | `data/missions.json` |
| แผนที่ (layout, objective, ruin) | `data/layouts.json` |

## Stratagem (`data/stratagems/<FACTION>.json`)

key = ชื่อ stratagem ตามการ์ด (ตัวพิมพ์ใหญ่) หรือ `ชื่อ@Detachment` ถ้าชื่อซ้ำกัน
ถ้าไม่มี entry ระบบจะอ่านจากข้อความ EFFECT เอง (`src/engine/stratagems.ts`) — เขียน entry เมื่ออ่านไม่ได้หรืออ่านผิด

```json
"ARMOUR OF CONTEMPT": { "buffs": ["enemyAp-1"] },
"KRAKEN ROUNDS": { "effects": [{ "attack": "ranged", "ap": 1 }, { "rangeBonus": 6 }] },
"FURIOUS DEDICATION": { "effects": [{ "chargeBonus": 2 }, { "attack": "melee", "attacks": 1 }], "until": "turn" },
"BREAKIN' HEADS": { "do": [{ "mortals": "D3" }, { "unshock": true }] },
"SQUAD TACTICS": { "do": [{ "move": "D6" }], "status": "partial", "note": "6\" ถ้าอยู่ใต้ Tactical Doctrine: ทำเอง" }
```

| ฟิลด์ | ความหมาย |
|---|---|
| `buffs` | buff ด่วน: `hit+1 wound+1 ap+1 lethal sustained1 devastating ignoresCover rerollHits rerollHits1 rerollWounds rerollWounds1` / ฝ่ายรับ `enemyHit-1 enemyWound-1 enemyAp-1 damage-1 fnp4 fnp5 fnp6 cover save+1` |
| `effects` | อะไรก็ได้ที่ ability ทำได้ (ดู `Effect` ใน `src/engine/effects.ts`): `hit wound ap strength attacks damage reroll abilities if` (โจมตี), `defend: { hit, wound, woundIfStronger, ap, damage, fnp, inv, minHit, vs }` (โดนโจมตี), `move chargeBonus advanceBonus oc toughness mobile stealth riled eligible fightOnDeath rangeBonus forceDesperate …` |
| `do` | ทำทันที (ดู `Action` ใน `src/engine/activations.ts`): `move`, `surge`, `mortals`, `heal`, `reserves`, `secure`, `unshock`, `shock`, `noCharge` … |
| `until` | `phase` (ค่าเริ่มต้น) / `turn` / `nextCommand` |
| `bot` | `attack` / `defend` / `never` — ปกติระบบเดาให้: มีผลกับการโจมตี = attack, มีผลตอนโดนโจมตี = defend |
| `status`, `note` | `auto` / `partial` / `manual` และข้อความบอกผู้เล่นว่าส่วนไหนต้องทำเอง (โชว์บนการ์ด stratagem) |

เงื่อนไขใน `if`: `targetMV targetCharacter targetInfantry targetFly targetBelowStarting targetOnObjective targetBattleShocked within:9 beyond:12 detActive:assault plasmaWeapon charged riled onObjective …` (ดู `cond()` ใน `effects.ts`)

**บอท** ใช้ stratagem ทุกตัวที่ `bot` เป็น `attack`/`defend` เอง: ลองใส่ผลแล้วคำนวณดาเมจที่คาดว่าจะทำได้/เสียไป ใช้ตัวที่คุ้ม CP ที่สุด ส่วน `do` (เดิน, reserves ฯลฯ) ผู้เล่นกดใช้จากหน้า Stratagem

TARGET ของ stratagem เช็กจาก keyword ตัวพิมพ์ใหญ่บนการ์ด (เช่น `That MEGANOBZ/NOBZ unit`) ถ้าหน่วยไม่ตรงจะใช้ไม่ได้

## Ability (`data/abilities/<FACTION>.json`)
key = ชื่อ ability (หรือ `ชื่อ@Datasheet`) ค่า: `effects` (เหมือนข้างบน + `scope: unit | model | led | aura | enemyAura`, `range`), `act` (ปุ่ม/trigger: `when`, `limit`, `target`, `do`) — ดูตัวอย่างในไฟล์

## Detachment (`data/detachment-rules.json`)
key = ชื่อ detachment: `effects`, `choice` (เลือก doctrine ฯลฯ), `grants` (ให้ ability กับหน่วย), `freeDie`, `auto`

Combat Doctrines (army rule ของ SM) อยู่ใน key `Combat Doctrines` — detachment เพิ่มจำนวนครั้งที่เลือกได้ด้วย `doctrineExtra` และบังคับ doctrine ให้หน่วยด้วย `doctrines` (เช่น Wrath of the Doomed)

Enhancement: เขียนกฎใน `data/abilities/<FACTION>.json` ด้วยชื่อ enhancement (ทำงานเหมือน ability ของตัวที่ถือ)

## Faction / datasheet ใหม่
1. `npm run data -- --fetch` ดึงข้อมูลล่าสุดจาก Wahapedia (หรือวาง CSV ใน `data/raw`)
2. แก้ค่าที่ผิดด้วย `data/overrides/<FACTION>.json`
3. เพิ่ม `data/abilities/<FACTION>.json` และ `data/stratagems/<FACTION>.json` แล้ว import ใน `src/engine/effects.ts` (`FACTION_RULES`) และ `src/engine/stratagems.ts` (`BOOKS`)

## รูปภาพหน่วย
ดู `public/images/README.md`
