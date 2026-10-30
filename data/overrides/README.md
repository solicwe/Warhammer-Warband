# Overrides: แก้ข้อมูลเองโดยไม่โดนทับตอนอัปเดต

ไฟล์ใน `public/data/factions/*.json` ถูก**สร้างใหม่ทุกครั้ง**จาก Wahapedia export (`npm run data -- --fetch`)
ถ้าจะแก้ค่าใดค่าหนึ่ง (เช่น GW ออก balance dataslate หรือ errata ใหม่ แต่ Wahapedia ยังไม่อัปเดต) ให้เขียนไฟล์ override ที่นี่แทน
ไฟล์ชื่อ `<FACTION_ID>.json` (เช่น `ORK.json`, `SM.json`) แล้วจะถูก merge ทับทุกครั้งที่ build

อย่าแก้ `public/data/factions/*.json` ตรง ๆ: build รอบหน้าจะทับทิ้ง ข้อมูลที่ต้องการให้อยู่ต่อใส่ที่นี่, ใน `data/points/*.txt`
(หน่วย Forge World ที่มีราคาจะถูกดึงเข้าเกม) หรือใน `data/factions-meta.json` (`allies`: หน่วยของอีกเล่มที่ Wahapedia ลงไว้ใต้กองทัพนี้)

ตรวจก่อน commit: `npm run data:check` สร้างข้อมูลจาก `data/raw` โดยไม่เขียนไฟล์ แล้วบอกว่าแต่ละไฟล์ต่างจากที่ commit ไว้ตรงไหน
(datasheet / detachment ที่หายหรือเพิ่ม และฟิลด์ที่ต่าง) ไฟล์ faction เขียนเป็น JSON ย่อหน้า 2 ช่อง ปิดท้ายด้วยขึ้นบรรทัดใหม่
เพื่อให้ `git diff` เห็นเฉพาะข้อมูลที่เปลี่ยนจริง (`src/engine/factionFiles.test.ts` ตรวจรูปแบบนี้)

## กติกาการ merge
- object → merge ทีละ key
- array ของ object ที่มี `name` → จับคู่ด้วย `name` (ถ้าไม่เจอจะเพิ่มใหม่)
- ใส่ `"_delete": true` เพื่อลบรายการนั้น
- ค่าอื่น ๆ → แทนที่ทั้งก้อน

## ตัวอย่าง `data/overrides/ORK.json`
```json
{
  "datasheets": [
    {
      "name": "Boyz",
      "points": [{ "label": "YOUR 1ST TO 3RD UNITS COST", "options": [{ "models": 10, "pts": 85 }, { "models": 20, "pts": 170 }] }],
      "models": [{ "name": "Boy", "OC": 2, "W": 1 }],
      "weapons": [
        { "name": "Choppa", "profiles": [{ "name": "Choppa", "range": "Melee", "A": "3", "skill": 3, "S": 5, "AP": -1, "D": "1", "abilities": ["cleave 1"] }] }
      ]
    }
  ],
  "detachments": [
    { "name": "War Horde", "dp": 3, "forceDisposition": "Take and Hold" }
  ]
}
```

ฟิลด์ที่แก้ได้ (ดูโครงสร้างเต็มใน `src/engine/types.ts`):
- **Datasheet**: `models[]` (M, T, Sv, InSv, W, Ld, OC, base), `weapons[].profiles[]` (range, A, skill, S, AP, D, abilities), `abilities[]`, `keywords`, `points`, `leads`, `loadout`
- **Detachment**: `dp`, `forceDisposition`, `rules[]`, `enhancements[]` (pts, text), `stratagems[]` (cp, text)
- **Army rules**: `armyRules[]`

Weapon abilities เขียนเป็นตัวพิมพ์เล็กแบบเดียวกับบนการ์ด เช่น `"rapid fire 1"`, `"anti-infantry 4+"`, `"lethal hits: non-monster/vehicle"`, `"sustained hits d3"`, `"melta 2"`, `"blast 2"`, `"cleave 1"`, `"pistol"`, `"close-quarters"`
