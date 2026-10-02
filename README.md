# Warhammer 40,000 11th Edition — Mobile Tabletop Simulator

เว็บแอปจำลองการเล่น Warhammer 40K **11th edition** แบบ 2D บนมือถือ (เล่นแบบ hotseat ส่งเครื่องให้กัน 2 คน)
**ผู้เล่นเดินและวางโมเดลเอง ส่วนระบบทอยเต๋าและคิดตามกฎให้ทั้งหมด** โดยโชว์ทุกลูก (Hit → Wound → Save → Damage) พร้อมบอกว่าต้องได้เท่าไหร่และทำไม คล้าย Baldur's Gate 3

## เริ่มใช้งาน
```bash
npm install
npm run dev        # เปิด http://localhost:5173 (มี --host ไว้แล้ว ใช้มือถือในวง Wi-Fi เดียวกันเปิดผ่าน IP ของเครื่องได้)
npm test           # ทดสอบ rules engine
npm run build      # build เป็นไฟล์ static ใน dist/ (เอาไปวางบนเว็บโฮสต์ใดก็ได้ / ติดตั้งเป็นแอปบนมือถือ)
```

## มีอะไรบ้าง
- **กฎ 11th edition** (Core Rules มิ.ย. 2026) — ดูสรุปที่ตรวจแล้วใน [docs/01-rules-11e-reference.md](docs/01-rules-11e-reference.md)
  - ครบ 5 phase: Command (CP, Battle-shock แบบติดค้าง), Movement (Normal/Advance/Fall back + Desperate Escape, Reserves/Deep Strike), Shooting (Normal/Assault/Close-quarters/Indirect), Charge (ทอย 2D6 ก่อนแล้วค่อยเลือกเป้า), Fight (Pile-in ทั้งหมดก่อน → สลับกันตี Fights First ก่อน → Consolidate)
  - Engagement 2", Coherency 2"/9", Cover = −1 BS, Hidden 15", Plunging Fire (Towering), Hazard roll 1–2
  - Weapon keywords ทั้งหมด: Assault, Heavy, Rapid Fire, Blast X, Cleave X, Torrent, Lethal/Sustained Hits, Devastating Wounds, Anti-X, Melta, Twin-linked, Lance, Precision, Psychic, Ignores Cover, Indirect, Hazardous, One Shot, Close-quarters/Pistol, Extra Attacks
  - Save allocation แบบกลุ่มของ 11th (ทอยพร้อมกัน ใช้ผลต่ำสุดก่อน, CHARACTER ทีหลัง), Feel No Pain, Mortal wounds, Deadly Demise
  - Core Stratagems 10 ใบ: Command Re-roll, Epic Challenge, Insane Bravery, Explosives, Crushing Impact, Rapid Ingress, Fire Overwatch, Smokescreen, Heroic Intervention, Counteroffensive (เด้งถามฝ่ายตรงข้ามเฉพาะตอนที่ใช้ได้จริง)
- **Mission แบบ official** (Chapter Approved 2026-27): สนาม 44"×60", Deployment card Hammer and Anvil / Dawn of War / Search and Destroy ตามพิกัดบนการ์ด, Terrain Objective, Primary Missions 5 ใบ (Mirrored World), จำกัด 15VP ต่อรอบ / 45VP
- **Datasheet ครบทุกฝ่าย 25 factions** (1,600+ datasheets) พร้อม points, detachments (DP + Force Disposition), enhancements, stratagems — ตัวจัดทัพเช็กแต้ม, DP, unit limit, leader attachment
- **Buff chips**: ability ของ datasheet/detachment ที่ยังไม่ได้ทำให้อัตโนมัติ กดเปิดเองได้ (+1 Hit, Re-roll, Lethal, FNP …)
- เซฟเกมอัตโนมัติใน browser (ปิดแล้วกลับมาเล่นต่อได้)

## อัปเดตข้อมูล / แก้กฎ (ออกแบบให้แก้ง่าย)
| อยากแก้ | แก้ที่ |
|---|---|
| ดึง datasheet / points / detachment ล่าสุดจาก Wahapedia | `npm run data -- --fetch` |
| แก้ stat / points / อาวุธ / detachment / enhancement ด้วยมือ (เช่นตาม balance dataslate) | `data/overrides/<FACTION>.json` ([วิธีเขียน](data/overrides/README.md)) แล้ว `npm run data` |
| ตัวเลขกฎหลัก (engagement, coherency, CP, ระยะ charge, cap ของ modifier, core stratagems) | `data/core-rules.json` |
| Deployment map, terrain layout, Primary Mission และคะแนน | `data/missions.json` |
| ตรรกะกฎ | `src/engine/*` (pure TypeScript ไม่ผูกกับ UI มี test ใน `src/engine/engine.test.ts`) |

ถ้า GW ออก FAQ/errata/dataslate ใหม่ ส่งลิงก์มาได้เลย จะแก้ใน 3 ที่ข้างบนตามประเภทของการเปลี่ยนแปลง

## โครงสร้าง
```
data/            core-rules.json, missions.json, overrides/   ← ไฟล์ที่ตั้งใจให้แก้
scripts/         build-data.mjs (Wahapedia CSV → JSON)
public/data/     ข้อมูลที่ build แล้ว (โหลดตอนเลือก faction)
src/engine/      rules engine: dice, geometry, visibility, army, attack, game (phases + scoring)
src/ui/          React: Board (SVG + pan/pinch/drag), DiceTray, GameScreen, ArmyBuilder
docs/            สรุปกฎ 11th ที่ตรวจแล้ว + game design
```

## ข้อจำกัดตอนนี้ (สิ่งที่ยังไม่ได้ทำ)
- Detachment rules / datasheet abilities / detachment stratagems ยังไม่ทำงานอัตโนมัติ → ใช้ Buff chips แทน
- Transport (ขึ้นลงรถ), Aircraft, Scouts move, Secondary Missions, Primary Missions ที่ใช้ action/operation marker ยังไม่มี
- ระบบแบ่งยิงหลายเป้าในหน่วยเดียว ยังไม่มี (ทั้งหน่วยยิงเป้าเดียว)
- Terrain เป็น 2D: กำแพงของ ruins บังสายตา, พื้นที่ terrain เป็น obscuring; ยังไม่มีการปีนชั้นบน (Plunging Fire ทำได้แค่ TOWERING)
- โมเดลไม่บังสายตากันเอง (ตามที่แอปออนไลน์ส่วนใหญ่ทำ)
- ฐานโมเดลแบบ "Use model"/hull ใช้วงกลมขนาดประมาณ

## เครดิต
ข้อมูล datasheet: **Powered by [Wahapedia](https://wahapedia.ru/wh40k11ed/)** (data export) · Warhammer 40,000 เป็นเครื่องหมายการค้าของ Games Workshop — โปรเจกต์นี้เป็นเครื่องมือแฟนเมดสำหรับใช้ส่วนตัว ไม่ใช่ผลิตภัณฑ์ทางการ
