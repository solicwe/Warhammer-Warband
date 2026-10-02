# Warhammer 40,000 11th Edition — Rules Reference สำหรับ Engine

> แหล่งหลัก: Core Rules 11th edition (ออก 1 มิ.ย. 2026, เกมวางขาย 20 มิ.ย. 2026) ผ่าน Wahapedia (`wahapedia.ru/wh40k11ed/the-rules/core-rules/`)
> และ Chapter Approved 2026-27 Mission Deck ตรวจสอบเมื่อ 2026-10-02
> เลขในวงเล็บ เช่น (09.06) คือเลขหัวข้อใน Core Rules ใช้อ้างอิงเวลาเขียนโค้ดหรือ test
>
> เอกสารนี้ไม่ได้คัดลอกกฎทั้งหมด แต่สรุปเฉพาะส่วนที่ engine ต้อง implement ให้ถูก
> ตัวเลขทุกตัวในนี้ตรวจกับต้นฉบับแล้ว ยกเว้นข้อที่มี ⚠️ ซึ่งยังต้องตรวจซ้ำ

---

## 0. สิ่งที่เปลี่ยนจาก 10th → 11th (สิ่งที่คนเล่น 10th จะพลาดบ่อย)

| เรื่อง | 10th | **11th** |
|---|---|---|
| Engagement Range | 1" | **2" แนวนอน / 5" แนวตั้ง** |
| Coherency | 2" จากตัวอื่น 1–2 ตัว | **2" จากอย่างน้อย 1 ตัว + ต้องอยู่ภายใน 9" ของทุกตัวในหน่วย** |
| หมุนโมเดล (pivot) | เสีย movement | **ฟรี ไม่นับระยะ** |
| เดินผ่านหน่วยฝ่ายเดียวกัน | ได้ | ได้ (ระบุชัด) |
| Cover | +1 Save | **BS ของผู้ยิง แย่ลง 1** (เป็นการปรับค่า stat ไม่ใช่ปรับลูกเต๋า) |
| ที่สูง | – | **Plunging Fire: BS ดีขึ้น 1** |
| ซ่อนตัว | – | **Hidden: ศัตรูมองเห็นได้เฉพาะในระยะ 15"** (Gone to Ground ลดเหลือ 12") |
| Objective | marker วงกลม 40mm | **Terrain Objective = ทั้งพื้นที่ terrain** (ยืนอยู่ในพื้นที่ = อยู่ใน range) |
| Battle-shock | หายเองตอนต้นเทิร์นถัดไป | **ติดค้าง จนกว่าจะทอยผ่านใน Command phase** |
| Charge | ทอยแล้วต้องไปถึง (ระยะ − 1") | **ทอย 2D6 ก่อน แล้วค่อยเลือกเป้า เป้าต้องอยู่ภายในระยะที่ทอยได้** ไม่ชาร์จต่อก็ได้ |
| Pile-in / Consolidate | ทีละหน่วยตอนสู้ | **Pile-in ทุกหน่วยตอนต้น Fight phase / Consolidate ทุกหน่วยตอนท้าย** ระยะ 3" |
| ลำดับ Fight | ฝ่ายที่ไม่ใช่เทิร์นเลือกก่อน | **ผู้เล่นเจ้าของเทิร์นเลือกก่อน** (Fights First ก่อนเสมอ) |
| Fall Back | ทอย Desperate Escape เมื่อ battle-shocked | **Ordered Retreat** (ปกติ) / **Desperate Escape** (ถ้า battle-shocked: hazard roll ทุกตัว) |
| Hazardous | 1 = mortal wound 3 | **Hazard roll: 1–2 ล้ม = 1 MW (3 MW ถ้าเป็น MONSTER/VEHICLE ทั้งหน่วย)** |
| Blast | +1 ต่อ 5 โมเดล | **[BLAST X]: +X ต่อ 5 โมเดล** |
| ใหม่ | – | **[CLEAVE X]** (blast ของ melee), **[CLOSE-QUARTERS]** (= Pistol), **Damaged X** |
| การจัดสรร wound | ทีละครั้ง | **"Fast rolling" อย่างเป็นทางการ: ทอย save ทั้งหมดพร้อมกัน แล้วใช้จากผลต่ำสุดขึ้นไป** |
| Deep Strike / Reserves | >9" | **>8"** ชาร์จต่อต้องทอย ≥ ระยะจริง (ปกติ 9+) |
| Aircraft | มี M | **ไม่มี move ปกติ ทำได้แค่ Ingress แล้วกลับเข้า reserves ตอนจบเทิร์นศัตรู** |
| Army building | 1 Detachment | **Detachment Points (DP): Incursion 2 DP / Strike Force 3 DP** เลือกได้หลาย detachment |
| Mission | เลือกจาก deck ร่วมกัน | **Force Disposition** ของแต่ละฝ่าย กำหนด Primary Mission แยกกัน (ไม่สมมาตร) |
| สนาม | 44"×60" | 44"×60" (เหมือนเดิม) |
| Core CP | +1 ต่อเทิร์น | +1 ทั้งสองฝ่าย ทุก Command phase (เหมือนเดิม) |

---

## 1. Core Concepts

### 1.1 หน่วยและโมเดล
- **Unit** มีโมเดล 1 ตัวขึ้นไป ฐาน (base) นับเป็นส่วนหนึ่งของโมเดล วัดระยะจากจุดที่ใกล้ที่สุดของฐาน (01.04)
- โมเดลที่มี keyword **FRAME** (ส่วนใหญ่คือรถหรือมอนสเตอร์ที่ไม่มีฐาน) วัดจากจุดที่ใกล้ที่สุดของตัวโมเดล (17.02) → ใน 2D ให้แทนด้วย hull polygon แทนวงกลม
- **Starting strength** = จำนวนโมเดลตอนต้น battle round 1 (01.02.01)
  - หน่วย 1 ตัว: Half-strength = wounds เหลือครึ่งหนึ่งของ W; Below half = น้อยกว่าครึ่ง
  - หน่วย ≥2 ตัว: นับจากจำนวนโมเดลที่เหลือ
  - ถ้าหารครึ่งไม่ลงตัว จะไม่มีสถานะ "at half" มีแค่ "below half"

### 1.2 Active player
- ผู้เล่นเจ้าของเทิร์นคือ active player **ยกเว้น** ตอนที่หน่วยใดถูกเลือกให้ move/shoot/fight เจ้าของหน่วยนั้นจะเป็น active player จนกว่าการกระทำนั้นจบ (01.03) → มีผลกับ Rules Sequencing

### 1.3 Rules Sequencing (01.03.02)
กฎที่ trigger พร้อมกัน ให้ resolve ตามลำดับนี้:
1. กฎบังคับของ active player
2. กฎที่ active player เลือกใช้
3. กฎบังคับของ opposing player
4. กฎที่ opposing player เลือกใช้

### 1.4 ลูกเต๋า
- D3 = D6/2 ปัดขึ้น
- **Re-roll**: ทอยใหม่ได้ครั้งเดียวต่อลูก, re-roll ก่อนบวกลบ modifier, ถ้าเป็นผลรวมหลายลูก (2D6) ต้อง re-roll ทั้งหมด (01.05.02)
- **Auto success** (เช่น Torrent, Lethal Hits): ไม่ทอย จึงไม่ใช่ critical (01.05.01)
- **Roll-off**: ทอย D6 คนละลูก สูงกว่าชนะ เสมอทอยใหม่

### 1.5 Leadership / Battle-shock (01.06–01.07)
- **Leadership roll** = 2D6 ≥ Ld (เช่น Ld 6+) ถือว่าผ่าน
- **Battle-shock roll** = leadership roll ถ้าไม่ผ่าน หน่วยจะ battle-shocked:
  - OC ของทุกโมเดลกลายเป็น `-`
  - เจ้าของเลือกหน่วยนี้เป็นเป้าของ **Stratagem ไม่ได้**
  - เริ่ม action ไม่ได้ และ action ที่ทำอยู่จะไม่สำเร็จ
  - Fall back ต้องใช้ **Desperate Escape**

### 1.6 Characteristics (02.02 / 02.04)
| Model | | Weapon | |
|---|---|---|---|
| M | Move (นิ้ว) | Range | ระยะ หรือ "Melee" |
| T | Toughness | A | จำนวน attack (อาจเป็น D6, D3+1) |
| Sv | Armour save (เช่น 3+) | BS/WS | ฝีมือยิง/ฟัน (เช่น 3+) |
| **InSv** | Invulnerable save (ใน 11th เป็น characteristic) | S | Strength |
| W | Wounds | AP | เช่น -1 |
| Ld | Leadership (เช่น 6+) | D | Damage (อาจเป็น D6, D6+1) |
| OC | Objective Control | | |

**ขอบเขตหลังปรับค่า (Modifier caps):**
- M ≥ 1", T ≥ 1, A ≥ 1, S ≥ 1, D ≥ 1, Range ≥ 1"
- Sv และ InSv ดีได้สุดคือ 2+ (ห้าม 1+)
- Ld อยู่ในช่วง 5+ ถึง 8+ (ห้าม 4+ หรือดีกว่า และห้าม 9+ หรือแย่กว่า)
- **BS/WS อยู่ในช่วง 2+ ถึง 6+** (ห้าม 1+ และห้าม 7+)
- AP แย่ได้สุดคือ 0; OC ต่ำสุด 0
- "Improve BS 1" = ลบเลข (3+ → 2+); "Worsen" = บวกเลข
- ⚠️ **Hit roll และ wound roll modifier สูงสุด ±1** (cap ของ roll modifier แยกจาก cap ของ BS stat) ตามที่หลายแหล่งรีวิวรายงานไว้ แต่ข้อความตรงส่วนนี้ไม่ได้อยู่ในชุดที่ดึงมา ต้องตรวจกับ PDF ก่อนล็อกโค้ด
  - ผลคือ cover (−1 BS) + roll modifier −1 ซ้อนกันได้ และ plunging (+1 BS) + heavy (+1 hit) ก็ซ้อนกันได้

---

## 2. Moving (03)

### 2.1 หลักทั่วไป
- ขยับทีละโมเดล เป็นเส้นตรงและ/หรือหมุน ได้กี่ครั้งก็ได้ **การหมุนไม่นับระยะ**
- ผ่านโมเดลฝ่ายเดียวกันได้ ผ่านโมเดลศัตรูไม่ได้ ออกนอกขอบสนามไม่ได้
- ระยะรวมของแต่ละโมเดลต้อง ≤ max distance ของประเภทการเคลื่อนที่นั้น
- **ตอนจบการเคลื่อนที่** (03.01): ต้องอยู่ใน coherency, ไม่ทับโมเดลอื่น หรือคาอยู่ในผนัง และผ่านเงื่อนไข "After Moving" ทุกข้อ **ถ้าไม่ผ่าน ทุกโมเดลกลับที่เดิม** → engine ทำ validation ตอนกด "ยืนยัน" แล้ว rollback ได้เลย
- เดินผ่าน engagement range ของศัตรูได้ ไม่ถือว่า engaged ระหว่างทาง (FAQ 03.04)

### 2.2 Coherency (03.03)
ทุกโมเดลในหน่วยต้อง:
1. อยู่ภายใน **2" แนวนอน (และ 5" แนวตั้ง)** ของโมเดลอื่นในหน่วยอย่างน้อย 1 ตัว
2. อยู่ภายใน **9" แนวนอน (และ 5" แนวตั้ง)** ของ**ทุก**โมเดลในหน่วย
- ต้องเป็นกลุ่มเดียวที่ต่อกัน (FAQ) → ใน engine คือกราฟที่มีขอบเมื่อระยะ ≤ 2" ต้อง connected และ diameter ≤ 9"
- **End of Turn**: หน่วยที่หลุด coherency ต้องลบโมเดลทีละตัวจนกลับมาอยู่ใน coherency (ไม่ trigger กฎตอนตาย)

### 2.3 Engagement (03.04)
- Engagement range = **2" แนวนอน / 5" แนวตั้ง**
- โมเดลอยู่ใน engagement range ของศัตรู = ทั้งสองหน่วย **engaged**

### 2.4 Set Up (03.02)
ต้องอยู่ใน coherency, ต้อง **unengaged**, และผ่านเงื่อนไขอื่นทั้งหมด ถ้าวางไม่ได้ครบทุกตัว หน่วยกลับไปที่เดิม (reserves หรือในรถ)

---

## 3. Making Attacks (04) + Attack Sequence (05)

### 3.1 Select Weapons (04.01)
- **ตอนยิง**: เลือกอาวุธ ranged ได้หลายชิ้นต่อโมเดล
- **ตอนสู้**: ต้องเลือก melee weapon **1 ชิ้น** (+ อาวุธ [EXTRA ATTACKS] ทั้งหมด)
- [CLOSE-QUARTERS]/[PISTOL]: ถ้าไม่ได้ใช้ close-quarters shooting แต่ละโมเดล (ที่ไม่ใช่ MONSTER/VEHICLE) เลือกได้อย่างใดอย่างหนึ่ง: ยิงปืน CQ หรือยิงปืนอื่น (24.07)

### 3.2 Select Targets (04.02)
- **ยิง**: แต่ละอาวุธเลือกหน่วยศัตรู 1 หน่วยที่ **visible**, **อยู่ในระยะ**, **unengaged** (ยกเว้นยิง MONSTER/VEHICLE ที่ engaged)
  - โมเดลที่มองเห็นกับโมเดลที่อยู่ในระยะ เป็นคนละตัวในหน่วยเดียวกันได้ (FAQ)
- **สู้**: เลือกหน่วยที่ engaged กับโมเดลนั้น แบ่ง attack ไปหลายหน่วยได้ (ต้องแจ้งว่ากี่ attack ต่อหน่วย อย่างน้อยหน่วยละ 1)

### 3.3 Resolve Attacks (04.03)
- เลือกหน่วยเป้า → รวบรวม "attack dice" ของอาวุธที่ทำ **identical attacks** (BS/WS, S, AP, D และ ability ที่มีผลเหมือนกัน) มาทอยพร้อมกัน → ทำ attack sequence → วนไปจนครบ
- **ถ้าเป้าได้ cover จากผู้ยิงบางตัวแต่ไม่ใช่ทุกตัว ต้องแยกกองลูกเต๋า** (FAQ) → engine ต้องคำนวณ cover แยกต่อโมเดลผู้ยิง

### 3.4 Hit Roll (05.01)
ทอย D6 ต่อ 1 attack แล้วดูเงื่อนไขแรกที่ตรง:
1. **ได้ 1 (unmodified)** → พลาด
2. **ได้ 6 (unmodified)** → **Critical Hit** (ยังนับเป็น hit)
3. ≥ BS/WS (หลังปรับค่า) → Hit
4. นอกนั้นพลาด

### 3.5 Wound Roll (05.02)
| S เทียบกับ T | ต้องได้ |
|---|---|
| S ≥ 2×T | **2+** |
| S > T | **3+** |
| S = T | **4+** |
| S < T | **5+** |
| S ≤ T/2 | **6+** |

- ได้ 1 (unmodified) → พลาด; **ได้ 6 (unmodified) → Critical Wound**
- **Multiple T** (05.02.01): ถ้าเป็น attached unit ใช้ **T สูงสุดของโมเดล bodyguard** ที่ยังอยู่ ถ้าไม่ใช่ ใช้ T สูงสุดในหน่วย ถ้าเหลือแต่ leader ใช้ T สูงสุดของ leader

### 3.6 Save Rolls (05.03) — 11th ใช้ระบบกลุ่ม
ฝ่ายป้องกันทำ:
1. **Create Groups**: CHARACTER แยกกลุ่มตัวละ 1 กลุ่ม, โมเดลอื่นที่มี W/Sv/InSv เหมือนกันรวมเป็นกลุ่มเดียว
2. **Allocation Order**: ฝ่ายป้องกันเรียงลำดับเอง โดย:
   - กลุ่ม non-CHARACTER ที่มีตัวบาดเจ็บ **ต้องมาก่อน**
   - กลุ่ม CHARACTER **ห้ามมาก่อน** กลุ่ม non-CHARACTER
   - CHARACTER ที่บาดเจ็บต้องมาก่อน CHARACTER ที่ยังเต็ม
3. **ทอย save ทั้งหมดพร้อมกัน** (1 ลูกต่อ 1 wound)

### 3.7 Inflict Damage (05.04)
วนทีละผล save **จากต่ำสุดไปสูงสุด**:
1. **Select Model**: เลือกโมเดลใน current allocation group (ถ้ามีตัวที่บาดเจ็บอยู่ ต้องเลือกตัวนั้น)
2. **Check Save** ดูเงื่อนไขแรกที่ตรง:
   - ได้ 1 (unmodified) → โดนดาเมจ
   - มี InSv และผลทอย ≥ InSv → **กันได้** (InSv ไม่โดน AP)
   - (ผลทอย + AP) ≥ Sv → **กันได้** (เช่น AP -1 ทำให้ 3 เหลือ 2)
   - นอกนั้น → โดนดาเมจ
   > ⇒ เทียบกับ Sv/InSv ของ**กลุ่มปัจจุบัน ณ ตอนนั้น** ถ้ากลุ่มแรกตายหมด ผล save ที่เหลือจะใช้กับกลุ่มถัดไป
3. **Resolve Damage**: โมเดลเสีย wound เท่ากับ D ถ้า ≤0 ตาย **ดาเมจที่เกินไม่ล้นไปตัวอื่น**
   - **Feel No Pain X+** ทอยต่อ 1 wound ที่จะเสีย (ในขั้นนี้)
   - Random D (เช่น D6) ทอยตอนจัดสรรแต่ละครั้ง
4. เมื่อกลุ่มตายหมด กลุ่มถัดไปในลำดับจะกลายเป็น current group; ถ้าทั้งหน่วยตาย attack ที่เหลือหายไป

### 3.8 Mortal Wounds (06.02)
- ไม่มี save ทีละ 1 wound ล้นไปตัวถัดไปได้
- ลำดับเลือกโมเดล: non-CHARACTER ที่บาดเจ็บ → non-CHARACTER อื่น → CHARACTER ที่บาดเจ็บ → CHARACTER
- ถ้าได้ทั้งดาเมจปกติและ MW จาก attack ชุดเดียวกัน → **ทำดาเมจปกติก่อน แล้วค่อย MW**

### 3.9 Hazard Roll (06.03)
ทอย D6: **1–2 = ล้ม** หน่วยโดน 1 MW (หรือ **3 MW** ถ้าทุกโมเดลในหน่วยเป็น MONSTER/VEHICLE) ทอยต่อหน่วยไม่ใช่ต่อโมเดล (ยกเว้นกฎสั่งให้ทอยต่อโมเดล)

### 3.10 Visibility (06.01)
- Line of sight = เส้นตรงกว้าง 1mm จากส่วนใดของผู้มอง ไปถึงส่วนใดของเป้า (ไม่นับโมเดลในหน่วยตัวเองและหน่วยเป้า)
- **Visible** = เห็นบางส่วน; **Fully visible** = เห็นทุกส่วนที่หันมาทางผู้มอง
- Unit visible = มีโมเดลใดก็ได้ visible; Unit fully visible = ทุกโมเดล fully visible

---

## 4. Battle Round (07)

```
Battle Round (×5)
├─ Start of Battle Round
├─ Turn ผู้เล่นที่ไปก่อน
│   ├─ Start of Turn
│   ├─ 1 Command  → 2 Movement → 3 Shooting → 4 Charge → 5 Fight
│   └─ End of Turn (กฎทั่วไปก่อน แล้วค่อยนับคะแนน mission) + เช็ก coherency
├─ Turn ผู้เล่นที่สอง (เหมือนกัน)
└─ End of Battle Round
```
- **Objective control ตรวจตอนจบทุก phase และทุก turn** ทำเป็นอย่างแรกก่อนกฎ "end of phase" อื่น (14.02.01)

### 4.1 Command Phase (08)
1. Start of Command phase
2. **Gain Core CP: ทั้งสองฝ่ายได้ +1 CP**
3. **Battle-shock step**: active player ทอย battle-shock **ทุกหน่วย** ที่ (ก) battle-shocked อยู่แล้ว หรือ (ข) อยู่ที่หรือต่ำกว่า half-strength
   - หน่วยที่ shocked อยู่ ถ้าทอยผ่านจะหายจาก shocked
   - ทอยไม่เกินหน่วยละ 1 ครั้งใน step นี้
   - หน่วยที่อยู่ใน reserves หรือในรถก็ต้องทอย
4. Command abilities (เช่น aura หรือ ability ที่ใช้ใน command phase)
5. End of Command phase (คิดคะแนน Primary หลายใบเกิดตรงนี้)

### 4.2 Movement Phase (09)
**ทุกหน่วยต้องถูกเลือก 1 ครั้ง** (หน่วยที่ไม่ได้สั่งถือว่า Remain Stationary) เลือกได้ทั้งหน่วยบนสนาม ใน reserves และในรถ

| Move type | Max | ทำได้เมื่อ | ผลหลังเดิน |
|---|---|---|---|
| **Remain Stationary** | – | ทุกหน่วย | ไม่ trigger กฎ "เมื่อเดิน" |
| **Normal** | M | บนสนามและ unengaged | ต้อง unengaged; เดิน Normal ได้ครั้งเดียวต่อ phase |
| **Advance** | M + D6 (ทอยก่อนเดิน) | บนสนามและ unengaged | ต้อง unengaged; **ชาร์จไม่ได้และเริ่ม action ไม่ได้จนจบเทิร์น**; ยิงได้แค่ [ASSAULT] |
| **Fall-back** | M | engaged | ต้อง unengaged; **ยิงไม่ได้ ชาร์จไม่ได้ เริ่ม action ไม่ได้** |
| **Disembark** | ดู Transports | อยู่ในรถ | |
| **Ingress** | ดู Reserves | อยู่ใน reserves | |

**Fall-back modes (09.07):**
- **Ordered Retreat**: ใช้ได้ถ้าไม่ battle-shocked
- **Desperate Escape**: ถ้า battle-shocked ต้องใช้แบบนี้ → **hazard roll ทุกโมเดล**, เดินทะลุศัตรูได้, ถ้ายังไม่ shocked ต้องทอย battle-shock หลังเดิน

**MONSTER/VEHICLE** (17.01): ตอน Normal/Advance เดินผ่านโมเดลทั้งเพื่อนและศัตรูได้ (ยกเว้น MONSTER/VEHICLE ด้วยกัน)

**FLY: Take to the Skies** (21.03): ประกาศก่อนเดินหรือก่อนทอย (Normal/Advance/Fall-back/Charge):
- **ระยะสูงสุด −2"** (ยกเว้นมี **HOVER**)
- ไม่นับระยะแนวตั้ง เดินผ่านทุกโมเดลและทุก terrain ได้

### 4.3 Shooting Phase (10)
หน่วยที่อยู่บนสนามและยังไม่ได้ยิง phase นี้ เลือกประเภทการยิง:

| Shooting type | ทำได้เมื่อ | เงื่อนไข |
|---|---|---|
| **Normal** | unengaged และไม่ได้ advance | – |
| **Assault** | unengaged, advance มา, มีอาวุธ [ASSAULT] | ใช้ได้แค่อาวุธ [ASSAULT] |
| **Close-quarters** | engaged, ไม่ได้ advance, มีอาวุธ [CLOSE-QUARTERS] หรือเป็น MONSTER/VEHICLE | ยิงหน่วยที่ engaged ได้; M/V: **−1 hit** ถ้าไม่ใช่ CQ weapon ใส่หน่วยที่ engaged, [BLAST] ห้ามยิงหน่วยที่ engaged; ทหารราบ: ใช้ได้เฉพาะ CQ weapon ยิงหน่วยที่ engaged |
| **Indirect** | unengaged, ไม่ได้ advance, มี [INDIRECT FIRE] | ยิงเป้าที่มองไม่เห็นได้, เป้าได้ cover เสมอ, **re-roll hit ไม่ได้**, **unmodified 1–5 พลาด** (โดนแค่ 6) **ยกเว้นยืนนิ่งเทิร์นนี้และมีหน่วยฝ่ายเราเห็นเป้า → 1–3 พลาด (โดน 4+)** |

- หลังยิง: เริ่ม action ไม่ได้จนจบ phase
- **ยิง MONSTER/VEHICLE ที่ engaged** (17.03): ยิงได้ (ยกเว้น [BLAST]) แต่ **−1 hit** (ยกเว้น CQ weapon จากหน่วยที่ engaged กับมันอยู่)

### 4.4 Charge Phase (11) — เปลี่ยนเยอะ
1. **Declare Charge**: หน่วยต้องอยู่บนสนาม, **อยู่ภายใน 12" ของศัตรู**, unengaged, ไม่ได้ advance หรือ fall back เทิร์นนี้
2. **Charge roll = 2D6** = max distance
3. **เลือก charge target**: หน่วยศัตรูที่อยู่ภายใน 12" **และอยู่ภายในระยะ max distance** (วัดจากระยะจริงถึงหน่วยเป้า ไม่ใช่ระยะ − 2")
   > ⇒ ถ้าศัตรูอยู่ห่าง 8.5" ต้องทอยได้ ≥ 9 (ตัวอย่าง B ในกฎ: แม้จะเข้าใกล้ถึง 2" ได้ก็เลือกเป็นเป้าไม่ได้)
4. **ถ้ายังอยากชาร์จ** ค่อยเดิน (ไม่ชาร์จต่อก็ได้)
- **ระหว่างเดิน**: ทุกโมเดลต้องจบใกล้เป้ามากขึ้น; ตัวที่จบภายใน 1" ได้ต้องจบภายใน 1"; ตัวที่จบแบบ engaged ได้ต้อง engaged
- **หลังเดิน**: ต้อง engaged กับ**ทุก** charge target, **ห้าม** engaged กับหน่วยที่ไม่ใช่เป้า, **ได้ Fights First จนจบเทิร์น**
- ทอยได้ 2 ไม่มีทางสำเร็จ (ยกเว้นมี modifier)
- Modifier ของ charge roll นับรวมก่อนเลือกเป้า (FAQ เช่น Take to the Skies −2")

### 4.5 Fight Phase (12)
```
1 Start of Fight phase
2 PILE IN     – active player ขยับทุกหน่วยก่อน แล้วอีกฝ่ายตาม (หน่วยละไม่เกิน 1 ครั้ง ไม่บังคับ)
3 FIGHT       – สลับกันเลือก
4 CONSOLIDATE – active player ขยับทุกหน่วยก่อน แล้วอีกฝ่ายตาม
5 End of Fight phase
```
**Pile-in move (12.03)** — สูงสุด **3"**
- ทำได้ถ้า: engaged หรือชาร์จเทิร์นนี้ หรือถูกเลือกทำ overrun fight
- เป้า: ถ้า engaged ต้องเลือกทุกหน่วยที่ engaged ด้วย ถ้าไม่ engaged เลือกหน่วยภายใน 5"
- โมเดลที่ติดฐาน (base contact) กับศัตรูขยับไม่ได้; ตัวที่ขยับต้องจบใกล้เป้าที่ใกล้ที่สุดมากขึ้น และต้อง engaged ถ้าทำได้
- หลังเดิน: หน่วยต้อง engaged; โมเดลที่เริ่ม engaged กับหน่วยใด ต้องยัง engaged กับหน่วยนั้น

**Fight step (12.04)**
- หน่วยที่สู้ได้: engaged (หรือ engaged ตอนเริ่ม step) หรือชาร์จเทิร์นนี้ **ต้องสู้ทุกหน่วยที่ทำได้**
- **Resolve Fights First**: เริ่มจาก**ผู้เล่นเจ้าของเทิร์น** สลับกันเลือกหน่วย Fights First (หน่วยที่ชาร์จก็ได้ Fights First) ถ้าฝ่ายหนึ่งหมดแล้ว อีกฝ่ายเลือกต่อ
- **Resolve Remaining**: เริ่มจากผู้เล่นที่ทำให้ขั้นนี้เริ่ม แล้วสลับกันต่อ ถ้ามีหน่วย Fights First ใหม่เกิดขึ้น ให้กลับไปขั้น Fights First
- **Fight types**:
  - **Normal Fight**: หน่วยที่ engaged
  - **Overrun Fight**: หน่วยที่ unengaged (เช่น เป้าตายไปแล้ว) หรือ unengaged ตอนเริ่ม step แล้วกลับมา engaged → **pile-in เพิ่มอีก 1 ครั้ง (3")** แล้วสู้ ถ้าไปชนหน่วยใหม่ หน่วยนั้นจะสู้ได้ phase นี้ด้วย

**Consolidation move (12.08)** — สูงสุด **3"** หน่วยที่ "ทำได้" คือหน่วยที่ eligible to fight ใน phase นี้ เลือกโหมดตามลำดับ (บังคับถ้าเข้าเงื่อนไข):
1. **Ongoing** — ถ้า engaged: เลือกทุกหน่วยที่ engaged ด้วย โมเดลที่ติดฐานขยับไม่ได้ ตัวที่เริ่ม engaged ต้องยัง engaged อยู่ (errata: ถ้ามีหน่วยศัตรูที่ engaged ด้วยแต่ยังไม่ได้สู้ ศัตรูต้องเลือกหน่วยนั้นสู้ทันที)
2. **Engaging** — ถ้าอยู่ภายใน 3" ของศัตรู: ต้องเดินเข้าไปให้ engaged กับทุกหน่วยที่เลือก หน่วยศัตรูที่ยังไม่ได้สู้จะถูกบังคับให้สู้ทันที
3. **Objective** — ถ้าอยู่ภายใน 3" ของ objective: ต้องจบใน range ของ objective และต้อง unengaged
4. ถ้าไม่เข้าข้อใดเลย ไม่ได้ consolidate

---

## 5. Terrain (13)

### 5.1 Terrain area และประเภท
- **Terrain area** = พื้นที่ขอบเขตของ terrain (ฐานหรือแผ่นรอง) ใน 2D ใช้ polygon แทน
- **Exposed** (หลุม ลวดหนาม): เดินผ่านได้หมด ไม่บังสายตา
- **Light** (กำแพงเตี้ย สิ่งกีดขวาง): เดินผ่านได้หมด, ทำให้พื้นที่เป็น **obscuring**
- **Dense** (อาคาร ซากปรักหักพัง ป่า): มีกฎ **Solid** และทำให้พื้นที่เป็น obscuring
  - INFANTRY/BEASTS/SWARM/MOBILE: เดินทะลุแนวนอนได้
  - INFANTRY/BEASTS/SWARM: ปีนแนวตั้งได้
  - ตัวอื่น: ทะลุได้เฉพาะส่วนที่สูง ≤ 2" ถ้าสูงกว่านั้นต้องปีนขึ้นลง (นับระยะ) และห้ามจบบนชั้นที่ไม่ใช่พื้น
- ปีนแนวตั้ง: ต้องอยู่ภายใน ½" ของ terrain และ**นับระยะขึ้นลง**
- จบการเคลื่อนที่บนชั้นบนได้เฉพาะ INFANTRY/BEASTS/SWARM/FLY/MONSTER และต้องวางได้มั่นคงไม่ยื่นออกขอบ

### 5.2 Benefit of Cover (13.08)
ถ้า**ทุกโมเดล**ในหน่วยเป้าเข้าเงื่อนไขอย่างน้อย 1 ข้อ:
- เป็น INFANTRY/BEASTS/SWARM และ**อยู่ใน terrain area**
- **ไม่ fully visible** เพราะมี terrain feature หรือ obscuring area บังอยู่

→ **BS ของ attack นั้นแย่ลง 1** (ไม่ใช่ +1 save)
- ไม่ได้ cover ถ้าอาวุธมี [IGNORES COVER]
- **Stealth**: ได้ cover เสมอเมื่อโดนยิง

### 5.3 Hidden (13.09)
โมเดล hidden ถ้า:
- เป็น INFANTRY/BEASTS/SWARM อยู่ใน terrain area ที่มี light/dense terrain feature
- หน่วยของมัน**ไม่ได้ยิง ranged** ในเทิร์นนี้หรือเทิร์นก่อน (เทิร์นแรกของเกมถือว่าไม่ได้ยิงในเทิร์นก่อน)

→ ศัตรูจะ**มองเห็นได้เฉพาะเมื่ออยู่ภายใน detection range 15"**
- **Gone to Ground**: hidden และไม่ fully visible เพราะมี dense terrain บัง → detection range **−3" (เหลือ 12")**

### 5.4 Obscuring (13.10)
- Terrain area ที่มี light หรือ dense feature = obscuring area
- ถ้า**ทุก** line of sight ระหว่างสองโมเดลผ่าน obscuring area (**ยกเว้น area ที่โมเดลใดโมเดลหนึ่งยืนอยู่**) → มองไม่เห็นกัน

### 5.5 Solid (13.11)
- Dense terrain: **มองผ่านช่องปิดที่สูง ≤ 3" จากพื้นไม่ได้** (ประตู หน้าต่างชั้นล่าง) ชั้นบนมองผ่านหน้าต่างได้
- จบการเคลื่อนที่โดยมีส่วนใดของโมเดลทะลุผ่านส่วนปิดที่สูง ≤ 3" ไม่ได้

### 5.6 Plunging Fire (22.05)
ยิง ranged ใส่หน่วยที่มีโมเดลอยู่บนพื้น (ground level) → **BS ดีขึ้น 1** ถ้า:
- ผู้ยิงยืนบน terrain ที่สูง **≥ 3"** หรือ
- ผู้ยิงมี **TOWERING** และเป้าอยู่ภายใน **12"**
(ไม่มีผลกับ AIRCRAFT ทั้งฝ่ายยิงและฝ่ายโดนยิง)

> **การแปลงเป็น 2D**: แต่ละ terrain feature เก็บข้อมูล `{polygon, category, height, floors[], solidBelow:3}` และแต่ละโมเดลเก็บ `elevation` (ชั้นที่ยืนอยู่) เพื่อคำนวณ LOS, cover, hidden และ plunging โดยไม่ต้องใช้ 3D จริง ดูรายละเอียดใน 02-game-design.md

---

## 6. Objectives (14)
- Objective อยู่ที่ terrain area = **Terrain Objective**: **อยู่ใน terrain area = อยู่ใน range**
- ถ้าจุด objective ไม่ตรงกับ terrain ใช้ marker 40mm: range = **3" แนวนอน / 5" แนวตั้ง**
- **Level of Control**: รวม OC ของโมเดลใน range ฝ่ายที่รวมได้มากกว่าเป็นผู้ควบคุม ถ้าเสมอกันไม่มีใครควบคุม (ยกเว้น secured)
- **Secured**: ถ้าถูก secure จะยังเป็นของเราแม้ไม่มีหน่วยอยู่ จนกว่าศัตรูมี OC มากกว่าตอนจบ phase
- ตรวจตอนจบทุก phase และทุกเทิร์น ก่อนกฎอื่น

---

## 7. Stratagems (15)

**ข้อจำกัด:**
- Stratagem เดียวกันใช้ได้**ไม่เกิน 1 ครั้งต่อ phase** (ต่อผู้เล่น)
- **หน่วยเดียวโดน stratagem ได้ไม่เกิน 1 ใบต่อ phase** (ยกเว้นระบุไว้)
- หน่วย battle-shocked เป็นเป้า stratagem ของเจ้าของไม่ได้
- ลำดับ: เลือกเป้า → จ่าย CP (รวมส่วน +CP ถ้าเลือก) → resolve ผล
- CP ลดต่ำกว่า 0 ไม่ได้; ถ้าราคาเพิ่มจนจ่ายไม่ไหว stratagem จะไม่ทำงานแต่นับว่าใช้ไปแล้ว phase นั้น

**Core Stratagems ทั้ง 10 ใบ:**

| ชื่อ | CP | ใช้เมื่อ | ผล |
|---|---|---|---|
| **Command Re-roll** | 1 | ทันทีหลังทอย Advance / Charge / Damage / Hazard / Hit / Save / Wound / จำนวน attack | re-roll ลูกเดียว (charge re-roll ทั้ง 2D6) |
| **Epic Challenge** | 1 | Fight phase เมื่อหน่วย CHARACTER ถูกเลือกให้สู้ | CHARACTER 1 ตัวได้ [PRECISION] กับอาวุธ melee |
| **Insane Bravery** | 1 | Battle-shock step ของเรา ก่อนทอย | ผ่านอัตโนมัติ (**1 ครั้งต่อเกม**) |
| **Explosives** (Grenades) | 1 | Shooting phase ของเรา | หน่วย EXPLOSIVES/GRENADES ที่ unengaged, eligible to shoot, ไม่ได้ advance: เลือกศัตรูที่ unengaged ภายใน 8" ที่มองเห็น → ทอย 6D6 ได้ 4+ = 1 MW ต่อลูก |
| **Crushing Impact** (Tank Shock) | 1 | Charge phase ของเรา หลัง MONSTER/VEHICLE ชาร์จเสร็จ | ทอย D6 เท่ากับ T ของโมเดล: ได้ 5+ ศัตรูโดน 1 MW (สูงสุด 6), **ได้ 1 ตัวเองโดน 1 MW** |
| **Rapid Ingress** | 1 | จบ Movement phase ของศัตรู | หน่วยใน reserves (ไม่ใช่ AIRCRAFT) ทำ ingress move ห้ามใช้ battle round 1 |
| **Fire Overwatch** | 1 | **จบ Movement phase ของศัตรู** | หน่วยที่ unengaged (ไม่ใช่ TITANIC) ยิงแบบ **Snap Shooting** |
| **Smokescreen** | 1 | เริ่ม Shooting phase ของศัตรู | หน่วย SMOKE และหน่วยที่ถูกหน่วย SMOKE บังไม่ให้ fully visible ได้ cover จนจบ phase |
| **Heroic Intervention** | 1 (+1) | จบ Charge phase ของศัตรู | หน่วยที่ unengaged ภายใน 12" ของศัตรู (VEHICLE ต้องเป็น CHARACTER/WALKER) ชาร์จ: **Leap to Defend** = เป้าต้องเป็นหน่วยที่ชาร์จมา phase นี้ / **Into the Fray (+1CP)** = charge roll สูงสุด 6 และเป้าเป็นหน่วยใดก็ได้ภายใน 6" |
| **Counteroffensive** | 2 | Fight step ของศัตรู หลังหน่วยศัตรูสู้เสร็จ | หน่วยเราได้ Fights First และต้องเป็นหน่วยถัดไปที่เราเลือกสู้ |

**Snap Shooting (15.09):** ยิงได้ 1 หน่วยที่มองเห็นภายใน **24"**, **โดนเฉพาะ 6 (unmodified)** ไม่สน BS และ modifier, re-roll hit ไม่ได้

---

## 8. Actions (16)
- เริ่ม action ไม่ได้ถ้า: ไม่ได้อยู่บนสนาม / เป็น AIRCRAFT หรือ FORTIFICATION / battle-shocked / OC เป็น 0 หรือ `-` / engaged (ยกเว้น TITANIC) / advance หรือ fall back มา / เริ่ม action อื่นไปแล้วเทิร์นนี้
- เมื่อเริ่มแล้ว จนจบเทิร์น: **ยิงไม่ได้** (ยกเว้น TITANIC) และ**ชาร์จไม่ได้**
- ถ้าเดิน (ยกเว้น pile-in/consolidate) หรือออกจากสนาม action จะไม่สำเร็จ

---

## 9. Transports (18)
- Transport capacity ระบุใน datasheet; ขึ้นได้หลายหน่วยถ้าที่พอ
- **DEDICATED TRANSPORT** ต้องมีหน่วยอยู่ข้างในตอน Declare Battle Formations ไม่อย่างนั้นถูกทำลาย
- **Embark**: หลัง Normal/Advance/Fall-back ถ้าทุกโมเดลอยู่ภายใน 3" ของรถ, ไม่ได้ถูกวางลงสนามเทิร์นนี้, และที่พอ
- **Disembark move** (ทำได้ถ้ารถอยู่บนสนาม, หน่วยไม่ได้ขึ้นรถใน phase นี้, รถไม่ได้ advance/fall back ใน phase นี้):

| Mode | เมื่อ | ระยะวาง | ผล |
|---|---|---|---|
| **Rapid** | รถทำ Normal หรือ Ingress phase นี้ (บังคับ) | ภายใน 3" | ชาร์จไม่ได้เทิร์นนี้ ถ้ารถ ingress ต้องทำตามกฎ ingress ด้วย (>8" จากศัตรู ฯลฯ) |
| **Tactical** | รถยืนนิ่งหรือยังไม่ได้เดิน และวางแบบ unengaged ได้ (บังคับ) | ภายใน 3" | **เลือกทำ Normal หรือ Advance ต่อได้** |
| **Combat** | กรณีอื่น (เช่น รถ engaged อยู่) | ภายใน 6" | **hazard roll ทุกโมเดล**, วางแบบ engaged กับศัตรูที่รถ engaged อยู่ได้, หน่วย**battle-shocked** และชาร์จไม่ได้ |

- **Emergency Disembark** (รถถูกทำลาย): hazard roll ทุกโมเดล, วางภายใน 6" ให้ใกล้รถที่สุด (ถ้าวางแบบ unengaged ไม่ได้ วางแบบ engaged ได้, ถ้ายังวางไม่ได้ตัวนั้นตาย), หน่วย **battle-shocked** และชาร์จไม่ได้
- **Firing Deck X**: ตอนรถยิง เลือกได้สูงสุด X โมเดลข้างใน ตัวละ 1 อาวุธ ranged (ไม่ใช่ ONE SHOT) ให้รถยิงด้วย จากนั้นหน่วยข้างในยิงเองไม่ได้จนจบเทิร์น

---

## 10. Attached Units (19)
- **Leader** และ **Support** (ใหม่) แต่ละ bodyguard มี leader ได้ 1 + support ได้ 1
- ผูกกันตอน Muster Armies และ support unit **ต้อง**ผูก
- นับเป็นหน่วยเดียว ได้ keyword ของทุกส่วนรวมกัน
- **T ที่ใช้ตอนโดนโจมตี** = T สูงสุดของ bodyguard ถ้าเหลือแต่ leader ใช้ T สูงสุดของ leader
- กฎ "เมื่อหน่วยตาย" trigger เมื่อโมเดลตัวสุดท้ายที่เริ่มเกมในหน่วยนั้นตาย
- Ability ของ leader ยังมีผล**แม้ bodyguard ตายหมดแล้ว** (ถ้าเริ่มเกมเป็น attached unit)

---

## 11. Strategic Reserves (20) + Deep Strike
- ประกาศตอน Declare Battle Formations, รวมแล้วไม่เกิน **50% ของ points** (นับหน่วยในรถที่อยู่ใน reserves ด้วย); ห้ามเป็น FORTIFICATION
- ลงสนามได้ตั้งแต่ **battle round 2** ด้วย **Ingress move**:
  - วางภายใน **6" ของขอบสนาม** และ **> 8" แนวนอนจากศัตรูทุกหน่วย**
  - **ก่อน battle round 3**: ห้ามวางใน deployment zone ของศัตรู
  - หลังวาง: **เดินอื่นไม่ได้จนถึงต้น Charge phase ถัดไป** (ชาร์จได้)
- **Deep Strike**: ingress ได้ทุกที่บนสนามที่ห่างศัตรู > 8" (รวมถึง deployment zone ศัตรู)
- **จบ battle round 3** หน่วยที่ยังไม่ลงสนามจะถูกทำลาย (ยกเว้นหน่วยในรถที่ ingress แล้ว และหน่วย repositioned)
- จบเกม หน่วยที่ยังอยู่ใน reserves ถูกทำลาย
- **Infiltrators**: deploy ได้ทุกที่ที่ห่าง deployment zone ศัตรูและศัตรูทุกหน่วย > 8"
- **Scouts X"**: ใน pre-battle เดินได้ X" (ต้องจบ > 8" จากศัตรู) หรือถ้าอยู่ใน reserves วางใน deployment zone ตัวเองได้

## 12. Aircraft (23)
- **ต้อง**เริ่มใน reserves, ทำได้แค่ **Ingress move**, จบเทิร์นของศัตรูต้องกลับเข้า reserves
- หน่วยอื่นเดินผ่าน AIRCRAFT ได้ ตอน pile-in/consolidate/surge ไม่นับ AIRCRAFT (ยกเว้นหน่วยที่ FLY)
- ไม่มี plunging fire, ชาร์จไม่ได้, ตีได้เฉพาะหน่วย FLY, มีแค่หน่วย FLY ที่ชาร์จหรือตี AIRCRAFT ได้

## 13. Surge Move (21.01)
เกิดจากกฎเฉพาะ (เช่น โดนยิงแล้วพุ่งเข้าใส่) ทำได้ถ้าไม่ battle-shocked, unengaged, และยังไม่ได้เดิน phase นี้ → พุ่งเข้าหา**ศัตรูที่ใกล้ที่สุด** ต้องจบแบบ engaged ถ้าทำได้ ไม่งั้นให้ใกล้ที่สุด

---

## 14. Core Abilities & Weapon Keywords (24)
**Ability ซ้ำกันไม่ stack** (เช่น [SUSTAINED HITS 1] กับ [SUSTAINED HITS 2] ต้องเลือกอันเดียว เลือกตอน Select Weapons)
**Ability ที่ตามด้วย keyword** เช่น `[LETHAL HITS: VEHICLE]` มีผลเฉพาะเมื่อเป้ามี keyword นั้น

| Keyword | ผล (สำหรับ engine) |
|---|---|
| **[ANTI-X Y+]** | ถ้าเป้ามี keyword X, wound roll unmodified ≥ Y = critical wound (`ANTI-NON-X` = เป้าที่ไม่มี X) |
| **[ASSAULT]** | ใช้ Assault shooting ได้ (หลัง advance) |
| **[BLAST X]** | +X attack dice ต่อทุก 5 โมเดลในหน่วยเป้า (ปัดลง) ไม่มี X ให้ถือว่า X=1; ห้ามยิงใส่หน่วยที่ engaged |
| **[CLEAVE X]** | melee: ถ้าทุก attack ของอาวุธนี้ลงหน่วยเดียว +X attack dice ต่อทุก 5 โมเดลในเป้า |
| **[CLOSE-QUARTERS]** = **[PISTOL]** | ใช้ Close-quarters shooting ได้; ตอนยิงแบบอื่น (ถ้าไม่ใช่ M/V) เลือกได้อย่างใดอย่างหนึ่ง: CQ หรือปืนอื่น |
| **Deadly Demise X** | เมื่อตาย (หลังคนในรถลงแล้ว) ทอย D6: **6** = ทุกหน่วยภายใน 6" โดน X MW (สุ่มแยกต่อหน่วย) |
| **Deep Strike** | ดู Reserves |
| **[DEVASTATING WOUNDS]** | critical wound → จบ sequence, เป้าโดน MW เท่ากับ D (ทำหลังดาเมจปกติ) **MW จากแต่ละ crit ล้นไปได้ไม่เกิน 1 โมเดล** |
| **[EXTRA ATTACKS]** | ใช้เพิ่มจากอาวุธ melee ปกติ (ต้องเลือกทั้งหมด) |
| **Feel No Pain X+** | ต่อ 1 wound ที่จะเสีย ทอย D6 ≥ X ไม่เสีย |
| **Fights First** | ทุกโมเดลต้องมีจึงจะเป็นหน่วย Fights First; ได้อัตโนมัติหลังชาร์จ |
| **Firing Deck X** | ดู Transports |
| **[HAZARDOUS]** | หลังหน่วยโจมตีเสร็จ hazard roll ตามจำนวนอาวุธ hazardous ที่เลือกใช้ |
| **[HEAVY]** | **ใน Shooting phase ของเรา**: +1 hit ถ้า unengaged, ไม่ได้ถูกวางลงสนามเทิร์นนี้, และ**ไม่มีโมเดลไหนเดินเกิน 3"** (ระยะแนวตั้งตอน take to the skies ไม่นับ) |
| **Hover** | Take to the skies ไม่ลด 2" |
| **[IGNORES COVER]** | เป้าไม่ได้ cover (รวมถึงจาก Stealth) |
| **[INDIRECT FIRE]** | ใช้ Indirect shooting ได้ |
| **Infiltrators** | ดู Reserves |
| **[LANCE]** | +1 wound ถ้าชาร์จเทิร์นนี้ |
| **Leader / Support** | ดู Attached Units |
| **[LETHAL HITS]** | critical hit → **เลือก**ให้ wound อัตโนมัติได้ (ถ้าเลือกจะไม่มีทางได้ critical wound) |
| **Lone Operative (X")** | ถ้าไม่ได้อยู่ใน attached unit: ศัตรูมองไม่เห็นถ้าอยู่ไกลเกิน 12" (หรือ X") และยิง indirect ใส่ไม่ได้ถ้าเกินระยะนั้น |
| **[MELTA X]** | เป้าอยู่ภายในครึ่งระยะ → D + X |
| **[ONE SHOT]** | ยิงได้ครั้งเดียวต่อเกม |
| **[PRECISION]** | ถ้าเห็น CHARACTER ในหน่วยเป้า ผู้โจมตีเลือกกลุ่ม CHARACTER นั้นเป็น current allocation group ได้ (DevWounds+Precision: MW ลง CHARACTER ก่อน) |
| **[PSYCHIC]** | เลือก**ไม่สน**modifier ของ BS/WS และ hit roll ได้ (เลือกเฉพาะ modifier ที่เป็นผลเสียได้); ถือเป็น psychic attack |
| **[RAPID FIRE X]** | เป้าอยู่ภายในครึ่งระยะ → +X attack dice |
| **Scouts X"** | ดู Reserves |
| **Stealth** | ทุกโมเดลต้องมี: โดนยิงได้ cover เสมอ |
| **Super-Heavy Walker** | Normal/Advance/Fall-back: เดินผ่านโมเดลได้ (ยกเว้น TITANIC) และผ่าน terrain ที่สูง ≤ 4"; เลือกให้เป็น MOBILE ได้ แต่ถ้าเลือกแล้วจบเดินทอย D6 ได้ 1 = battle-shocked |
| **[SUSTAINED HITS X]** | critical hit → +X hit |
| **[TORRENT]** | hit อัตโนมัติ (ไม่มี crit, ใช้กับ Indirect/Precision ไม่ได้) |
| **[TWIN-LINKED]** | re-roll wound ได้ |
| **Damaged X** | ถ้า wound ที่เหลือ ≤ X → **−1 hit** |

---

## 15. Muster Armies (25)
| Battle size | Points | Detachment Points | Enhancements | Unit limit* |
|---|---|---|---|---|
| **Incursion** | 1000 | 2 DP | 2 | 2 |
| **Strike Force** | 2000 | 3 DP | 4 | 3 |

\* BATTLELINE และ DEDICATED TRANSPORT ได้ limit เป็น 2 เท่า, EPIC HERO ได้ 1 เสมอ
- เลือก **Army Faction** 1 อัน
- **Detachments**: แต่ละอันมีค่า 1–3 DP และเลือก detachment ซ้ำไม่ได้; แต่ละอันให้ **Force Disposition**, detachment rule, enhancements และ stratagems; Incursion ใช้ detachment 3 DP เป็นอันเดียวได้
- **Warlord**: เลือก CHARACTER 1 ตัว
- **Enhancements**: เฉพาะ CHARACTER (ยกเว้นแบบ Upgrade), ห้ามใส่ให้ EPIC HERO, ห้ามซ้ำ, หน่วยละไม่เกิน 1
  - **Upgrade**: ใส่ให้หน่วยที่ไม่ใช่ CHARACTER ได้ ซ้ำได้ 3 ครั้ง (ครั้งที่ 2 และ 3 ไม่นับโควตา แต่ต้องจ่ายแต้ม)

---

## 16. Mission: Chapter Approved 2026-27

### 16.1 ลำดับเตรียมเกม
1. Muster Armies
2. **Determine Mission**: แต่ละคนเลือก **Force Disposition** 1 ใบแบบลับ (จาก detachment ที่มีในรายชื่อกองทัพ) แล้วเปิดพร้อมกัน → หาสัญลักษณ์ของคู่ต่อสู้บนการ์ดของเรา = **Primary Mission ของเรา**
3. **Determine Deployment**: สุ่มการ์ด Deployment 1 ใบ (+ Twist ถ้าทั้งคู่ตกลง)
4. **Create Battlefield**: **44" × 60"**; ทอย D6: 1–5 มี central objective 1 จุด, 6 มี 2 จุด (ห่างจากจุดกลาง 6" ไปทางซ้ายและขวา บนเส้นแบ่ง territory); ผลัดกันวาง terrain ให้ terrain ทับจุด objective
5. **Attacker/Defender**: roll-off ผู้ชนะเลือก
6. **Secondary**: เลือกระหว่าง **Tactical** (จั่ว 2 ใบตอนต้น Command phase; จ่าย 1CP ทิ้งแล้วจั่วใหม่ได้ครั้งเดียวต่อเกม; จบเทิร์นทิ้งการ์ดที่ไม่อยากทำเพื่อรับ 1CP) หรือ **Fixed** (เลือก 2 ใบ ใช้ทั้งเกม) — มือใหม่ไม่ใช้ secondary ก็ได้
7. Declare Battle Formations (ใครอยู่ในรถ ใครอยู่ใน reserves) แบบลับ
8. **Deploy**: ผลัดกันวางทีละหน่วย เริ่มจาก **Defender** (วาง TITANIC แล้วข้ามตาถัดไป)
9. Redeploy (เริ่มจาก Attacker)
10. **First turn: roll-off**
11. Pre-battle rules (Scouts ฯลฯ) ผลัดกัน เริ่มจากคนที่ได้เล่นก่อน
12. เล่น **5 battle rounds** (เล่นต่อจนจบแม้กองทัพหายหมด)

### 16.2 คะแนน (VP)
| แหล่ง | สูงสุด |
|---|---|
| Primary | **45 VP** (ไม่เกิน 15 ต่อ battle round) |
| Secondary | **45 VP** (ไม่เกิน 15 ต่อ battle round; Fixed ใบละไม่เกิน 20) |
| Battle Ready (ทาสีครบ) | 10 VP |
คะแนนที่ได้ตอน "end of the battle" ไม่นับรวมใน cap 15 ต่อรอบ

### 16.3 Force Disposition → Primary Missions
5 แบบ: **Take and Hold, Purge the Foe, Disruption, Reconnaissance, Priority Assets** การ์ดแต่ละใบมี primary 5 ใบตาม disposition ของคู่ต่อสู้ (รวม 25 ใบ)

- Take and Hold: Battlefield Dominance, Immovable Object, Determined Acquisition, Purge and Secure, Inescapable Dominion
- Purge the Foe: Unstoppable Force, Meatgrinder, Punishment, Consecrate, Destroyer's Wrath
- Disruption: Death Trap, Delaying Action, Outmanoeuvre, Smoke and Mirrors, Locate and Deny
- Reconnaissance: Reconnaissance Sweep, Triangulation, Surveil the Foe, Gather Intel, Search and Scour
- Priority Assets: Secure Asset, Vital Link, Extract Relic, Vanguard Operation, Sabotage

**Deployment cards**: Tipping Point, Sweeping Engagement, Search and Destroy, Hammer and Anvil, Dawn of War, Crucible of Battle
**Objective types**: Home (ฐานของแต่ละฝ่าย), Central, Expansion
**Twists**: Nowhere to Hide (ไม่มี Solid), **Mirrored World** (ทั้งคู่ใช้ primary ใบเดียวกัน เหมาะกับมือใหม่), Scrambled Communications (สลับ primary), Martial Pride, Ruinscape (ทุกคนเป็น MOBILE ตอนเดิน), Night Fighting (มองเห็นได้แค่ 18")

**Secondary deck (18 ใบ เหมือนกันทั้งชุด Attacker และ Defender)**: No Prisoners, Overwhelming Force, Plunder, Display of Might, Outflank, Beacon, Cleanse, A Grievous Blow, Defend Stronghold, Engage on All Fronts, Secure No Man's Land, Forward Position, Centre Ground, Assassination, A Tempting Target, Behind Enemy Lines, Bring It Down, Burden of Trust

> แนะนำให้ MVP ใช้ **Mirrored World + Battlefield Dominance** (ยึด objective อย่างเดียว) ก่อน แล้วค่อยเพิ่ม primary/secondary ทีละใบ เพราะแต่ละใบมี trigger และ action เฉพาะของตัวเอง

---

## 17. ⚠️ สิ่งที่ต้องตรวจซ้ำก่อนล็อกโค้ด
1. **Cap ของ hit/wound roll modifier** (±1?) และลำดับการรวมกับ BS modifier → ต้องดูหัวข้อ 02.02.01 ใน PDF ทางการ
2. ข้อความเต็มของ Primary Missions กลุ่ม Disruption / Recon / Priority Assets (ใช้ operation marker และ action เฉพาะ) → ทำทีหลัง MVP
3. Errata และ FAQ จะออกเป็นระยะ ให้ data pipeline ดึงจาก `Last_update.csv` ของ Wahapedia ทุกครั้งที่ build
