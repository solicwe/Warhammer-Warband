# Game Design: เกมจำลอง Warhammer 40k 11th บนมือถือ (2D)

> เป้าหมาย: ให้ความรู้สึกเหมือนเล่นบนโต๊ะจริง (เหมือน Tabletop Simulator) แต่ **ระบบทอยและคิดเลขให้ทั้งหมด** แบบ Baldur's Gate 3
> ผู้เล่นทำแค่ **วางโมเดล ลากเดินตามระยะ M แล้วเลือกเป้า** ส่วน engine จัดการทอย modifier CP และสถานะทั้งหมดตามกฎ 11th ([01-rules-11e-reference.md](./01-rules-11e-reference.md))

> **สถานะ (2026-10-02)**: ทำ M0–M5 แล้ว (data pipeline, engine, board, turn loop, mission, dice tray) — ดู README สำหรับสิ่งที่ยังไม่ได้ทำ
> เปลี่ยนจากแผนเดิม: ใช้ SVG แทน PixiJS (ลื่นพอสำหรับ ~80 โมเดล และ hit-test ง่าย), ใช้ state hook เองแทน Zustand, ข้อมูลทุกฝ่าย 25 factions ใช้ได้ทันทีผ่าน Buff chips

---

## 1. หลักการออกแบบ

1. **ผู้เล่นตัดสินใจ ระบบคิดเลข**: ทุกอย่างที่เป็นคณิตศาสตร์ (ระยะ coherency, BS, cover, wound table, การจัดสรร save, FNP, VP) engine ทำให้ ผู้เล่นตัดสินใจแค่สิ่งที่กฎให้เลือก
2. **ไม่ปล่อยให้ทำผิดกฎ**: ระหว่างลาก แสดงขอบเขตที่เดินได้ และถ้าจบการเคลื่อนที่ไม่ถูกกฎ ก็ย้อนกลับให้เองตามกฎ 03.01 (ไม่ต้องให้ผู้เล่นจำกฎ)
3. **แสดงที่มาของตัวเลขเสมอ**: เช่น "ต้องได้ 3+ = BS 3+ · Heavy +1 · Cover −1 BS" เหมือน tooltip ของ BG3 แตะดูได้ทุกตัวเลข
4. **ถามเฉพาะตอนที่มีทางเลือกจริง**: reaction stratagem จะเด้งขึ้นมาก็ต่อเมื่อมี CP พอ มีหน่วยที่ใช้ได้ และยังไม่ได้ใช้ phase นี้ นอกนั้นข้ามอัตโนมัติ
5. **ใช้นิ้วเดียวได้**: ปุ่มหลักอยู่ครึ่งล่างของจอ ปุ่มกดใหญ่อย่างน้อย 44pt แนวตั้งเป็นหลัก
6. **Undo ได้จนกว่าจะทอยเต๋า**: ลูกเต๋าคือจุดที่ย้อนกลับไม่ได้ (เหมือนโต๊ะจริง) ส่วนการเดินแก้ได้จนกด "ยืนยัน"

---

## 2. ขอบเขตของ MVP

| อยู่ใน MVP | ทำทีหลัง |
|---|---|
| Hotseat 2 คน (ส่งมือถือให้กัน) | เล่นออนไลน์ / AI ฝ่ายตรงข้าม |
| Incursion 1000 pts (สนาม 44×60 เหมือนเดิม แต่หน่วยน้อยกว่า) | Strike Force 2000 |
| 2 ฝ่ายเริ่มต้น: **Space Marines vs Orks** (ตรงกับกล่อง Armageddon) | ทุก faction (ข้อมูลมีครบ 25 ฝ่ายแล้ว) |
| Core rules ทั้งหมด + weapon keywords ทั้งหมด | Detachment rules / datasheet abilities แบบอัตโนมัติ |
| Core stratagems 10 ใบ | Detachment stratagems |
| Mission: Mirrored World → Battlefield Dominance, Deployment 1–2 แบบ | Primary ทั้ง 25 ใบ + Secondary + Twist อื่น |
| Terrain 2.5D (polygon + ความสูง + ชั้น) | 3D view |

---

## 3. หน้าจอและ Flow

### 3.1 โครงหน้าจอ (แนวตั้ง)
```
┌──────────────────────────────┐
│ R2 · P1 · MOVEMENT   CP 3|2  │ ← แถบสถานะ: round, ผู้เล่น, phase, CP, VP
│ VP 12 – 9                    │
├──────────────────────────────┤
│                              │
│      สนาม 2D (pinch/pan)     │ ← canvas: terrain, โมเดล, วงระยะ
│   ◯◯◯ ← หน่วยที่เลือก        │
│   ╭──╮ ← ขอบเขตที่เดินได้     │
│                              │
├──────────────────────────────┤
│ [Intercessors ▾] M6 T4 Sv3+  │ ← การ์ดหน่วย (ปัดขึ้นดู datasheet เต็ม)
│ W ●●●●●○○○○○  OC2  [Shocked] │
├──────────────────────────────┤
│ [Normal] [Advance] [Stay]    │ ← ปุ่ม action ตาม phase (มีเฉพาะที่กฎอนุญาต)
│          [ ยืนยัน OK ]        │
└──────────────────────────────┘
```
- **ปัดการ์ดหน่วยขึ้น** = bottom sheet แสดง datasheet เต็ม (stats, อาวุธ, abilities, keywords) ย่อให้อ่านง่ายบนมือถือ
- **รายการหน่วย**: แถบเลื่อนแนวนอนเหนือการ์ด แสดงไอคอนหน่วยที่ยังไม่ได้ทำ action ใน phase นี้ (สีเข้ม = ยังไม่ได้ทำ, สีจาง = ทำแล้ว)

### 3.2 ก่อนเกม
1. **Army**: เลือก faction → detachment (นับ DP) → เพิ่มหน่วยจาก datasheet (นับแต้ม, unit limit) → ผูก leader/support → เลือก warlord/enhancement
   - Import รายชื่อ (ข้อความจาก GW app / New Recruit) เป็นฟีเจอร์ทีหลัง
2. **Mission wizard**: เลือก Force Disposition แบบลับ (ส่งมือถือให้กัน) → engine หา primary ให้ → สุ่ม deployment → วาง terrain ตาม layout ที่ทำไว้ → roll-off หา Attacker/Defender → เลือก secondary → **Declare battle formations** แบบลับ
3. **Deploy**: ผลัดกันวางทีละหน่วยในโซน (ไฮไลต์โซนที่วางได้) → ลากวางทั้งหน่วยแบบ formation (ดู 3.3) → Scouts/Infiltrators
4. **Roll-off first turn** (ทอยเต๋าแบบมี animation)

### 3.3 การเดิน (หัวใจของความรู้สึกแบบ tabletop)
การลากทีละโมเดลบนมือถือสำหรับหน่วย 20 ตัวนั้นทรมาน จึงมี 2 โหมด:

**A) Group drag (ค่าเริ่มต้น)**: ลากหน่วยทั้งหน่วยเป็นก้อนเดียว
- แสดง **ghost** ของตำแหน่งใหม่ และวงระยะ M (หรือ M + ผลทอย advance)
- โมเดลที่จะเกินระยะ ชนศัตรู ชน terrain ที่ผ่านไม่ได้ หรือเข้า engagement range (ตอน normal/advance) จะเป็น **สีแดง**
- ปุ่ม formation: `เรียงแถว` `กระจาย 2"` `วงกลม` (จัดรูปให้ใหม่แต่ยังอยู่ใน coherency)

**B) Single model**: แตะค้างที่โมเดลเพื่อปรับทีละตัว (เส้นทางเป็นเส้นตรงต่อกันได้หลายท่อน และนับระยะสะสม)

**ระหว่างเดินแสดง:**
- ระยะที่ใช้ไปแล้วต่อโมเดล (`4.2"/6"`)
- เส้น coherency (เส้นบาง ๆ ระหว่างโมเดลที่ห่างกัน ≤2") ถ้าหลุด coherency เส้นเป็นสีแดง
- วง engagement 2" รอบศัตรู (จาง ๆ)
- ถ้าเป็น [HEAVY] แสดงวง 3" ไว้บอกว่า "เดินไม่เกินนี้ได้ +1 hit"

**Advance**: กดปุ่ม Advance → ลูกเต๋า D6 กลิ้ง → วงระยะขยายเป็น M + ผลทอย → ถ้ามี CP แสดงปุ่มเล็ก "Command Re-roll (1CP)"

**กด "ยืนยัน"** → engine ตรวจกฎ "After moving" ทั้งหมด → ถ้าผ่าน ล็อกตำแหน่ง ถ้าไม่ผ่าน บอกเหตุผลเป็นภาษาคน เช่น "Boy #7 ห่างจากเพื่อนเกิน 2"" แล้วให้แก้ต่อ

### 3.4 การยิง (สไตล์ BG3)
1. แตะหน่วยตัวเอง → engine แสดงเฉพาะ **shooting type ที่ทำได้** (Normal/Assault/Close-quarters/Indirect)
2. ศัตรูที่เป็นเป้าได้จะเรืองแสง แตะค้างเพื่อดู preview:
   ```
   ┌ Bolt rifle ×10 → Boyz ──────────┐
   │ Hit 3+  (BS3+ · Heavy +1 · Cover −1)│
   │ Wound 4+ (S4 vs T5 → 5+ ... )       │
   │ Save 6+  (Sv5+ AP-1)                │
   │ คาดว่าเฉลี่ย ~3.1 ตัวตาย              │ ← expected value (เปิด/ปิดได้)
   └─────────────────────────────────────┘
   ```
3. แบ่งอาวุธไปหลายเป้าได้ (ลากอาวุธไปวางบนเป้า) หรือ "ยิงทั้งหมดใส่เป้านี้" ด้วยปุ่มเดียว
4. กด **ยิง** → **Dice tray** เด้งขึ้นมา (ครึ่งล่างของจอ):
   - **Hit**: ลูกเต๋าทั้งกองกลิ้งพร้อมกัน แล้วแยกให้เห็น: ผ่าน (เขียว), crit (ทอง), พลาด (เทา)
   - ถ้ามี Sustained/Lethal จะแสดงเป็นป้ายที่ลูกทอง
   - ช่อง reaction: "Command Re-roll 1 ลูก (1CP)" ให้แตะเลือกลูกที่จะทอยใหม่ (มีเวลาให้ตัดสินใจ ไม่ต้องรีบ)
   - **Wound** → **Save** (ฝ่ายป้องกันทอย ดู 3.6) → **Damage/FNP** → โมเดลที่ตายจางหายไปจากสนาม
   - ปุ่ม `[Skip] ข้าม animation` สำหรับคนที่อยากเล่นเร็ว (ตั้งค่า: Full / Fast / Instant)
5. สรุปผล: "Boyz เสีย 4 ตัว (เหลือ 6/10 → ต่ำกว่าครึ่ง [!] ต้องทอย battle-shock รอบหน้า)"

### 3.5 Charge
1. แตะหน่วย → แสดงศัตรูภายใน 12" (เส้นประพร้อมระยะจริง เช่น `7.4"`)
2. กด **ประกาศชาร์จ** → ทอย 2D6 → แสดงผล max distance → ไฮไลต์เฉพาะเป้าที่อยู่**ภายในระยะทอย** (ตามกฎ 11th)
3. ผู้เล่นเลือกเป้า (หลายหน่วยได้) หรือ **ยกเลิก (ไม่ชาร์จ)** ได้
4. เดินชาร์จ: engine มีปุ่ม **"Auto-place"** ที่จัดโมเดลให้ตามกฎ (ทุกตัวเข้าใกล้เป้า, ตัวที่ถึงต้องถึง, ตัวที่ base contact ได้ต้อง contact) แล้วผู้เล่นค่อยปรับเอง
5. ถ้าเป็น MONSTER/VEHICLE และมี CP → เสนอ **Crushing Impact**

### 3.6 จังหวะของฝ่ายป้องกัน (hotseat)
ใน hotseat ฝ่ายป้องกันต้องตัดสินใจ: ลำดับการรับดาเมจ, Command Re-roll ของ save และ reaction stratagems
- **Allocation order**: engine เรียงให้อัตโนมัติตามกฎ (ตัวที่บาดเจ็บก่อน, CHARACTER ทีหลัง) ถ้ามีหลายกลุ่มที่เลือกได้ใช้ค่า default "ปกป้องตัวที่มีค่าที่สุด" และฝ่ายป้องกันตั้งค่าล่วงหน้าต่อหน่วยได้ (เช่น "ให้ Nob โดนเป็นคนสุดท้าย")
- **Reaction prompt**: แสดงแบนเนอร์ "[Defense] ผู้เล่น 2: ใช้ Fire Overwatch ไหม?" พร้อมปุ่ม `ใช้ / ข้าม / ไม่ต้องถามอีกในเกมนี้`
- ตัวเลือก **"Reaction อัตโนมัติ"**: เช่น ไม่ re-roll save เลย หรือ re-roll เฉพาะเมื่อโมเดลที่มีค่าจะตาย ฯลฯ ช่วยลดการส่งมือถือกลับไปกลับมา

### 3.7 Fight
1. **Pile-in step**: ผู้เล่นเจ้าของเทิร์นได้ปุ่ม "Auto pile-in ทั้งหมด" หรือปรับเองทีละหน่วย → แล้วส่งให้อีกฝ่าย
2. **Fight step**: engine บอกว่า "ตาใครเลือก" และหน่วยไหนเลือกได้ (Fights First ก่อน) → ผู้เล่นแตะหน่วย → เลือกอาวุธ melee 1 ชิ้นต่อโมเดล (default คือชิ้นที่ดีที่สุดเมื่อเทียบกับเป้า) → dice tray
3. ถ้าเป้าตายก่อนถึงตา → engine เสนอ **Overrun Fight** (pile-in เพิ่ม 3")
4. **Consolidate step**: engine เลือกโหมดที่บังคับให้ (Ongoing/Engaging/Objective) และแสดงเป้าหมาย
5. Reaction: **Counteroffensive (2CP)** หลังศัตรูสู้เสร็จ, **Epic Challenge** เมื่อเลือก CHARACTER

### 3.8 Command phase (ทำให้อัตโนมัติเกือบทั้งหมด)
- +1 CP ทั้งสองฝ่ายพร้อม animation
- Battle-shock: engine หาหน่วยที่ต้องทอย ทอยให้ทีละหน่วย 2D6 เทียบ Ld (เสนอ **Insane Bravery** ก่อนทอย ถ้ายังไม่เคยใช้)
- คิดคะแนน primary ตอนจบ Command phase อัตโนมัติ (แสดง +VP ลอยขึ้นมา)

---

## 4. ระบบลูกเต๋า (Dice Tray)
- **RNG**: ใช้ seeded PRNG (เช่น `xoshiro128**`) เก็บ seed ในไฟล์เซฟ → **replay** และตรวจย้อนหลังได้
- ทุกการทอยบันทึกเป็น event: `{type:'hit', dice:[...], target:'3+', mods:[...], rerolls:[...]}` → หน้า **Battle Log** อ่านย้อนได้เหมือน log ของ BG3
- Animation: 2D sprite ลูกเต๋ากลิ้ง 400–700ms แล้วเรียงตามผล (ไม่ต้องใช้ฟิสิกส์ 3D)
- โหมด **Physical dice** (ทางเลือก): ถ้าอยากทอยเต๋าจริง ให้กรอกผลเอง (เช่น "ได้ 6 hit, 2 crit") แล้ว engine คิดต่อ เหมาะกับคนที่เล่นโต๊ะจริงแต่ใช้แอปช่วยคิด

---

## 5. Engine Architecture

```
┌────────────── UI (React + Canvas) ─────────────┐
│  BoardView   UnitCard   DiceTray   Prompts     │
└───────────────▲───────────────────┬────────────┘
                │ state (read-only) │ intents
┌───────────────┴───────────────────▼────────────┐
│               Rules Engine (pure TS)           │
│  GameState ── reducer(intent) → events → state │
│  ├─ PhaseMachine (round/turn/phase/step)       │
│  ├─ Geometry (distance, coherency, LOS, terrain)│
│  ├─ AttackResolver (hit→wound→save→damage)     │
│  ├─ ModifierStack (BS/WS mods, roll mods, caps)│
│  ├─ Stratagems / ReactionWindows               │
│  └─ Missions (scoring hooks)                   │
└───────────────▲────────────────────────────────┘
                │
┌───────────────┴────────────────────────────────┐
│ Data: faction JSON (built from Wahapedia CSV)  │
└────────────────────────────────────────────────┘
```

### 5.1 หลักการ
- **Engine แยกจาก UI 100%** และเป็น pure TypeScript ไม่มี DOM ใช้ test ด้วย Vitest ได้ และนำไปใช้กับ AI หรือ server ออนไลน์ได้ภายหลัง
- **Event-sourced**: state = fold(events) → undo (ก่อนทอย), replay, save/load และ sync ออนไลน์ทำได้ง่าย
- **Intent → Validate → Events**: UI ส่ง intent เช่น `{kind:'move', unit, positions}` ไป engine ตรวจตามกฎ แล้วคืน events หรือ error พร้อมเหตุผล
- **Reaction windows**: phase machine หยุดที่จุดที่กฎเปิดให้ใช้ stratagem (เช่น `end-of-opponent-movement`) ถ้าไม่มีอะไรใช้ได้ ข้ามไปเอง

### 5.2 Phase machine (ย่อ)
```
Setup → [Round 1..5] {
  for player in [first, second]:
    StartOfTurn
    Command:  start → gainCP(both) → battleShock → commandAbilities → end(score)
    Movement: start → moveUnits(each unit selected once; reserves R2+) → end
              ⤷ window: opponent Fire Overwatch / Rapid Ingress
    Shooting: start (⤷ opponent Smokescreen) → shoot(units) → end
    Charge:   start → charges → end  ⤷ opponent Heroic Intervention
    Fight:    start → pileIn(active, then other) → fight(alternate, FF first)
              ⤷ Counteroffensive after each enemy fight → consolidate → end
    EndOfTurn: coherency cleanup → mission scoring → (Aircraft → reserves)
  EndOfRound
} → Victor
```
ตอนจบทุก phase/turn: **ตรวจ objective control ก่อน**กฎอื่น (14.02.01)

### 5.3 Attack resolver (pseudo)
```ts
resolveAttacks(attacker, weaponGroups, target):
  for group in identicalGroups(weaponGroups, perModelCover):    // แยกกองตาม cover ต่อผู้ยิง
    n = sum(rollAttacks(w.A)) + blast(X, target.models) + rapidFire + cleave
    hits = torrent ? n : roll(n).map(d => d==1?miss : d==6?crit : (d+hitMod)>=effBS?hit:miss)
    // effBS = clamp(BS + bsMods, 2, 6); hitMod = clamp(sum(rollMods), -1, +1)  [Note] ตรวจ cap
    sustained / lethal → expand hits
    wounds = roll(hits).map(woundTable(S, targetT) with anti-X, lance, twin-linked)
    devWounds = wounds.filter(crit && DEV) → mortalWounds queue (cap 1 model each)
    saves = defender.allocate(groups).rollAll(normalWounds)          // ทอยพร้อมกัน
    for s in sort(saves asc): applyToCurrentGroup(s, AP, invuln, D, FNP)
    applyMortalWounds(queue)
  hazardous rolls
```

### 5.4 Geometry 2D/2.5D
- หน่วยในโลกเกมเป็น **นิ้ว** (float) สนามขนาด 60×44 แปลงเป็น pixel ที่ UI เท่านั้น
- **โมเดล** = วงกลมหรือวงรีตามขนาดฐาน (CSV มี `base_size` เช่น `32mm`, `60mm`, `Hull`) ถ้าเป็น Hull/FRAME ใช้ polygon
- **ระยะ** = ระยะระหว่างขอบฐาน (circle-circle = d − r1 − r2)
- **Terrain** = `{polygon, category: exposed|light|dense, heightIn, floors:[{heightIn, polygon}], solidBelowIn: 3}`
  - Obscuring: เส้น LOS (ทำเป็น 1mm "ribbon" ประมาณด้วยหลายเส้นระหว่างขอบฐานสองฝั่ง) ตัด polygon ของพื้นที่ที่ไม่ได้ยืนอยู่ = บัง
  - Solid: โมเดลที่ยืนบนพื้นใน dense terrain → LOS เข้าออกผ่านผนังไม่ได้ ชั้นบน (elevation ≥ 3") มองออกได้
  - Hidden/Gone to Ground: เช็ก keyword + ยืนใน terrain + ไม่ได้ยิงเทิร์นนี้/เทิร์นก่อน → detection 15"/12"
  - Plunging fire: elevation ผู้ยิง ≥ 3" และเป้ามีโมเดลอยู่บนพื้น
- **Fully visible**: ประมาณด้วยการยิงเส้น LOS ไปหลายจุดรอบขอบฐานเป้า (8–16 จุด) ถ้าทุกเส้นไม่โดนบังถือว่า fully visible
- **Pathing**: ตอนลากเดิน คำนวณระยะตามเส้นที่ผู้เล่นลาก (หลายท่อน) และ engine ตรวจการชนตามท่อนนั้น (ไม่ต้องหา shortest path)

### 5.5 Abilities ที่ไม่ใช่ core (ระบบ 3 ระดับ)
มี datasheet 1,660 ใบ และ ability/stratagem หลายพันข้อความ การเขียนโค้ดให้ทุกอันทำงานอัตโนมัติจึงทำไม่ได้ใน MVP:

| ระดับ | สิ่งที่ครอบคลุม | วิธีทำ |
|---|---|---|
| **1. Core อัตโนมัติ** | Core rules, weapon keywords (parse จากคอลัมน์ `description` ของ wargear), core abilities (FNP, Deep Strike, Stealth ...) | โค้ดตรงใน engine |
| **2. Effect DSL** | Ability ที่พบบ่อย: "+1 to hit", "re-roll hit 1", "re-roll wounds", "+1 AP", "Lethal Hits", "FNP 5+", "+1 OC", "Fights First", aura ภายใน X" | เขียน JSON ต่อ ability ทีละ faction เช่น `{when:'shooting', target:'self', effect:{hitMod:+1}, condition:{targetWithinObjective:true}}` |
| **3. Manual toggle** | กฎที่ซับซ้อนหรือยังไม่ได้แปลง | แสดงข้อความ ability บนการ์ด และให้ผู้เล่นกดเปิด **buff chip** (`+1 Hit`, `Re-roll 1s`, `+1 Wound`, `FNP 6+`, `Ignore cover`...) ใช้กับการโจมตีครั้งนั้น |

→ แบบนี้เกมเล่นได้ครบทุก faction ตั้งแต่วันแรก (ผ่านระดับ 3) แล้วค่อยเพิ่มระดับ 2 ไปเรื่อย ๆ โดยเริ่มจาก Space Marines และ Orks

---

## 6. Data Model (ย่อ)
```ts
type Inches = number
interface ModelProfile { name; M: Inches|'-'; T; Sv; InSv?; W; Ld; OC; base: Base; keywords: string[] }
interface Weapon { name; range: Inches|'Melee'; A: Dice; skill: number|null; S; AP; D: Dice; abilities: WeaponAbility[] }
interface Datasheet { id; name; faction; role; models: ModelProfile[]; weapons: Weapon[]; abilities: Ability[];
                      keywords; factionKeywords; leaderOf?: string[]; transport?: string; damaged?: {w, text}; points: PointsRow[] }
interface UnitState { id; datasheetId; owner; models: ModelState[]; attachedTo?; embarkedIn?; inReserves;
                      flags: {battleShocked; advanced; fellBack; charged; shotThisTurn; shotLastTurn; setUpThisTurn; ...} }
interface ModelState { id; profileIdx; pos:{x,y}; elevation; woundsLeft; dead; oneShotUsed: string[] }
interface GameState { seed; round; activePlayer; phase; step; players:[PlayerState,PlayerState];
                      units; terrain; objectives; reactionQueue; log: GameEvent[] }
interface PlayerState { cp; vp:{primary, secondary, perRound[]}; stratagemsUsedThisPhase; insaneBraveryUsed; forceDisposition; primary; secondaries }
```

---

## 7. Tech Stack ที่แนะนำ
| ส่วน | เลือก | เหตุผล |
|---|---|---|
| ภาษา | **TypeScript** | engine ซับซ้อน ต้องมี type |
| UI | **React + Vite** เป็น **PWA** | ติดตั้งบนมือถือได้ ใช้ออฟไลน์ได้ ไม่ต้องผ่าน App Store |
| สนาม | **PixiJS** (WebGL) หรือ **Konva** | ต้องลื่นที่ 60fps ตอนลากหลายสิบโมเดล Pixi เร็วกว่า Konva ง่ายกว่า |
| ท่าทาง | `@use-gesture/react` | pinch, pan, long-press |
| State | **Zustand** ห่อ engine | เบา |
| Test | **Vitest** + golden tests จากตัวอย่างในกฎ (เช่นตัวอย่าง Blast 2, Cleave 1, Devastating Wounds, Saint Celestine) | ทำให้มั่นใจว่ากฎถูก |
| เซฟ | IndexedDB (idb-keyval) | เกมยาว เซฟเป็น event log |
| ออนไลน์ (ทีหลัง) | WebSocket + engine ฝั่ง server (ใช้โค้ดเดียวกัน) | engine เป็น pure TS จึงรันบน server ได้ |

---

## 8. Roadmap
| Milestone | สิ่งที่ส่งมอบ | วิธีตรวจว่าเสร็จ |
|---|---|---|
| **M0 Data** | สคริปต์แปลง Wahapedia CSV เป็น JSON ต่อ faction + parser ของ weapon keywords | unit test: Intercessor Squad / Boyz parse ได้ถูก |
| **M1 Engine: Attack** | Attack resolver ครบ + dice RNG + modifier caps + golden tests | ตัวอย่างทุกข้อในกฎผ่าน |
| **M2 Board** | สนาม 2D, terrain, วางและลากโมเดล, coherency, engagement | ลากหน่วย 10 ตัวบนมือถือจริงได้ลื่น |
| **M3 Turn loop** | Phase machine ครบ 5 phase + CP + battle-shock + core stratagems | เล่นจบ 5 round แบบ hotseat ได้ |
| **M4 Mission** | Battlefield Dominance + deployment 1 แบบ + VP | จบเกมแล้วประกาศผู้ชนะได้ |
| **M5 Polish** | Dice tray animation, battle log, tooltip ที่มาของตัวเลข, reaction automation | ทดสอบเล่นจริงกับเพื่อน |
| **M6+** | Army builder เต็ม, effect DSL ของ SM/Orks, primary/secondary อื่น, transports/reserves UI, AI, ออนไลน์ | |

---

## 9. คำถามที่ต้องตัดสินใจก่อนเริ่มเขียนโค้ด
1. **โหมดเล่นแรก**: hotseat (เครื่องเดียว) หรือออนไลน์ 2 เครื่อง หรือเล่นกับ AI? (แนะนำ hotseat ก่อน เพราะ engine ที่ทำไว้จะใช้ต่อกับโหมดอื่นได้)
2. **Faction แรก**: Space Marines vs Orks (ตามกล่อง Armageddon) ได้ไหม?
3. **ภาษา UI**: ไทย หรืออังกฤษ หรือสองภาษา (ชื่อกฎและ keyword ควรเป็นอังกฤษเสมอ ให้ตรงกับการ์ดจริง)
4. **ลูกเต๋า**: ทอยในแอปอย่างเดียว หรือมีโหมดกรอกผลเต๋าจริงด้วย?
5. **ความละเอียดของ terrain**: ใช้ 2.5D (polygon + ความสูง + ชั้น) ตามที่เสนอ พอไหม?
