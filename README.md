# Warhammer 40,000 11th Edition — Mobile Tabletop Simulator

เว็บแอปจำลองการเล่น Warhammer 40K **11th edition** แบบ 2D บนมือถือ (เล่นแบบ hotseat ส่งเครื่องให้กัน 2 คน)
**ผู้เล่นเดินและวางโมเดลเอง ส่วนระบบทอยเต๋าและคิดตามกฎให้ทั้งหมด** โดยโชว์ทุกลูก (Hit → Wound → Save → Damage) พร้อมบอกว่าต้องได้เท่าไหร่และทำไม คล้าย Baldur's Gate 3

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
- **สนามแบบโต๊ะแข่ง**: ruins (พื้นกระเบื้อง, กำแพง+หน้าต่าง, ชั้นบน), armoured containers, sandbag barricades, craters, objective marker 40mm พร้อมเลข OC สด, ป้าย 🛡 Cover / 👁 Hidden และเส้น line of sight ตอนเลือกเป้ายิง, token รูปตัวละคร (Space Marine / Ork / Grot / Walker / Vehicle / Monster, มงกุฎ = CHARACTER)
- **เล่นกับบอทได้** (single-player): บอทเล่นตามกฎทีละหน่วย พร้อมแอนิเมชันและคำบรรยายว่ากำลังทำอะไร — เลือกเป้ายิง/ตีจากค่าคาดหวัง (แต้มที่ฆ่าได้, เก็บหน่วย, เป้า Oath, คนยืน objective), ยืนเฝ้า objective เมื่อจำเป็น, หน่วย melee ชาร์จตามโอกาสสำเร็จ 2D6, ใช้ Command Re-roll ชาร์จ / Fire Overwatch, ใช้ Oath of Moment / WAAAGH! ตามจังหวะ
- **เอฟเฟคบนกระดาน**: เส้นกระสุน/ฟันดาบ, ตัวเลข −W, กากบาทโมเดลที่ตาย, mortal wound; ป้าย **OATH** เหนือหน่วยที่ถูกเลือกเป็น Oath of Moment
- **การเดิน**: ลาก = ย้ายทั้งหน่วย, แตะโมเดล 1 ตัว = เลือกตัวนั้นแล้วลากเฉพาะตัว (วัดระยะเส้นตรงจากจุดเริ่มของตัวนั้น ใช้ได้แม้ทั้งหน่วยเดินจนสุดระยะแล้ว)
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
| กลุ่ม Faction (Imperium / Chaos / Xenos) และ sub-faction เช่น Chapter ของ Space Marines | `data/factions-meta.json` แล้ว `npm run data` (detachment จับคู่ Chapter อัตโนมัติจากเนื้อกฎ ถ้าผิดใส่ใน `detachments: { "ชื่อ": "KEYWORD" }`) |
| ตัวเลขกฎหลัก (engagement, coherency, CP, ระยะ charge, cap ของ modifier, core stratagems) | `data/core-rules.json` |
| Deployment map, terrain layout, Primary Mission และคะแนน | `data/missions.json` |
| ตรรกะกฎ | `src/engine/*` (pure TypeScript ไม่ผูกกับ UI มี test ใน `src/engine/engine.test.ts`) |

ถ้า GW ออก FAQ/errata/dataslate ใหม่ ส่งลิงก์มาได้เลย จะแก้ใน 3 ที่ข้างบนตามประเภทของการเปลี่ยนแปลง

## โครงสร้าง
```
data/            core-rules.json, missions.json, factions-meta.json, overrides/   ← ไฟล์ที่ตั้งใจให้แก้
scripts/         build-data.mjs (Wahapedia CSV → JSON)
public/data/     ข้อมูลที่ build แล้ว (โหลดตอนเลือก faction)
src/engine/      rules engine: dice, geometry, visibility, army, attack, game (phases + scoring)
src/ui/          React: Board (SVG + pan/pinch/drag), DiceTray, GameScreen, ArmyBuilder
docs/            สรุปกฎ 11th ที่ตรวจแล้ว + game design
```

## ข้อจำกัดตอนนี้ (สิ่งที่ยังไม่ได้ทำ)
- Detachment stratagems: ระบบอ่านข้อความแล้วใส่ผลให้อัตโนมัติได้ประมาณ 1 ใน 3 (+1 Hit/Wound, re-roll, AP, Lethal/Sustained/Dev Wounds, Ignores Cover, −1 Hit/Wound/AP ของศัตรู, −1 Damage, FNP, Cover, Fights First, +1 Advance/Charge) ที่เหลือ (เดินพิเศษ, ยิงนอกเฟส, mortal wounds, เลือก doctrine ฯลฯ) หัก CP + บันทึกให้ แล้วทำตามข้อความเอง
- Detachment rules / datasheet abilities ส่วนใหญ่ยังไม่ทำงานอัตโนมัติ → ใช้ Buff chips ใส่ผลเอง
- รูปตัวละครเริ่มต้นเป็นภาพวาดเวกเตอร์ของโปรเจกต์เอง (ไม่ใช้รูปโมเดลของ GW เพราะติดลิขสิทธิ์) — แตะรูปในหน้า datasheet เพื่อใส่รูปของคุณเอง รูปจะขึ้นทั้งบนการ์ดและบน token ในสนาม (เก็บในเครื่องนั้นเท่านั้น)
- Aircraft, Firing Deck ยังไม่มี
- ตัวเลือกบนการ์ด mission บางอย่างระบบเลือกให้อัตโนมัติ (เป้า Punishment 3 หน่วย, ที่วาง marker ของ Locate and Deny, beacon unit, หน่วยเฝ้า Burden of Trust, marker ที่ Sensor Sweep เอาออก)
- Twist cards ยังไม่มี
- Terrain เป็น 2D: กำแพงของ ruins บังสายตา, พื้นที่ terrain เป็น obscuring; ยังไม่มีการปีนชั้นบน (Plunging Fire ทำได้แค่ TOWERING)
- โมเดลไม่บังสายตากันเอง (ตามที่แอปออนไลน์ส่วนใหญ่ทำ)
- ฐานโมเดลแบบ "Use model"/hull ใช้วงกลมขนาดประมาณ

## เครดิต
ข้อมูล datasheet: **Powered by [Wahapedia](https://wahapedia.ru/wh40k11ed/)** (data export) · Warhammer 40,000 เป็นเครื่องหมายการค้าของ Games Workshop — โปรเจกต์นี้เป็นเครื่องมือแฟนเมดสำหรับใช้ส่วนตัว ไม่ใช่ผลิตภัณฑ์ทางการ
