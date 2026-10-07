# Warhammer 40,000 11th Edition — Mobile Tabletop Simulator

เว็บแอปจำลองการเล่น Warhammer 40K **11th edition** แบบ 2D บนมือถือ (เล่นกับบอท, 2 คนส่งเครื่องให้กัน หรือดูบอทเล่นกันเอง)
**ผู้เล่นแค่เดินและเลือกเป้า ส่วนระบบทอยเต๋าและตัดสินใจตามกฎที่ไม่ต้องถามผู้เล่นให้ทั้งหมด** โดยโชว์ทุกลูก (Hit → Wound → Save → Damage) พร้อมบอกว่าต้องได้เท่าไหร่และทำไม

**เล่นบนมือถือ:** https://claude.ai/artifact/XpGarv72aawR35ZDDgUBGW (ลิงก์ส่วนตัว — แชร์ให้คนอื่นผ่านเมนู Share ของหน้า)

## เริ่มใช้งาน
```bash
npm install
npm run dev        # เปิด http://localhost:5173 (มี --host ไว้แล้ว ใช้มือถือในวง Wi-Fi เดียวกันเปิดผ่าน IP ของเครื่องได้)
npm test           # ทดสอบ rules engine + จำลองเกมเต็ม 5 รอบ (บอทเล่นกันเอง) ทุก deployment × ทุก primary
npm run build      # build เป็นไฟล์ static ใน dist/ (เอาไปวางบนเว็บโฮสต์ใดก็ได้ / ติดตั้งเป็นแอปบนมือถือ)
npm run artifact   # รวมเป็นหน้าเดียว + ไฟล์ข้อมูลใน artifact/ (ใช้ publish เป็นลิงก์)
```

## มีอะไรบ้าง
- **หน้าแรก = คลังทัพ**: ทัพทั้งหมดของเรา (ตรา, ชื่อ, faction, detachment, แต้ม/ขนาดเกม, จำนวนหน่วย) แตะเพื่อแก้, **+ New army** (เลือก faction ก่อน), ⋮ ทำซ้ำ / ลบ, การ์ด **Battle in progress** เล่นต่อ / ทิ้ง → **New battle**: เลือกโหมด (vs Bot / 2 Players / Bot vs Bot), ทัพของแต่ละฝ่าย (จากคลังหรือทัพสำเร็จรูป), Force Disposition, แผนที่ และ Secondary
- **ระบบเล่นให้เองเสมอ**: ไม่มีสวิตช์ — ทุกอย่างที่ไม่ต้องให้ผู้เล่นตัดสินใจ (ทอย save, re-roll, doctrine, ability ตามจังหวะ, pile-in ฯลฯ) ระบบทำให้ ผู้เล่นแค่เดินและเลือกเป้า
- **กฎ 11th edition** (Core Rules มิ.ย. 2026) — ดูสรุปที่ตรวจแล้วใน [docs/01-rules-11e-reference.md](docs/01-rules-11e-reference.md)
  - ครบ 5 phase: Command (CP, Battle-shock แบบติดค้าง), Movement (Normal/Advance/Fall back + Desperate Escape, Reserves/Deep Strike), Shooting (Normal/Assault/Close-quarters/Indirect), Charge (ทอย 2D6 ก่อนแล้วค่อยเลือกเป้า), Fight (Pile-in ทั้งหมดก่อน → สลับกันตี Fights First ก่อน → Consolidate)
  - Engagement 2", Coherency 2"/9", Cover = −1 BS, Hidden 15", Plunging Fire (Towering), Hazard roll 1–2
  - Weapon keywords ทั้งหมด: Assault, Heavy, Rapid Fire, Blast X, Cleave X, Torrent, Lethal/Sustained Hits, Devastating Wounds, Anti-X, Melta, Twin-linked, Lance, Precision, Psychic, Ignores Cover, Indirect, Hazardous, One Shot, Close-quarters/Pistol, Extra Attacks
  - Save allocation แบบกลุ่มของ 11th (ทอยพร้อมกัน ใช้ผลต่ำสุดก่อน, CHARACTER ทีหลัง), Feel No Pain, Mortal wounds, Deadly Demise
  - Core Stratagems 10 ใบ: Command Re-roll, Epic Challenge, Insane Bravery, Explosives, Crushing Impact, Rapid Ingress, Fire Overwatch, Smokescreen, Heroic Intervention, Counteroffensive (เด้งถามฝ่ายตรงข้ามเฉพาะตอนที่ใช้ได้จริง)
- **Mission แบบแข่งจริง** (Chapter Approved 2026-27):
  - **Force Disposition** ของแต่ละฝ่ายมาจาก detachment (Take and Hold / Purge the Foe / Disruption / Reconnaissance / Priority Assets) → คู่ disposition กำหนด **Primary ของแต่ละฝ่ายแยกกัน** (ครบ 25 ใบตามตาราง matchup) และ **แผนที่**
  - **แผนที่ทางการ 45 แบบ** (3 layout ต่อคู่ disposition × 15 คู่, 6 deployment: Tipping Point, Sweeping Engagement, Search and Destroy, Crucible of Battle, Dawn of War, Hammer and Anvil) — ตำแหน่ง ruins, กำแพง (บังสายตา), obstacles, objective (home/central/expansion), deployment zone และเส้นแบ่งเขต แกะจากภาพ layout ที่มีการวัดระยะ (`scripts/extract-layouts.py`)
  - **Objective action ครบ**: Booby Trap, Decoy, Sensor Sweep, Triangulate, Surveil, Extract Intelligence, Secure Asset, Maintain Control, Vanguard Operation, Sabotage (+ Cleanse / Plunder ของ secondary) — เริ่มใน Shooting phase, เดินแล้วล้ม, สำเร็จตอนจบเทิร์นตามการ์ด, operation marker บนสนาม; Punishment (condemned), Consecrate, Locate and Deny (วาง marker ต้นเกม) ทำให้อัตโนมัติ
  - ระบบนับ Primary อัตโนมัติทุกใบ จำกัด 15VP ต่อรอบ / 45VP
- **Datasheet ครบทุกฝ่าย 25 factions** (1,600+ datasheets) พร้อม points, detachments (DP + Force Disposition), enhancements, stratagems — ตัวจัดทัพเช็กแต้ม, DP, unit limit, leader attachment
- **Army rules อัตโนมัติ**: Oath of Moment (Space Marines: re-roll hit, +1 wound ถ้าเป็น codex army) และ WAAAGH! (Orks: 5+ InSv, ยิงแบบ Assault, advance แล้วชาร์จได้, re-roll advance ฟรี)
- **Enhancements**: เลือกได้ในหน้าจัดทัพตาม detachment ที่เลือก (เช็ก CHARACTER / EPIC HERO / ซ้ำ / จำนวนตาม battle size / Upgrade ×3) และขึ้นบนการ์ดหน่วยในเกม
- **Detachment stratagems**: ปุ่ม CP บนแถบบน — ดูกฎ detachment และใช้ stratagem ของ detachment (หัก CP, กันใช้ซ้ำใน phase เดียวกัน)
- **กฎ Detachment ทำงานจริงครบทุกอัน** (Space Marines 53, Orks 15 + army rule อย่าง Templar Vows / The Ravenwing / The Deathwing): โบนัสตอนยิง/ตี, ฝ่ายรับ, สิทธิ์ยิง/ชาร์จหลัง Advance/Fall back, re-roll ฟรี, +OC, กฎแบบ "เลือก 1 อย่าง" (Combat Doctrines, Mission Tactics, Hunting Packs, Psychic Disciplines, Templar Vows), **Saga** ของ Space Wolves (นับ tally / boast ให้เอง), ปุ่ม re-roll ฟรีในถาดลูกเต๋า (Armoured Wrath, Heroes All), ability ที่ detachment แจกให้หน่วย (Try Dat Button!, Unpredictable Genius, Powers of da Waaagh!, Sower of Dread, ’Ard as Nails …), ปุ่มระดับกองทัพ (Grim Resolve +1 OC) — 69 จาก 71 ทำให้ครบ อีก 2 อันมีหมายเหตุสั้น ๆ บนการ์ด Command phase
- **Datasheet abilities ทำงานจริง** — Space Marines ทุก ability (295) และ Orks ทุก ability (100) เขียนเป็นข้อมูลใน `data/abilities/` แล้วระบบเล่นให้เอง:
  - ผลถาวร/ออร่า/ตอนนำหน่วย (+Hit/Wound/S/A/AP/D, re-roll, Lethal/Sustained/Dev Wounds, InSv, FNP, −Damage, Stealth, Lone Operative, OC, Ld, Move …) พร้อมเงื่อนไข (ชาร์จมา, ยืนนิ่ง, เป้าเป็นรถ/มอนสเตอร์, อยู่บน objective, ใกล้หน่วยเพื่อน ฯลฯ)
  - **ปุ่มกดใช้** ในแต่ละ phase พร้อมลิมิต (ครั้งเดียวต่อเกม / ต่อ round / ต่อเทิร์น) เช่น Ammo Runts, Finest Hour, Bomb Squigs, Rampart, Haywire Mine — แตะการ์ดหน่วยดูปุ่มของหน่วยนั้นได้ทุกเมื่อ
  - **ทำงานเองตามจังหวะ**: ตอนชาร์จจบ (mortal wounds), เริ่ม Fight phase (battle-shock), หลังยิงโดนเป้า (มาร์กเป้า), ต้น Command phase (+CP, ฟื้น wound), ตอนตาย (ตีโต้ก่อนตาย, กลับมาเกิด Armour of Fate), โดนยิง (surge move), Strikes of Retribution, shoot-back ของ Invictor/ATV
  - **ตอบโต้นอกเทิร์น**: ศัตรูเดินเข้ามาใกล้ 8" → เด้งถามว่าจะเดินหนีไหม (Evade and Survive ฯลฯ), ศัตรู Fall back → ตามไปได้
  - เลือก 2 ใน 3 ability (Author of the Codex), เป้าสำรองของ Oath (Master of Battle), แยกหน่วย Combat Squads ในหน้าจัดทัพ, ปุ่มเปลี่ยนลูกเต๋าเป็น 6 (Armorium Cherub)
  - ฝ่ายอื่นทั้งหมด: ระบบอ่านข้อความ ability เองเฉพาะประโยคที่เข้าใจทั้งประโยค (ราว 30%) ที่เหลือทำเองด้วย Buff chips
  - การ์ดหน่วยบอกทุก ability ว่า ✓ ระบบทำให้ / ◐ บางส่วน / ✋ ทำเอง; ✨ บนการ์ดบอกว่าตอนนี้มีอะไรมีผลกับหน่วยนั้นบ้าง; บอทก็กดใช้ ability เอง
- **Wargear** (เลือกตอนจัดทัพเท่านั้น): เมนู ⋮ ของหน่วยในหน้าจัดทัพ → เปลี่ยน/เพิ่มอาวุธตาม wargear options ของ datasheet (จ่าเปลี่ยนอาวุธ, ทุก 5 โมเดลได้ 1 กระบอก, "any number", เลือก 2 อย่างจากรายการตามกฎ Pistol, เพิ่มโมเดลอย่าง Invader ATV) — อาวุธที่มีราคาเพิ่ม (เช่น thunder hammer +5/ชิ้น) บวกแต้มให้อัตโนมัติ, อาวุธที่เลือกไปอยู่บนโมเดลจริงในเกม, โล่ (storm shield / relic shield) ปรับ W / InSv ให้, อาวุธหลายกระบอก (2 godhammer lascannons) ยิงครบทุกกระบอก
- **สนามแบบโต๊ะแข่ง**: ruins (พื้นกระเบื้อง, กำแพง+หน้าต่าง, ชั้นบน), armoured containers, sandbag barricades, craters, objective marker 40mm พร้อมเลข OC สด, ป้าย 🛡 Cover / 👁 Hidden และเส้น line of sight ตอนเลือกเป้ายิง, token รูปตัวละคร (Space Marine / Ork / Grot / Walker / Vehicle / Monster, มงกุฎ = CHARACTER)
- **เล่นกับบอทได้** (single-player): บอทเล่นตามกฎทีละหน่วย พร้อมแอนิเมชันและคำบรรยายว่ากำลังทำอะไร — เลือกเป้ายิง/ตีจากค่าคาดหวัง (แต้มที่ฆ่าได้, เก็บหน่วย, เป้า Oath, คนยืน objective), ยืนเฝ้า objective เมื่อจำเป็น, หน่วย melee ชาร์จตามโอกาสสำเร็จ 2D6, ใช้ Command Re-roll ชาร์จ / Fire Overwatch, ใช้ Oath of Moment / WAAAGH! ตามจังหวะ
- **เอฟเฟคบนกระดาน**: เส้นกระสุน/ฟันดาบ, ตัวเลข −W, กากบาทโมเดลที่ตาย, mortal wound; ป้าย **OATH** เหนือหน่วยที่ถูกเลือกเป็น Oath of Moment
- **การเดิน**: ลาก = ย้ายทั้งหน่วย, แตะโมเดล 1 ตัว = เลือกตัวนั้นแล้วลากเฉพาะตัว (วัดระยะเส้นตรงจากจุดเริ่ม ลากซ้ำกี่ครั้งก็ได้ ตัวที่เดินสุดระยะจะไถลไปตามวงระยะแทนการค้าง) — ปล่อยนิ้วแล้วระบบจัดให้ถูกกฎ: โมเดลที่ทับกันจะถอยมาชิดฐาน, รถ/มอนสเตอร์ที่ลากทะลุกำแพง dense terrain จะหาทางอ้อมให้เอง (A*), ชาร์จจะไม่ไปติด engagement กับหน่วยที่ไม่ได้ประกาศ · ปุ่ม **↺ แก้/ขยับต่อ** เปิดการเดินล่าสุดกลับมาแก้ได้ถ้ายังไม่ได้ทำอย่างอื่น
- **ทอยเต๋ากลางจอ**: roll-off ตอนเริ่มเกม (ใคร Attacker / ใครวางก่อน, ใครเล่นก่อน), Advance, Charge, Battle-shock แสดงลูกเต๋าหมุนแล้วกระแทกลงพร้อมผลลัพธ์
- **เลือก Faction → Chapter**: แตะตรากองทัพเพื่อเลือก faction (แบ่ง Imperium / Chaos / Xenos) แล้วเลือก Chapter ของ Space Marines (Ultramarines, Blood Angels, Dark Angels, Space Wolves, Black Templars, Deathwatch ฯลฯ) — รายการหน่วยและ detachment จะแสดงเฉพาะของ Chapter นั้น + หน่วยทั่วไป และตรวจทัพให้
- **หน้าจัดทัพ** แบบ List / Detachment: หัวกองทัพ (ตรา, ชื่อ, detachment, pts), หมวด Characters / Battleline / Others มีปุ่ม + และเมนู ⋮ ต่อหน่วย (จำนวนโมเดล, leader, enhancement, warlord, ทำซ้ำ, ลบ), ปุ่มแชร์รายชื่อกองทัพ
- **Secondary Missions** ครบ 18 ใบตามการ์ดทางการ **นับคะแนนอัตโนมัติ** ตามจังหวะของแต่ละใบ (จบเทิร์นเรา / จบเทิร์นศัตรู / จบทุกเทิร์น), ผลตอนจั่ว (Beacon, A Tempting Target, Burden of Trust, จั่วใหม่ตามเงื่อนไข), Tactical: จั่วให้ครบ 2 ใบทุก Command phase, ทิ้ง +1CP, เปลี่ยนใบ 1CP · Fixed: 4 ใบที่เป็น Fixed ได้ สูงสุดใบละ 20VP — มีปุ่มให้คะแนนเองสำรอง
- **Transports**: แผงรถใน Movement phase แสดงที่นั่งและผู้โดยสาร กดลงรถได้ทันที, ขึ้นรถตอนวางทัพหรือหลังเดิน (ภายใน 3"), ลงรถแบบ Tactical / Rapid / Combat, Emergency Disembark อัตโนมัติเมื่อรถถูกทำลาย (อ่าน capacity / ข้อห้ามจาก datasheet)
- **Split fire**: เลือกอาวุธทีละชุดยิงคนละเป้าได้
- **Scouts**: ขยับก่อนเริ่มเกมตามกฎ
- **บอท vs บอท**: ดูบอทเล่นกันเองครบ 5 รอบ ปรับความเร็ว หยุด/ปกติ/เร็ว ได้
- **ไม้วัดระยะ** (เมนู ☰): แตะ 2 จุดบนสนาม/โมเดล ขึ้นระยะเป็นนิ้วพร้อมขีดทุก 1"; ตอนเลือกเป้ายิง/ชาร์จ/ตีจะขึ้นระยะถึงแต่ละเป้า; Fire Overwatch บอกระยะ 24" และระยะถึงศัตรูใกล้สุด
- **กันกดพลาด**: จบ Movement / Shooting / Charge ตอนที่ยังไม่มีหน่วยไหนทำอะไรเลย ต้องกดซ้ำเพื่อยืนยัน
- **Undo** ย้อนได้ 60 ขั้น, ข้อผิดพลาดไม่ทำให้แอปพังหรือเซฟเสีย, กองทัพที่จัดไว้ถูกจำไว้ในเครื่อง
- **Stratagems**: ปุ่ม Strat แสดงเฉพาะที่ใช้ได้ในจังหวะนั้น (เช็กเทิร์น/phase/CP/ครั้งเดียวต่อ phase) เลือกหน่วยแล้วกดใช้ ระบบหัก CP และใส่ผลให้อัตโนมัติ ฝ่ายรับกดใช้ได้จากถาดลูกเต๋าก่อนทอย (เช่น Armour of Contempt) บอทก็ใช้ stratagem ฝ่ายบุกเมื่อคุ้ม
- **ข้อมูล 11th edition เท่านั้น**: ตัด datasheet Warhammer Legends ออกทั้งหมด (ตั้งค่าได้ใน `data/factions-meta.json`) ทัพที่บันทึกไว้ซึ่งมีหน่วยที่ถูกตัดจะขึ้นเตือนให้ลบก่อนเริ่มเกม
- **Buff chips**: ability ของ datasheet/detachment ที่ยังไม่ได้ทำให้อัตโนมัติ กดเปิดเองได้ (+1 Hit, Re-roll, Lethal, FNP …)
- เซฟเกมอัตโนมัติใน browser (ปิดแล้วกลับมาเล่นต่อได้)

## อัปเดตข้อมูล / แก้กฎ (ออกแบบให้แก้ง่าย)
| อยากแก้ | แก้ที่ |
|---|---|
| ดึง datasheet / points / detachment ล่าสุดจาก Wahapedia | `npm run data -- --fetch` |
| แก้ stat / points / อาวุธ / detachment / enhancement ด้วยมือ (เช่นตาม balance dataslate) | `data/overrides/<FACTION>.json` ([วิธีเขียน](data/overrides/README.md)) แล้ว `npm run data` |
| แผนที่แข่ง (layout) | `data/layouts.json` สร้างด้วย `python3 scripts/extract-layouts.py <โฟลเดอร์ภาพ layout> > data/layouts.json` |
| Primary / Secondary / action | `data/missions.json` (`primaries`, `secondaries`, `actions`) |
| กฎ Detachment ที่ระบบทำให้อัตโนมัติ (โบนัส, เงื่อนไข, Combat Doctrines ฯลฯ) | `data/detachment-rules.json` (ใส่ชื่อ detachment แล้วเขียน effect ตามคำอธิบายบนหัวไฟล์) |
| Datasheet abilities | `data/abilities/<FACTION>.json` — คีย์คือชื่อ ability (หรือ `ชื่อ@datasheet`), `effects` = ผลถาวร/ออร่า, `act` = ปุ่ม/ทริกเกอร์ (ดูชนิดฟิลด์ใน `src/engine/effects.ts` และ `src/engine/activations.ts`); faction ที่ไม่มีไฟล์จะใช้ตัวอ่านข้อความ `src/engine/abilityText.ts` |
| Wargear options / ราคาอาวุธ | มาจาก Wahapedia อัตโนมัติ (`npm run data`) แก้ด้วยมือได้ใน `data/overrides/<FACTION>.json` (`wargearOptions`, `wargearCosts`) |
| กลุ่ม Faction (Imperium / Chaos / Xenos) และ sub-faction เช่น Chapter ของ Space Marines | `data/factions-meta.json` แล้ว `npm run data` (detachment จับคู่ Chapter อัตโนมัติจากเนื้อกฎ ถ้าผิดใส่ใน `detachments: { "ชื่อ": "KEYWORD" }`) |
| ตัวเลขกฎหลัก (engagement, coherency, CP, ระยะ charge, cap ของ modifier, core stratagems) | `data/core-rules.json` |
| Deployment map, terrain layout, Primary Mission และคะแนน | `data/missions.json` |
| ตรรกะกฎ | `src/engine/*` (pure TypeScript ไม่ผูกกับ UI มี test ใน `src/engine/engine.test.ts`) |

ถ้า GW ออก FAQ/errata/dataslate ใหม่ ส่งลิงก์มาได้เลย จะแก้ใน 3 ที่ข้างบนตามประเภทของการเปลี่ยนแปลง

## โครงสร้าง
```
data/            core-rules.json, missions.json, layouts.json, detachment-rules.json, abilities/, factions-meta.json, overrides/   ← ไฟล์ที่ตั้งใจให้แก้
scripts/         build-data.mjs (Wahapedia CSV → JSON)
public/data/     ข้อมูลที่ build แล้ว (โหลดตอนเลือก faction)
src/engine/      rules engine: dice, geometry, visibility, army (+wargear), attack, game (phases + scoring), pathing (route/settle moves), effects (abilities + detachments), activations (buttons/triggers/reactions), abilityText, detachments, missions, secondaries, stratagems, bot
src/ui/          React: Board (SVG + pan/pinch/drag), DiceTray, GameScreen, ArmyBuilder
docs/            สรุปกฎ 11th ที่ตรวจแล้ว + game design
```

## ข้อจำกัดตอนนี้ (สิ่งที่ยังไม่ได้ทำ)
- Detachment stratagems: ระบบอ่านข้อความแล้วใส่ผลให้อัตโนมัติได้ประมาณ 1 ใน 3 (+1 Hit/Wound, re-roll, AP, Lethal/Sustained/Dev Wounds, Ignores Cover, −1 Hit/Wound/AP ของศัตรู, −1 Damage, FNP, Cover, Fights First, +1 Advance/Charge) ที่เหลือ (เดินพิเศษ, ยิงนอกเฟส, mortal wounds, เลือก doctrine ฯลฯ) หัก CP + บันทึกให้ แล้วทำตามข้อความเอง
- Detachment: Champions of Fenris (หน้าต่าง Heroic Intervention เปิดซ้ำได้หลังใช้แต่ละครั้ง) และ Ceramite Sentinels (keyword ENTRENCHED ไม่ได้ตรวจ) มีหมายเหตุ; ส่วนที่ระบบเลือกแทนผู้เล่น: Vowed Target (Aggressive Push), หน่วยรับ Deep Strike ของ Orbital Assault Force, Slayer's Oath keyword, Ferocious Strike (Lethal/Sustained ตาม S กับ T)
- Ability ของ Space Marines/Orks ที่ยังต้องทำเอง: Miraculous Saviour, Master of Deceit, Strategium Command, Emergency Combat Embarkation, Stabilised Disembarkation, Pilin' Out, Pulse Jet; ทำบางส่วน: Drop Pod Assault (ผู้โดยสารลงเอง), Teleport Homer (ตำแหน่ง token), Seeker of the Unfound, Cerebrex (redeploy), ป้อมปราการ (Fortification)
- ปุ่ม re-roll damage ยังไม่มีในถาดลูกเต๋า (ability ที่ให้ re-roll hit/wound/damage 1 ลูกใช้ได้แค่ hit/wound)
- ฝ่ายอื่นทั้งหมด: ability ส่วนใหญ่ (ราว 70%) และกฎกองทัพ (Acts of Faith, Battle Focus ฯลฯ) ยังไม่อัตโนมัติ → ใช้ Buff chips
- Wargear: ข้อความ option ที่เขียนแปลก ๆ บางอัน (ราว 3%) แปลงไม่ได้ จะไม่ขึ้นให้เลือก; ability ของอุปกรณ์ที่ไม่ใช่อาวุธ (banner, icon, drone) ยังไม่มีผล ยกเว้นโล่ที่ปรับ W/InSv และ helix gauntlet (FNP)
- รูปตัวละครเริ่มต้นเป็นภาพวาดเวกเตอร์ของโปรเจกต์เอง (ไม่ใช้รูปโมเดลของ GW เพราะติดลิขสิทธิ์) — แตะรูปในหน้า datasheet เพื่อใส่รูปของคุณเอง รูปจะขึ้นทั้งบนการ์ดและบน token ในสนาม (เก็บในเครื่องนั้นเท่านั้น)
- Aircraft, Firing Deck ยังไม่มี
- ตัวเลือกบนการ์ด mission บางอย่างระบบเลือกให้อัตโนมัติ (เป้า Punishment 3 หน่วย, ที่วาง marker ของ Locate and Deny, beacon unit, หน่วยเฝ้า Burden of Trust, marker ที่ Sensor Sweep เอาออก)
- Twist cards ยังไม่มี
- Terrain เป็น 2D: กำแพงของ ruins บังสายตา, พื้นที่ terrain เป็น obscuring; ยังไม่มีการปีนชั้นบน (Plunging Fire ทำได้แค่ TOWERING)
- โมเดลไม่บังสายตากันเอง (ตามที่แอปออนไลน์ส่วนใหญ่ทำ)
- ฐานโมเดลแบบ "Use model"/hull ใช้วงกลมขนาดประมาณตามชนิดรถ (Land Raider 6", Rhino 4.2", Trukk 3.8" …) และให้ทับขอบกำแพงได้นิดหน่อยเพื่อให้รถผ่านช่องได้

## เครดิต
ข้อมูล datasheet: **Powered by [Wahapedia](https://wahapedia.ru/wh40k11ed/)** (data export) · Warhammer 40,000 เป็นเครื่องหมายการค้าของ Games Workshop — โปรเจกต์นี้เป็นเครื่องมือแฟนเมดสำหรับใช้ส่วนตัว ไม่ใช่ผลิตภัณฑ์ทางการ
