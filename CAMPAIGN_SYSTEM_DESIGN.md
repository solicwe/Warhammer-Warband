# Warhammer Warband: Systemic Overhaul Specification ( v2.0 — "The ARPG Tactical Engine" )

เอกสารข้อกำหนดทางเทคนิคและการออกแบบระบบเกมฉบับยกเครื่องใหม่ทั้งหมด สำหรับนำไปใช้พัฒนาด้วย **Antigravity Flash** โดยแก้ปัญหาความน่าเบื่อของค่าสเตตัสแบบเดิม (`+1 Hit`, `+1 Str` ที่ทับซ้อนกัน) และเปลี่ยนผ่านสู่ระบบ **Build-Craft, Trigger Engine, Dynamic Battlefield และ Endgame Grind** ในสไตล์ *Path of Exile (PoE)* ผสานกับกติกา *Warhammer 40,000*

---

## 1. กฎเหล็กของการออกแบบใหม่: "The Strict Separation of Pillars" (ห้ามบัฟทับซ้อน)

ปัญหาเดิมคือ **Skill Tree**, **Relics** และ **Faction Buffs** แจกสิ่งเดียวกัน (เช่น แจก `[DEVASTATING WOUNDS]` หรือแจก `+1 Strength` ทั้งใน Tree และในการ์ด หรือบัฟซ้อนกันระหว่าง `BATTLELINE` กับ `RUBRICAE`) ทำให้ยูนิตทุกตัวเล่นเหมือนกันหมด

ในระบบ v2.0 เราใช้กฎ **Strict Layer Separation** โดยแบ่งเป็น **5 เสาหลักที่ห้ามก้าวก่ายกันโดยเด็ดขาด**:

| เสาหลัก (System Pillar) | หน้าที่หลัก (Core Responsibility) | สิ่งที่อนุญาตให้มี (Allowed Mechanics) | สิ่งที่ห้ามมีเด็ดขาด (Strictly Forbidden) |
|---|---|---|---|
| **1. Unit Archetype & Intrinsic Skill** | กำหนดบทบาทและวิธีเล่นพื้นฐานของยูนิต | Role Tag 1 อย่าง + สกิลติดตัวที่ไม่ซ้ำกันตามประเภท + ช่องใส่ Relic (Sockets 1–3 ช่อง) | ห้ามเป็นแค่ก้อน Stat เปล่าๆ ที่ต่างกันแค่ตัวเลข |
| **2. Combat Tokens & Ailments** | ตัวกลางในการทำคอมโบ (เหมือน Charges และ Ailments ใน PoE) | **3 Buff Tokens** (`Auspex`, `Fervour`, `Bastion`) และ **4 Debuff Ailments** (`Pinned`, `Corroded`, `Soulfire`, `Bleeding`) | ห้ามแจกค่า `+1 Hit / +1 Wound` ตรงๆ โดยไม่ผ่านเงื่อนไขหรือ Token |
| **3. Passive Skill Tree (Global Engine)** | เปลี่ยนกติกาของเกม (Rule-Bending), ขยายเพดาน Token, เงื่อนไขสนามรบ และเศรษฐกิจ | เพิ่ม Max Stacks ของ Token, แปลงค่าพลัง (Conversion), เพิ่มรัศมี Aura, ลด Cooldown และ **Keystones เปลี่ยนวิธีเล่น** | **ห้ามมี Weapon Keywords** (`Devastating Wounds`, `Lethal Hits`, `Sustained Hits`) ใน Tree เด็ดขาด! และห้ามล็อกชื่อยูนิตเฉพาะเผ่า |
| **4. Socketed Relics (PoE Skill/Support Gems)** | มอบคุณสมบัติอาวุธและเอฟเฟกต์ระเบิดคอมโบ (Trigger Procs) ให้ยูนิตที่สวมใส่ | **Weapon Keywords ทั้งหมดอยู่ที่นี่เท่านั้น!** + ระบบ **Trigger-on-Event** (เช่น ยิงติด Crit แล้วสายฟ้าชิ่ง, ฆ่าศัตรูแล้วศพระเบิด) | ห้ามเป็นบัฟทั้งกองทัพ (ต้องเลือกสวมใส่ลงใน Socket ของยูนิตเพื่อสร้าง Build เฉพาะตัว) |
| **5. Faction Ascendancy (Unique Gauge)** | ระบบเกจพลังงานและเมคานิกเฉพาะเผ่าในระหว่างการรบ | เกจพลังงานเฉพาะทัพ (เช่น *Cabal Flux*, *Blood Tithe*, *Reanimation Matrix*, *Strands of Fate*) ที่กดใช้หรือทำงานระหว่างเทิร์น | ห้ามเป็นโหนดแจก Stat แห้งๆ เช่น "Rubric Marines ตีแรงขึ้น +1" |

---

## 2. ระบบตัวกลางคอมโบ: Combat Tokens & Tactical Ailments (PoE Charges & Status System)

เพื่อให้ทั้ง Tree, Relics และ Faction คุยภาษาเดียวกันโดยไม่เกิดปัญหาคีย์เวิร์ดทับซ้อน ระบบจะใช้ **Tokens (บัฟบนตัวยูนิตเรา)** และ **Ailments (ดีบัฟบนตัวยูนิตศัตรู)** เป็นแกนกลาง:

### 2.1 Combat Tokens (สะสมได้สูงสุด 3 Stacks เริ่มต้น — อัปเกรดเพดานใน Tree ได้)
ยูนิตจะได้รับ Token จากการกระทำในสนามรบ และเสียเกจทั้งหมดหากติดสถานะ *Battle-shocked* (ยกเว้นมี Keystone ป้องกัน):

1. **Auspex Token (สีฟ้า — เหมือน Power Charge ใน PoE):**
   - **ผลลัพธ์ต่อ Stack:** ขยายโอกาสติด Critical Hit และความแม่นยำ (ที่ 3 Stacks: การโจมตีของยูนิตนี้ติด Critical Hit บนหน้าเต๋า $5+$ แทนที่จะเป็น $6+$)
   - **การใช้จ่าย (Expend):** ยูนิตบางตัวหรือ Relic บางชิ้นสามารถ "เผา Auspex Token" เพื่อยิงทะลุกำแพง (Indirect Fire) หรือบังคับติด `[DEVASTATING WOUNDS]` ในนัดนั้น
2. **Fervour Token (สีแดง — เหมือน Frenzy Charge ใน PoE):**
   - **ผลลัพธ์ต่อ Stack:** $+1\text{"}$ Movement และเมื่อรวมครบ 3 Stacks ยูนิตจะได้รับ $+1$ Attack ให้กับอาวุธทุกชิ้นของแต่ละโมเดลในกอง
   - **การใช้จ่าย (Expend):** เผา 3 Stacks เพื่อทำการ **Action พิเศษ** เช่น ยิงเสร็จแล้วขยับหนี $4\text{"}$ (Fire and Fade) หรือชาร์จหลังถอยทัพ (Fall Back & Charge)
3. **Bastion Token (สีทอง — เหมือน Endurance Charge ใน PoE):**
   - **ผลลัพธ์ต่อ Stack:** มอบเกราะป้องกันความเสียหาย *Feel No Pain $6+$* (ที่ 2 Stacks เป็น $5+$, ที่ 3 Stacks เป็น $5+$ และลดค่า AP ของศัตรูลง $1$)
   - **การใช้จ่าย (Expend):** เมื่อยูนิตได้รับบาดเจ็บจาก *Mortal Wounds* สามารถเผา 1 Bastion Token เพื่อยกเลิกความเสียหายนั้นได้ $1\text{D}3$ แต้มทันที

---

### 2.2 Tactical Ailments (สถานะผิดปกติบนตัวศัตรู — สะสมได้สูงสุด 5 Stacks)
แทนที่จะบวกค่าพลังโจมตีซ้ำๆ ผู้เล่นสามารถสร้าง Build สายสถานะ (Ailment Build):

| ชื่อสถานะ (Ailment) | เงื่อนไขพื้นฐาน | ผลลัพธ์ต่อ Stack (Effect per Stack) | ผลเมื่อครบเพดาน (Max 5 Stacks Overload) |
|---|---|---|---|
| **[Soulfire / Ablaze]**<br>*(เหมือน Ignite)* | อาวุธไฟ / พลังจิต / Relic สายเพลิง | ศัตรูได้รับ $1$ Mortal Wound ตอนเริ่ม Command Phase ของตัวเองต่อ 1 Stack | **Conflagration:** ระเบิดออกทันที $3$ Mortal Wounds และลามไปติดศัตรูทุกกองในระยะ $4\text{"}$ |
| **[Bleeding / Rend]**<br>*(เหมือน Bleed)* | อาวุธใบเลื่อย / ประชิดติด Crit | ศัตรูได้รับ $1$ Mortal Wound ทันทีที่ขยับตัว (Move, Advance, Charge, Pile-in) หากขยับเกิน $6\text{"}$ โดนสองเท่า! | **Exsanguinate:** ยูนิตศัตรูไม่สามารถสั่ง Run/Advance ได้ และโดนโจมตีด้วยค่า $+1$ to Wound |
| **[Corroded / Sunder]**<br>*(เหมือน Shock/Brittle)* | อาวุธกรด / พลาสม่า / Relic เจาะเกราะ | ทุกๆ 2 Stacks ค่า Armor Save ของเป้าหมายแย่ลง $1$ (เช่น จาก $3+$ เป็น $4+$) | **Armor Shatter:** ค่า Invulnerable Save ของเป้าหมายถูกปิดใช้งานชั่วคราวเป็นเวลา 1 เทิร์น! |
| **[Pinned / Suppressed]**<br>*(เหมือน Chill/Freeze)* | อาวุธระเบิด `[BLAST]` / ปืนกลหนัก | ลดระยะเดินของเป้าหมายลง $-1\text{"}$ ต่อ Stack (สูงสุด $-4\text{"}$) | **Staggered (แช่แข็ง):** ยูนิตนั้นถูกบังคับข้ามการยิง Overwatch และต้องตีเป็นลำดับสุดท้าย (Fights Last) |

---

## 3. ระบบยูนิตใหม่: Combat Archetypes & Socket System (แก้ปัญหายูนิตหน้าตาและวิธีเล่นเหมือนกัน)

ยกเลิกการแบ่งยูนิตด้วยคีย์เวิร์ดซ้ำซ้อน (เช่น บัฟทั้ง `INFANTRY`, `BATTLELINE`, `RUBRICAE` ปนกัน) โดยยูนิตทุกใบในเกมจะถูกจัดเข้าสู่ **1 ใน 6 Combat Archetypes** เท่านั้น และแต่ละยูนิตจะมี **Intrinsic Ability (สกิลติดตัวที่กดใช้หรือทำงานอัตโนมัติ)** พร้อมช่องใส่ Relic (**Augment Sockets**):

### 3.1 ตาราง 6 Combat Archetypes (ทุกยูนิตต้องมีเพียง 1 Role หลัก)

1. **`[ROLE: VANGUARD]` (เดิมคือ Battleline / ทหารราบแนวหน้า):**
   - **บทบาท:** ตัวชี้เป้า, ยึดจุด, และสร้างจังหวะให้เพื่อน (ไม่ใช่ตัวแบกดาเมจด้วยตัวเอง)
   - **Intrinsic Mechanic — *Tactical Spotter*:** เมื่อยูนิต `VANGUARD` โจมตีใส่ศัตรูสำเร็จ ศัตรูกองนั้นจะติดสถานะ **[Exposed]** ไปจนจบเทิร์น เมื่อยูนิตที่ **ไม่ใช่** `VANGUARD` โจมตีใส่เป้าหมายที่ติด `[Exposed]` จะได้รับ **+1 Auspex Token** หรือ **+1 Fervour Token** ทันที!
2. **`[ROLE: BREACHER]` (Terminators, Gravis, Meganobz, Bullgryns, Wraithguard):**
   - **บทบาท:** กำแพงเดินได้ รับดาเมจแล้วสวนกลับอย่างรุนแรง
   - **Intrinsic Mechanic — *Kinetic Absorption*:** ทุกครั้งที่ยูนิตนี้ทอยเซฟผ่านครบ 3 ลูก จะได้รับ **1 Bastion Token** และเมื่อชาร์จเข้าชนศัตรู จะสร้าง *Mortal Wounds* เท่ากับจำนวน Bastion Token ที่มีอยู่ทันที
3. **`[ROLE: SKIRMISHER]` (Jump Packs, Bikes, Cavalry, Jetbikes, Beasts):**
   - **บทบาท:** นักล่าความเร็วสูง ยิ่งวิ่งไกลยิ่งแรง
   - **Intrinsic Mechanic — *Velocity Scaling*:** ระบบจะนับระยะทางรวมที่ยูนิตนี้เคลื่อนที่ในเทิร์นนั้น ($\Delta d$ นิ้ว) ทุกๆ $4\text{"}$ ที่เคลื่อนที่ก่อนทำการโจมตี อาวุธของยูนิตนี้จะได้ $+1$ AP หรือสร้างสถานะ `[Bleeding]` 1 Stack ในเทิร์นนั้น
4. **`[ROLE: GUNSHIP]` (Tanks, Dreadnoughts, Walkers, Artillery):**
   - **บทบาท:** แท่นยิงหนักที่มีระบบจัดการความร้อน/กระสุน
   - **Intrinsic Mechanic — *Overcharge Reactor*:** ในแต่ละ Shooting Phase ผู้เล่นสามารถกดปุ่ม **[Overclock]** ให้ยูนิตนี้ได้ (ยิงซ้ำอีก $50\%$ ของจำนวนนัด หรือเพิ่ม Damage $+1$) แต่ต้องทอยเต๋าความร้อน หากออก $1$–$2$ ยูนิตจะติดสถานะ *Reactor Overheat* (เสีย $1\text{D}3$ Wounds และห้ามขยับในเทิร์นหน้า)
5. **`[ROLE: BEHEMOTH]` (Monsters, Greater Daemons, C'tan, Titanic):**
   - **บทบาท:** บอสฝั่งเรา ยิ่งเลือดลดยิ่งคลั่ง (Reverse-Bracketing)
   - **Intrinsic Mechanic — *Apex Rampage*:** แทนที่เลือดลดต่ำกว่าครึ่งแล้วจะยิงแม่นน้อยลงเหมือนกติกา 40k ปกติ ยูนิต `BEHEMOTH` เมื่อเลือดลดต่ำกว่า $50\%$ จะเข้าสู่โหมด **Enraged**: ปล่อยคลื่นกระแทกใส่ศัตรูรอบตัว $3\text{"}$ ทันที $1\text{D}3$ Mortal Wounds และได้รับ **3 Fervour Tokens** ถาวรจนจบการรบ!
6. **`[ROLE: CONDUIT]` (Characters, Psykers, Officers, Tech-Priests):**
   - **บทบาท:** ตัวจ่ายบัฟและกดสกิล Command Active
   - **Intrinsic Mechanic — *Command Link*:** ยูนิต `CONDUIT` จะแชร์ผลของ **Tokens** และ **Socketed Relics ช่องที่ 1** ของตัวเองให้กับกองทหารที่ตัวเองเข้าไปแนบ (Attached Bodyguard Unit) ด้วย $100\%$!

---

## 4. ระบบการ์ด Relic ใหม่: "The Socket & Trigger Engine" (สไตล์ Skill Gem ของ PoE)

**การเปลี่ยนแปลงครั้งใหญ่:**
- ย้ายคีย์เวิร์ดอาวุธทั้งหมด (`[DEVASTATING WOUNDS]`, `[LETHAL HITS]`, `[SUSTAINED HITS]`, `[TWIN-LINKED]`, `[MELTA]`, `[LANCE]`) ออกจาก Skill Tree มาไว้ที่ **Relic Cards เท่านั้น**
- การ์ด Relic ไม่ได้แค่บวกค่าพลัง แต่แบ่งเป็น **3 ประเภทซ็อกเก็ต (Red / Green / Blue Gems)** ที่เมื่อใส่ในยูนิตเดียวกันจะ **เชื่อมคอมโบกันเอง (Linked Procs)!**
  - ยูนิต `Common` มี **1 Socket**
  - ยูนิต `Rare / Epic` มี **2 Sockets**
  - ยูนิต `Legendary` (หรือยูนิตที่มี Leader แนบ) มี **3 Sockets**

### 4.1 หมวดหมู่ของ Relic Gems (อัปเกรดได้ 3 ระดับ: Lv.1 ➔ Lv.2 ➔ Lv.3)

#### หมวดที่ 1: Keystone Mutator Relics (เปลี่ยนรูปแบบการโจมตีของอาวุธยูนิตนั้น)
| รหัสการ์ด | ชื่อการ์ด | ผลของอาวุธเมื่อสวมใส่ (Lv.1 / Lv.2 / Lv.3) |
|---|---|---|
| `gem_devastation` | **Core of Devastation** | มอบคีย์เวิร์ด `[DEVASTATING WOUNDS]` ให้กับอาวุธของยูนิตนี้ แต่ลดจำนวน Attacks ลง $-1$ (ขั้นต่ำ 1)<br>*(Lv.2: ไม่ลด Attacks / Lv.3: ทุกครั้งที่ติด Devastating Wounds จะสร้าง `[Soulfire]` 1 Stack ด้วย)* |
| `gem_sustained` | **Echoing Chamber** | มอบคีย์เวิร์ด `[SUSTAINED HITS 1]` (Lv.2: `[SUSTAINED HITS 2]` / Lv.3: กระสุนที่แตกตัวเพิ่มจะชิ่งไปโดนยูนิตศัตรูอื่นที่ใกล้ที่สุดในระยะ $6\text{"}$ ได้!) |
| `gem_lethal` | **Bio-Acid Injector** | มอบคีย์เวิร์ด `[LETHAL HITS]` และเมื่อติด Critical Hit จะสร้างสถานะ `[Corroded]` 1 / 2 / 3 Stacks |
| `gem_scatter` | **Fragmentation Splitter** | เปลี่ยนอาวุธยิงของยูนิตให้ยิงออกเป็นลูกปราย: จำนวนนัด (Attacks) เพิ่มขึ้น $+50\% / +75\% / +100\%$ แต่ระยะยิงลดลงครึ่งหนึ่ง และลด Strength ลง $-1$ |
| `gem_singularity` | **Graviton Condenser** | รวมกระสุนทั้งหมดของโมเดลให้ยิงออกเป็น **นัดเดียวที่ทรงพลัง** (Attacks เหลือ $1$ นัดต่อโมเดล) แต่คูณค่า Strength $\times 1.5$ และคูณค่า Damage เท่ากับจำนวนนัดที่หายไป! *(Lv.2: ได้ `[BLAST]` / Lv.3: ดูดศัตรูรอบเป้าหมายเข้ามารวมกัน $3\text{"}$)* |

#### หมวดที่ 2: Trigger & Proc Relics (ทำงานอัตโนมัติเมื่อเกิดเงื่อนไข — PoE Cast-on-Crit / On-Kill)
| รหัสการ์ด | ชื่อการ์ด | เงื่อนไขการทำงาน (Trigger Condition) | เอฟเฟกต์ที่ระเบิดออกมา (Payload Effect - Lv.1 / Lv.2 / Lv.3) |
|---|---|---|---|
| `proc_arc_lightning` | **Tesla Arc Coil** | **On Critical Hit (เมื่อทอย Hit ได้ Crit):** | ปล่อยสายฟ้าชิ่งใส่ยูนิตศัตรูที่อยู่ในระยะ $6\text{"}$ ของเป้าหมาย สร้าง $1 / 2 / 3$ Hits อัตโนมัติด้วยค่า $S4, AP-1, D1$ |
| `proc_corpse_bloom` | **Volatile Spores / Detonator** | **On Model Kill (เมื่อสังหารโมเดลศัตรูได้):** | ศพของศัตรูระเบิดออกทันที! ทอยเต๋า $1\text{D}6$ ต่อโมเดลที่ตาย หากได้ $4+$ (Lv.2: $3+$, Lv.3: $2+$) ยูนิตศัตรูนั้นเสีย $1$ Mortal Wound เพิ่มเติม |
| `proc_vampiric` | **Haemovore Fang** | **On Melee Kill (เมื่อฆ่าศัตรูในระยะประชิด):** | ฟื้นฟูเลือดให้ยูนิตผู้สวมใส่ $1 / 2 / 3$ Wounds (หากเลือดเต็มอยู่แล้ว จะชุบชีวิตโมเดลที่ตายไปแล้วในกองขึ้นมา 1 ตัว เมื่อสะสมครบตามค่า Wounds ของโมเดล!) |
| `proc_nova_shield` | **Reactive Aegis** | **On Losing Bastion Token (เมื่อเสียเกจป้องกัน):** | ปล่อยคลื่นกระแทกรอบตัวในระยะ $4\text{"}$ สร้าง $1 / 2 / 3$ Mortal Wounds และผลักศัตรูถอยหลัง $2\text{"}$ |
| `proc_warp_step` | **Flickerjump Module** | **On Charge / On Kill:** | *(สไตล์ Flicker Strike ของ PoE!)* หากยูนิตนี้กวาดล้างกองศัตรูตายหมดในระยะประชิด ยูนิตสามารถ **เทเลพอร์ตไปหาศัตรูอีกกองในระยะ $9\text{"}$ ($12\text{"}$ ที่ Lv.3)** และนับว่าทำการชาร์จเข้าปะทะต่อทันทีในเฟสเดียวกัน (1 ครั้งต่อเทิร์น)! |

#### หมวดที่ 3: Utility & Aura Relics (สร้างสนามพลังหรือดัดแปลงการเคลื่อนที่)
| รหัสการ์ด | ชื่อการ์ด | ผลลัพธ์พิเศษ (Lv.1 / Lv.2 / Lv.3) |
|---|---|---|
| `util_gravity_well` | **Null-Gravity Tether** | ศัตรูในระยะ $6\text{"} / 8\text{"} / 10\text{"}$ จากยูนิตนี้ ไม่สามารถใช้การถอยทัพ (Fall Back) และถูกลดระยะ Charge ลง $-2\text{"}$ |
| `util_phase_cloak` | **Wraith-Slip Generator** | ยูนิตนี้สามารถเดินทะลุสิ่งกีดขวาง (Terrain) และทะลุผ่านโมเดลศัตรูได้ หากเดินผ่านทับตัวศัตรูจะทิ้งสถานะ `[Soulfire]` ไว้ 1 / 2 / 3 Stacks |
| `util_autoloader` | **Munitorum Servitor-Link** | เมื่อยูนิตนี้ได้รับ **Auspex Token** จะมีโอกาส $50\% / 75\% / 100\%$ ที่จะได้รับเพิ่มอีก 1 Stack ทันที และยิง Overwatch ด้วยหน้าเต๋า $4+$ (แทนที่จะเป็น $6+$) |

---

## 5. ระบบ Passive Skill Tree ใหม่: "Rule-Bending & Token Mastery"

**สิ่งที่เปลี่ยนไปจากระบบเดิม 100%:**
1. **ไม่มีการแจกค่าสเตตัสซ้ำซ้อนกับ Relic** และ **ไม่มีการระบุชื่อยูนิตเฉพาะเผ่า** ในกิ่งกลางอีกต่อไป
2. โหนดย่อย (Small Passives) และโหนดกลาง (Notables) จะเน้นไปที่ **การหา Tokens, การขยายเพดาน Stacks, การลดโทษของสนามรบ, และการเชื่อมโยงระหว่าง 6 Combat Archetypes**
3. **18 Transformative Keystones (ปลายกิ่ง):** ออกแบบตามปรัชญาของ *Path of Exile* คือ **"เปลี่ยนกติกาของเกมไปเลย (Game-Changing Trade-off)"** ไม่ใช่แค่ `+1 Toughness / -2" Move` แบบเดิม

### 5.1 โครงสร้าง 7 กิ่งใหม่ของ Skill Tree (The 7 Tactical Spokes)

1. **Spoke 1: Precision & Auspex (สายคริติคอลและการชี้เป้า — Blue Tokens)**
   - *Small Nodes:* โอกาสได้รับ `Auspex Token` เมื่ออยู่นิ่ง, เมื่อยิงจากที่สูง, หรือเมื่อยิงใส่เป้าหมายที่ติดสถานะ `[Exposed]`
   - *Notable — `Target Lock Matrix`:* เพดานสูงสุดของ `Auspex Token` เพิ่มขึ้นจาก $3 \rightarrow 4$ Stacks (ที่ 4 Stacks: ทุกการโจมตีที่เป็น Critical Hit จะไม่ให้ศัตรูใช้ Benefit of Cover)
2. **Spoke 2: Tempo & Fervour (สายความเร็วและจำนวนการโจมตี — Red Tokens)**
   - *Small Nodes:* โอกาสได้รับ `Fervour Token` เมื่อทำการ Advance, เมื่อชาร์จสำเร็จ, หรือเมื่อสังหารยูนิตศัตรู
   - *Notable — `Adrenaline Surge`:* เพดานสูงสุดของ `Fervour Token` เพิ่มขึ้นจาก $3 \rightarrow 4$ Stacks และ `Fervour Token` ไม่หายไปเมื่อจบเทิร์น
3. **Spoke 3: Bastion & Fortification (สายเกราะพลังงานและการสะท้อนดาเมจ — Gold Tokens)**
   - *Small Nodes:* ได้รับ `Bastion Token` ตอนเริ่มเกม, เมื่อยืนบน Objective, หรือเมื่อถูกโจมตีด้วยอาวุธที่มี $S > T$
   - *Notable — `Unyielding Bulwark`:* เพดานสูงสุดของ `Bastion Token` เพิ่มขึ้นจาก $3 \rightarrow 4$ Stacks และเมื่อยูนิตมี Bastion Token เต็มเพดาน จะไม่ติดสถานะ *Battle-shocked* เด็ดขาด
4. **Spoke 4: Ailment & Entropy (สายสถานะผิดปกติ — DoT & Debuffs)**
   - *Small Nodes:* เพิ่มโอกาสติด `[Soulfire]`, `[Bleeding]`, `[Corroded]`, `[Pinned]` และเพิ่มระยะเวลาของสถานะ
   - *Notable — `Pandemic Contagion`:* เมื่อศัตรูที่มีสถานะผิดปกติตายลง สถานะทั้งหมดบนตัวมันจะ **กระจาย (Proliferate)** ไปยังศัตรูทุกกองในระยะ $6\text{"}$ ทันที!
5. **Spoke 5: Combined Arms & Archetype Synergy (สายคอมโบข้ามบทบาท)**
   - *Small Nodes:* บัฟเมื่อยูนิตต่าง Role ยืนใกล้กันภายใน $6\text{"}$ (เช่น `VANGUARD` ยืนคู่กับ `GUNSHIP` หรือ `BREACHER` ยืนคู่กับ `CONDUIT`)
   - *Notable — `Combined Fire Protocol`:* เมื่อยูนิต `VANGUARD` ยิงใส่เป้าหมาย ยูนิต `GUNSHIP` ทุกตัวที่ยิงใส่เป้าหมายเดียวกันในเทิร์นนั้นจะสามารถยิงโดยไม่ต้องเช็ก Line of Sight (Indirect Fire) ได้!
6. **Spoke 6: Battlefield Control & Objectives (สายควบคุมพื้นที่และกับดัก)**
   - *Small Nodes:* สร้างเขตแดนบน Objective ที่ยึดครองแล้ว (Sticky Objectives)
   - *Notable — `Scorched Earth Booby-Traps`:* เมื่อยูนิตของเรายึด Objective สำเร็จ จะทำการวางทุ่นระเบิดไว้บนจุดนั้น หากศัตรูเดินเข้ามาเหยียบจะโดน $1\text{D}3+1$ Mortal Wounds และติด `[Pinned]` 3 Stacks ทันที!
7. **Spoke 7: Logistics, Salvage & Corruption (สายเศรษฐกิจและการดัดแปลงการ์ด)**
   - *Small Nodes:* เพิ่มดรอป Scrap, เพิ่มโอกาสเจอ **Warp Altars** ในฉากต่อสู้, เพิ่มช่องเก็บการ์ดสำรอง
   - *Notable — `Master Artificer`:* ยูนิตระดับ `Common` ทุกตัวในกองทัพได้รับ **+1 Relic Socket เพิ่มเติม** (จาก 1 ช่อง เป็น 2 ช่อง!)

---

### 5.2 รายชื่อ 12 Transformative Keystones (ตัวอย่างโหนดใหญ่เปลี่ยนวิธีเล่นแบบ PoE)

| ชื่อ Keystone | แรงบันดาลใจจาก PoE | กติกาที่เปลี่ยนไปอย่างสิ้นเชิง (Transformative Rule) |
|---|---|---|
| **1. Warp Inoculation** | *Chaos Inoculation (CI)* | ยูนิตทุกตัวในกองทัพมีค่า **Wounds สูงสุดเหลือเพียง $1$ แต้ม!** (ตัวละครหรือรถถังก็เหลือ 1 เลือด) **แต่:** ยูนิตทุกตัวได้รับ **เกราะพลังงาน (Warp Ward) จำนวนเท่ากับ $150\%$ ของค่า Wounds เดิม** ซึ่งเกราะนี้จะ **ฟื้นฟูกลับมาเต็ม $100\%$ อัตโนมัติ** หากยูนิตนั้นไม่ได้รับบาดเจ็บเลยตลอด 1 เทิร์น และต้านทาน *Mortal Wounds* จากสถานะพิษ/ไฟทั้งหมด! |
| **2. Blood Pact Munitions** | *Blood Magic / Eldritch Battery* | คุณไม่ต้องใช้แต้ม **Command Points (CP)** ในการกดใช้ Stratagems หรือสกิลของแม่ทัพอีกต่อไป! **แต่:** ทุกครั้งที่กดใช้สกิล คุณต้องเลือกเผาเลือด (Wounds) ของยูนิตฝั่งเราในสนามรบจำนวน $1\text{D}3$ Wounds ต่อ $1\text{ CP}$ แทน (และยูนิตที่เสียเลือดจากผลนี้จะได้รับ 3 `Fervour Tokens` ทันที!) |
| **3. Point Blank Doctrines** | *Point Blank* | อาวุธยิงทุกชนิดเมื่อยิงใส่เป้าหมายที่อยู่ **ภายในครึ่งหนึ่งของระยะปืน (Half-Range)** จะได้รับ **Damage $+1$ และ AP ดีขึ้น $1$** **แต่:** หากยิงใส่เป้าหมายที่ไกลเกินครึ่งระยะปืน ความเสียหายสุดท้ายจะถูกหารครึ่ง ($\lceil D / 2 \rceil$) และไม่สามารถติด Critical Hit ได้ |
| **4. Avatar of the Warp** | *Avatar of Fire / Elemental Overload* | อาวุธทุกชนิดของกองทัพ **ไม่สามารถสร้างความเสียหายจากการติด Critical Wound ได้ตามปกติ** **แต่:** ทุกครั้งที่ทอย Hit หรือ Wound ได้หน้า $6$ จะเปลี่ยนเป็นการแปะสถานะ **`[Soulfire]` 2 Stacks** ทันที และเพดานสูงสุดของ `[Soulfire]` บนตัวศัตรูเพิ่มขึ้นจาก $5 \rightarrow 10$ Stacks! |
| **5. Machine Instability** | *Minion Instability* | เมื่อยูนิตประเภท `GUNSHIP` หรือ `BEHEMOTH` ของเราเลือดลดลงเหลือต่ำกว่าหรือเท่ากับ $25\%$ มันจะ **ระเบิดตัวเองทันทีโดยอัตโนมัติ!** สร้างความเสียหาย *Mortal Wounds* เท่ากับ **ค่า Wounds สูงสุดเริ่มต้นของมัน ($100\%$ Max HP)** ใส่ศัตรูทุกกองในระยะ $6\text{"}$! |
| **6. Lone Wolf Protocol** | *Supreme Ego / Lone Messenger* | กองทัพของคุณ **สามารถลงสนามได้ไม่เกิน 4 ยูนิตเท่านั้น!** (ไม่ว่าเพดานแต้มจะสูงแค่ไหน) **แต่:** ยูนิตทั้ง 4 กองในสนามจะได้เป็นระดับ **Apex Boss**: ได้รับค่า Wounds $\times 2$, ได้รับ **2 Actions ต่อเทิร์น** (ยิงได้ 2 รอบ หรือ ตีประชิดได้ 2 รอบ), และมีค่า OC $\times 3$! |
| **7. Unwavering Stance** | *Unwavering Stance / Iron Reflexes* | ยูนิตของคุณ **ไม่สามารถทำการ Advance หรือ Fall Back ได้เลย** และไม่สามารถใช้ Invulnerable Save ได้ **แต่:** ค่า Invulnerable Save ที่มีอยู่จะถูกแปลงไปบวกเข้ากับค่า **Toughness ($+2\text{ T}$)** และยูนิตจะถือว่า "ยืนนิ่ง (Remained Stationary)" เสมอแม้จะเดินปกติก็ตาม! |
| **8. Necromantic Conduit** | *Flesh Offering / Corpse Pact* | ยูนิตทุกตัวในสนามที่ตาย (ทั้งฝ่ายเราและศัตรู) จะทิ้ง **[Corpse Marker]** ไว้บนพื้น ยูนิต `CONDUIT` ของคุณสามารถกดระเบิดศพในระยะ $12\text{"}$ เพื่อชุบชีวิตโมเดลทหารราบของเราขึ้นมาใหม่ หรือดูดศพเพื่อเพิ่มค่า Strength $+2$ ให้กองทัพเป็นเวลา 1 เทิร์น |
| **9. Glass Cannon Overdrive** | *Pain Attunement / Abyssus* | ค่า Armor Save ของยูนิตทุกตัวในกองทัพแย่ลง $2$ ขั้น (เช่น $3+ \rightarrow 5+$) **แต่:** ทุกการโจมตีของกองทัพจะติด **Critical Hit บนหน้าเต๋า $4+$** (แทนที่จะเป็น $6+$)! |
| **10. Synchronized Hive-Mind** | *The Agnostic / Shared Suffering* | ยูนิตทุกตัวในระยะ $6\text{"}$ จากแม่ทัพ (`CONDUIT`) จะ **แชร์หลอดเลือด (Shared HP Pool) ร่วมกัน!** เมื่อยูนิตใดถูกโจมตี ผู้เล่นสามารถเลือกแบ่งความเสียหายไปหักเลือดจากยูนิตอื่นในเครือข่ายแทนได้ตามใจชอบ |
| **11. Temporal Distortion** | *Temporal Chains / Trickster* | การรบถูกยืดออกเป็น **7 Battle Rounds** (จากเดิม 5 รอบ) ในรอบที่ 1–2 ยูนิตของคุณสร้างความเสียหายลดลงครึ่งหนึ่ง แต่ตั้งแต่รอบที่ 4 เป็นต้นไป ยูนิตทุกตัวของคุณได้รับ **Full Re-roll ทั้ง Hit และ Wound** และฟื้นฟูเลือด $2$ Wounds ทุกต้นเทิร์น |
| **12. Vaal Soul-Harvester** | *Vaal Skills Mechanic* | ปิดการได้รับแต้ม CP ตามปกติตอนต้นเทิร์น **แต่:** ทุกครั้งที่สังหารโมเดลศัตรูได้ 1 ตัว คุณจะได้รับ **1 Soul Charge** เมื่อครบ 10 Souls สามารถกดปุ่ม **[Unleash Warp Storm]** เพื่อหยุดเวลาและสั่งให้ยูนิต 1 กองเล่นเทิร์นพิเศษ (Move + Shoot + Charge + Fight) แทรกกลางเทิร์นได้ทันที! |

---

## 6. ระบบ Faction Ascendancy: เมคานิกเฉพาะเผ่าในสนามรบ (แก้ปัญหาแต่ละทัพไม่ Unique)

แทนที่จะให้โบนัสตัวเลขแห้งๆ ทุกกองทัพจะมี **UI Gauge / Active Widget พิเศษบนหน้าจอระหว่างต่อสู้** ที่ทำให้การเล่นแต่ละเผ่าให้ความรู้สึกเหมือนเล่นคนละเกม:

### 6.1 รายละเอียด Ascendancy Mechanics ของแต่ละกองทัพหลัก

#### 1. Thousand Sons — *"The Cabalistic Spellweaver Matrix"* (แก้ปัญหา Rubric Marines ซ้ำกับ Battleline)
- **ไม่มีการบวกค่า Stat ดิบๆ ให้ Rubric Marines อีกต่อไป!**
- **Mechanic ในสนามรบ:**
  - มีเกจ **Arcane Flux** (สะสมได้สูงสุด 12 แต้ม) ได้รับเมื่อยูนิตยืนนิ่ง, ยึดจุด, หรือเมื่อยูนิต `VANGUARD` (เช่น *Rubric Marines*) ยิงโดนศัตรู
  - *Rubric Marines* มีความสามารถเฉพาะตัวคือ **[Automata Conduit]**: พวกมันเป็นหุ่นเชิดไร้ชีวิตจึงไม่ติดสถานะ *Battle-shock* และแม่ทัพ (*Sorcerer*) สามารถ **ใช้ตัว Rubric Marines เป็นจุดปล่อยเวทมนตร์แทนตัวเองได้ (Arcane Relay)!**
  - ผู้เล่นสามารถผสมรูนเวท 3 สี (Tzeentch Runes: *Change, Fire, Fate*) ในระหว่างเทิร์นเพื่อร่ายเวทระดับมหากาพย์ เช่น:
    - `Doombolt Cascade`: ยิงสายฟ้าเวทชิ่งระหว่างกอง *Rubric Marines* ทุกกองในสนาม ลากเส้นผ่านศัตรูตัวไหน ศัตรูตัวนั้นโดน $1\text{D}3$ Mortal Wounds!
    - `Temporal Twist`: สลับตำแหน่งระหว่างกอง *Rubric Marines* กับกองปีศาจหรือรถถังของเราบนกระดานทันที!

#### 2. Space Marines — *"Codex Tactical Stance-Switching"*
- **Mechanic ในสนามรบ:**
  - ทุกต้นเทิร์น และ **ระหว่างเทิร์น (ใช้ 1 CP)** ผู้เล่นสามารถสลับโหมดการรบของกองทัพได้ 3 Stances แบบเรียลไทม์ พร้อมระบบ **Oath of Moment Combo**:
  - หากยูนิตทำตามลำดับคอมโบ: `ยิงกดดันด้วยปืน ➔ ชาร์จเข้าประชิดใส่เป้าหมาย Oath เดียวกันในเทิร์นเดียว` จะเกิดเอฟเฟกต์ **[Codex Execution]**: เรียก Drop Pod หรือ Orbital Strike ลงมาใส่หัวเป้าหมายนั้นฟรีทันที!

#### 3. World Eaters & Chaos Daemons — *"The Blood Tithe Altar"*
- **Mechanic ในสนามรบ:**
  - ทุกครั้งที่ **โมเดลของใครก็ตามตายในสนาม (ทั้งฝ่ายเราและศัตรู!)** เลือดจะไหลเข้าสู่หลอด **Blood Tithe (8 ระดับ)**
  - ยูนิตฝ่ายเราที่เสียเลือดจะได้รับบัฟ **Blood Frenzy** (ยิ่งเลือดเหลือน้อย ยิ่งวิ่งเร็วและตีเร็วขึ้น)
  - เมื่อหลอดเลือดเต็ม สามารถกดอัญเชิญ **Bloodthirster / Daemon Prince** ลงมากลางกองศพศัตรูได้ฟรีกลางสนามรบ!

#### 4. Necrons — *"Reanimation Capacitor & Gauss Overcharge"*
- **Mechanic ในสนามรบ:**
  - โมเดล Necron ที่ตายจะไม่หายไปจากกระดาน แต่จะกลายเป็น **[Dormant Engram Marker]** นอนอยู่ตรงจุดที่ตาย
  - มีเกจพลังงาน **Dynastic Grid**: ผู้เล่นสามารถเลือกปรับสวิตช์พลังงานได้ระหว่าง:
    1. **โหมด Resurrection:** ชุบชีวิตโมเดลจาก Marker ขึ้นมาในต้นเทิร์น (แม้ว่าทั้งกองจะตายหมดไปแล้วก็ตาม หากยังมี Marker เหลืออยู่!)
    2. **โหมด Gauss Detonation:** สั่งให้ซากหุ่น Necron ที่นอนอยู่บนพื้น **ปล่อยกระแสไฟฟ้าช็อตศัตรูที่เดินเหยียบ** แล้วดูดพลังงานมาเพิ่มดาเมจปืน Gauss ให้ยูนิตที่ยังรอดชีวิต!

#### 5. Orks — *"The WAAAGH! Momentum Meter"*
- **Mechanic ในสนามรบ:**
  - เกจ **WAAAGH! Momentum** จะเพิ่มขึ้นทุกครั้งที่ทอยลูกเต๋าตระกูลโจมตี (ยิ่งทอยเต๋าเยอะ แม้จะยิงไม่โดนเลย เกจก็พุ่ง!) และลดลงหากยูนิต Ork ถอยหนีหรือยืนเฉยๆ
  - มี 3 ระดับความคลั่ง:
    - *Tier 1 (Rowdy):* ปืนทุกกระบอกยิงเบิ้ลนัด (`Dakka!`) แต่ความแม่นยำแกว่ง
    - *Tier 2 (Proper Killy):* ยูนิตทุกตัววิ่งชนสิ่งกีดขวางพังทลายและชาร์จได้หลัง Advance
    - *Tier 3 (DA BIGGEST WAAAGH!):* กองทัพ Ork ทั้งหมดจะ **ไม่ตายในเทิร์นนั้น!** (โมเดลที่เลือดหมดจะยังยืนตีต่อจนกว่าจะจบ Fight Phase แล้วค่อยล้มลง!)

#### 6. Tyranids — *"Biomass Evolution & Synapse Web"*
- **Mechanic ในสนามรบ:**
  - เมื่อยูนิต Tyranid กัดกินศัตรูในระยะประชิด จะดรอปก้อน **[Biomass Globules]**
  - ผู้เล่นสามารถใช้แต้ม Biomass **กลายพันธุ์ยูนิตกลางสนามรบ (Mid-Battle Hyper-Adaptation)** ได้ทันที! เช่น เปลี่ยนแขนของฝูง *Termagants* ให้กลายเป็นกรงเล็บพิษ หรือรวมร่างฝูงตัวเล็กที่บาดเจ็บ 2 กองให้กลายร่างเป็นมอนสเตอร์ยักษ์ 1 ตัว!

#### 7. Aeldari / Drukhari — *"Strands of Fate & Webway Gates"*
- **Mechanic ในสนามรบ:**
  - ต้นเกมจะทอยลูกเต๋า **Fate Dice 6 ลูก** เก็บไว้ข้างจอ ผู้เล่นสามารถหยิบลูกเต๋าที่ทอยไว้ล่วงหน้านี้ไป **เสียบแทนผลการทอยเต๋าจริงในจังหวะสำคัญ** (เช่น บังคับให้ทอย Save ออก 6 หรือบังคับให้ชาร์จติด 12 นิ้วแน่นอน!)
  - สามารถวาง **Webway Portal** 2 จุดบนแผนที่ ยูนิตที่เดินเข้าจุดที่ 1 จะโผล่ออกที่จุดที่ 2 ข้ามฟากกระดานทันที!

#### 8. T'au Empire — *"Tactical Markerlight & Kauyon/Mont'ka Grid"*
- **Mechanic ในสนามรบ:**
  - ระบบเลเซอร์ชี้เป้า (Markerlight Laser Lines): เมื่อลากเส้นเลเซอร์จากยูนิต 2 กองตัดกันที่ตัวศัตรู (**Crossfire Mechanic**) ศัตรูที่อยู่จุดตัดเลเซอร์จะโดนยิงด้วยความเสียหายทะลุเกราะและติด `[Pinned]` ทันที
  - หุ่นรบ Battlesuits มีระบบ **Jetpack Thrust**: ยิงเสร็จแล้วกระโดดถอยหลังเข้าหลังกำแพงได้ทุกเทิร์น

#### 9. Astra Militarum — *"Vox-Network Orders & Endless Reinforcements"*
- **Mechanic ในสนามรบ:**
  - ทหารราบมีราคาถูกและตายง่าย แต่มีปุ่ม **[Send in the Next Wave!]**: เมื่อกองทหารราบตายยกกอง ผู้เล่นสามารถเรียกกำลังเสริมกองใหม่วิ่งเข้ามาจากขอบกระดานได้เรื่อยๆ ตราบใดที่รถบัญชาการหรือนายพลยังมีชีวิตอยู่!
  - สามารถเรียก **Artillery Barrage (ปืนใหญ่สนับสนุนนอกจอ)** ถล่มพิกัดที่กำหนดไว้ล่วงหน้า 1 เทิร์น

#### 10. Death Guard — *"Nurgle's Contagion Rings"*
- **Mechanic ในสนามรบ:**
  - รอบตัวยูนิตทุกตัวจะมีวงออร่าพิษสีเขียวที่ขยายใหญ่ขึ้นเรื่อยๆ ทุกเทิร์น ($3\text{"} \rightarrow 6\text{"} \rightarrow 9\text{"} \rightarrow 12\text{"}$)
  - ศัตรูที่อยู่ในวงพิษจะติดสถานะ `[Corroded]` และ `[Soulfire]` อัตโนมัติทุกเทิร์น และเมื่อศัตรูตายในวงพิษ จะกลายเป็นซอมบี้ *Poxwalkers* มาช่วยเราสู้ต่อทันที!

---

## 7. ระบบ Dynamic Battlefield Events: เอฟเฟกต์พิเศษระหว่างการรบ (PoE League Mechanics)

เพื่อไม่ให้การรบ 5 เทิร์นเป็นการเดินยิงกันบนกระดานโล่งๆ ในทุกด่านจะมีการสุ่มเกิด **Dynamic Anomalies (1–2 จุดต่อแมตช์)** ที่เปลี่ยนจังหวะการเล่นระหว่างเกม:

| ชื่อ Event ระหว่างเกม | แรงบันดาลใจ | กติกาและสิ่งที่เกิดขึ้นในสนามรบ (In-Battle Gameplay) | รางวัลพิเศษหากทำสำเร็จ |
|---|---|---|---|
| **1. Warp Rift Breach**<br>*(เสาแยกมิติวาร์ป)* | *PoE Breach / Abyss* | ในรอบที่ 2 จะมีรอยแยกสีม่วงปรากฏขึ้นกลางสนาม หากยูนิตของคุณวิ่งไปเหยียบ รอยแยกจะขยายวงออกเป็นเวลา 2 เทิร์น และมี **ฝูงปีศาจวาร์ป (Neutral Hostiles)** ผุดขึ้นมาโจมตีทั้งสองฝ่าย! | ทุกตัวที่ฆ่าได้ในวง Breach จะดรอปแร่ **Warp Shards** และหากเคลียร์ทันเวลาจะดรอป **Corrupted Relic** ทันที 1 ชิ้น! |
| **2. Archeotech Shrine**<br>*(แท่นบูชาเทคโนโลยีโบราณ)* | *PoE Shrines* | แท่นพลังงานที่สุ่มเกิดบนแผนที่ ยูนิตกองแรก (ของเราหรือของ AI) ที่วิ่งไปแตะแท่นนี้จะได้รับ **บัฟระดับพระเจ้าเป็นเวลา 2 เทิร์น** เช่น:<br>- *Lightning Shrine:* เรียกสายฟ้าผ่าศัตรูรอบตัวทุกๆ การเดิน $3\text{"}$<br>- *Goliath Shrine:* ขนาดโมเดลใหญ่ขึ้น เลือด $+100\%$ และเดินเหยียบกำแพงพังได้! | สร้างจังหวะแย่งชิงพื้นที่ (King of the Hill) ที่ดุเดือดนอกเหนือจากจุด Objective ปกติ |
| **3. Eldritch War-Altar**<br>*(แท่นพันธสัญญาเทพมืด)* | *Eater of Worlds Altars* | เมื่อเข้าสู่ต้นรอบที่ 2 และ 4 หน้าจอจะเด้งตัวเลือก **Risk vs. Reward 2 ข้อ** ให้ผู้เล่นเลือกกด 1 ข้อ เช่น:<br>- *ทางเลือก A:* ศัตรูทุกตัวในสนามได้รับ $+2$ Attacks และ `[LETHAL HITS]`, **แต่** เมื่อจบด่านนี้คุณได้รับ **Relic ระดับ Epic เพิ่มฟรี 2 ชิ้น!**<br>- *ทางเลือก B:* อุกกาบาตตกใส่สนามรบสุ่มจุดทุกเทิร์น, **แต่** ดรอปเงิน Scrap เพิ่มขึ้น $+150\%$! | ผู้เล่นที่ทัพแข็งแกร่งสามารถกดรับความยากเพิ่มกลางคันเพื่อปั๊มของรางวัล (Juice the Map)! |
| **4. Promethium Fuel Leak**<br>*(ท่อเชื้อเพลิงรั่วไหล)* | *Environmental Hazard* | พื้นสนามบางโซนมีน้ำมันรั่ว หากมีการยิงอาวุธไฟ, พลาสม่า หรือเกิดสถานะ `[Soulfire]` ในโซนนั้น พื้นจะ **ระเบิดลุกเป็นไฟทั้งโซน** สร้างความเสียหายและกลายเป็นกำแพงควันบังสายตา (LOS Blocker) | เปิดโอกาสให้ใช้สภาพแวดล้อมทำลายกองทัพศัตรูที่ยืนกระจุกกัน |

---

## 8. ระบบ Endgame Grind & Gameplay Loop (ทำให้น่าเล่นซ้ำและปั้นทัพได้เรื่อยๆ)

เพื่อให้เกมมี Gameplay Loop ที่เสพติดเหมือน Path of Exile เราเพิ่มระบบ **Crafting, Unit Veterancy Mutation, และ Crusade Waystones (Map System)**:

### 8.1 ลูปการเล่นหลัก (The Core Roguelite + ARPG Grind Loop)
$$\text{Deploy Battle} \longrightarrow \text{Trigger Mid-Game Altars/Breaches} \longrightarrow \text{Collect Scrap, Warp Shards \& Relics} \longrightarrow \text{Socket \& Link Relics on Units} \longrightarrow \text{Forge / Corrupt Items at Munitorum} \longrightarrow \text{Juice Next Map Node with Affixes}$$

### 8.2 ระบบ "The Munitorum Forge" (Crafting & Vaal Corruption)
แทนที่จะได้การ์ดซ้ำมาแค่อัปเกรด Lv.1 ➔ Lv.3 แบบเส้นตรง ผู้เล่นสามารถใช้แร่ **Warp Shards** ในหน้าแคมเปญเพื่อดัดแปลงการ์ดยูนิตและการ์ด Relic:
1. **Reforge Socket Links:** สุ่มสีหรือเพิ่มจำนวนช่องใส่ Relic (Sockets) บนการ์ดยูนิต (สูงสุด 3 ช่อง)
2. **Imprint Trait (สกัดสกิล):** ย่อยการ์ด Relic ที่ไม่ใช้ เพื่อนำเอฟเฟกต์ของมันไป **หลอมรวม (Fuse)** เข้ากับการ์ด Relic อีกชิ้น (สร้าง **Hybrid Dual-Relic** ที่มี 2 เอฟเฟกต์ใน 1 ช่อง!)
3. **Warp Orb of Corruption (เหมือน Vaal Orb ใน PoE!):**
   - กดใช้ใส่การ์ดยูนิตหรือ Relic ที่มีอยู่แล้ว หลังจากกดใช้ การ์ดจะติดสถานะ **`[CORRUPTED]`** (แก้ไขต่อไม่ได้อีก) และสุ่มผลลัพธ์ 1 ใน 4 อย่าง:
     - **25% — Ascended Mutation (เทพเจ้าประทานพร):** ได้รับความสามารถระดับทะลุเพดาน เช่น การ์ดยูนิตลดค่าร่ายแต้มลง $-30\%$ หรือ Relic อัปเกรดเป็น **Lv.4 (Mythic)**!
     - **25% — White Sockets:** ช่องใส่ Relic ทั้งหมดของยูนิตนั้นใส่การ์ดข้ามประเภทได้โดยได้รับโบนัสพิเศษ $+25\%$
     - **25% — Chaotic Reroll:** เปลี่ยนอาวุธของยูนิตนั้นให้กลายเป็นอาวุธข้ามสายพันธุ์ (เช่น Space Marine ถือปืน Gauss ของ Necron!)
     - **25% — Brick / Warp Spawn:** การ์ดใบนั้นกลายสภาพเป็นยูนิต **Chaos Spawn** หรือติดคำสาปเสียเลือดทุกเทิร์น!

### 8.3 ระบบ "Unit Veterancy & Battle Scars" (ยูนิตแต่ละตัวในคลังไม่เหมือนกัน)
เมื่อยูนิตผ่านการรบครบทุกๆ 3 ด่าน และรอดชีวิต ยูนิตจะไม่เพียงแค่ได้ชื่อว่า `VETERAN` แบบเดิม แต่จะได้รับ **Random Crusade Trait (สุ่มเลือก 1 จาก 3 อย่าง)** ติดตัวการ์ดใบนั้นไปตลอดทั้ง Run เช่น:
- *`Titan-Slayer of Sector 7`:* ยูนิตใบนี้สร้างความเสียหาย $+2$ เมื่อโจมตีใส่ `BEHEMOTH` หรือ `GUNSHIP`
- *`Bionic Reconstruction`:* โมเดลแรกในกองนี้ที่ตายในแต่ละการรบ จะลุกกลับขึ้นมาใหม่ด้วยเลือดเต็มหลอดในเทิร์นถัดไปเสมอ
- *`Trigger-Happy`:* ยูนิตนี้ยิงอัตโนมัติใส่ศัตรูที่เดินเข้ามาในระยะ $12\text{"}$ ฟรี 1 ครั้งต่อเทิร์น โดยไม่ต้องเสีย CP กด Overwatch!

### 8.4 ระบบ Endgame: "The Maelstrom Atlas" (PoE Map & Waystone System)
เมื่อผู้เล่นปราบบอสของ Sector ที่ 1 สำเร็จ เกมจะไม่เป็นแค่การวนลูปด่านเดิมที่บวกเลือดศัตรู แต่จะปลดล็อกกระดาน **Maelstrom Atlas**:
- ก่อนเข้าด่าน ผู้เล่นสามารถใช้ Scrap เพื่อ **Craft Map Modifiers (ใส่คำสาปให้ด่าน)** สูงสุด 4 ข้อ เช่น:
  - *Prefix:* `Map contains 2 extra Archeotech Shrines` / `All Enemy Units have [Flickerjump] on Kill`
  - *Suffix:* `Enemy Army has +300 Points of Behemoths` $\longrightarrow$ **`+80% Item Rarity & +120% Warp Shard Quantity`**
- ยิ่งใส่ Modifiers ยาก ของรางวัลและโอกาสตก **Uber Relics** ก็ยิ่งสูงขึ้น!

---

## 9. โครงสร้างข้อมูล JSON / TypeScript สำหรับส่งให้ Antigravity Flash พัฒนาต่อ

```typescript
// ============================================================================
// WARHAMMER WARBAND v2.0 — CORE DATA SCHEMAS FOR ANTIGRAVITY FLASH
// ============================================================================

// 1. บทบาทหลักของยูนิต (แยกขาด ไม่ซ้อนทับกัน)
export type UnitCombatRole =
  | 'VANGUARD'    // เดิมคือ Battleline: ชี้เป้า แปะ [Exposed] ให้เพื่อนได้ Token
  | 'BREACHER'    // เกราะหนัก: รับดาเมจสะสม Bastion Token แล้วชนระเบิด
  | 'SKIRMISHER'  // ความเร็วสูง: ดาเมจ/AP สเกลตามระยะทางที่วิ่งในเทิร์นนั้น
  | 'GUNSHIP'     // ยานเกราะ/ปืนใหญ่: มีปุ่ม Overclock เสี่ยงเครื่องร้อนแลกดาเมจแรง
  | 'BEHEMOTH'    // มอนสเตอร์ยักษ์: เลือดต่ำกว่า 50% เข้าโหมด Enraged (Reverse-Bracket)
  | 'CONDUIT';    // แม่ทัพ/ผู้ใช้พลังจิต: แชร์ Token และ Relic ช่องแรกให้ลูกน้อง

// 2. ระบบ Combat Tokens (บนตัวยูนิตเรา) และ Ailments (บนตัวศัตรู)
export interface UnitCombatState {
  tokens: {
    auspex: number;   // สีฟ้า: ขยายระยะ Crit / เผาเพื่อยิงทะลุกำแพง
    fervour: number;  // สีแดง: +1" Move ต่อ stack, ครบเพดานได้ +1 Attack
    bastion: number;  // สีทอง: มอบ FNP / เผาเพื่อกัน Mortal Wounds
  };
  maxTokenCaps: {
    auspex: number;   // Default = 3 (เพิ่มได้จาก Skill Tree เท่านั้น)
    fervour: number;  // Default = 3
    bastion: number;  // Default = 3
  };
  ailments: {
    soulfire: number; // DoT ต้นเทิร์น ครบ 5 ระเบิดลาม 4"
    bleeding: number; // โดน Mortal Wound เมื่อขยับตัว
    corroded: number; // ลดเกราะ Save ศัตรู ครบ 5 ปิด Invuln Save
    pinned: number;   // ลดระยะเดิน ครบ 5 ห้าม Overwatch และตีช้าสุด
  };
  isExposed: boolean; // แปะโดยยูนิต VANGUARD เท่านั้น
  warpWardHP: number; // เกราะพลังงาน (สำหรับ Keystone: Warp Inoculation)
}

// 3. ระบบการ์ด Relic แบบสวมใส่ใน Socket (PoE Skill/Support Gems)
export type RelicCategory = 'MUTATOR' | 'TRIGGER_PROC' | 'UTILITY_AURA';

export type TriggerEventType =
  | 'ON_CRIT_HIT'
  | 'ON_MODEL_KILL'
  | 'ON_MELEE_KILL'
  | 'ON_CHARGE_COMPLETE'
  | 'ON_TOKEN_EXPEND'
  | 'ON_DAMAGE_TAKEN';

export interface SocketedRelicCard {
  id: string;
  name: string;
  category: RelicCategory;
  level: 1 | 2 | 3 | 4; // Lv.4 ได้จากการกด Warp Corruption เท่านั้น
  isCorrupted: boolean;
  // คีย์เวิร์ดอาวุธจะมีอยู่ที่นี่เท่านั้น ห้ามมีใน Skill Tree!
  grantedWeaponKeywords?: Array<'DEVASTATING_WOUNDS' | 'SUSTAINED_HITS' | 'LETHAL_HITS' | 'MELTA' | 'BLAST' | 'LANCE'>;
  // ระบบ Trigger Proc
  triggerEvent?: TriggerEventType;
  procPayloadId?: 'ARC_LIGHTNING' | 'CORPSE_BLOOM' | 'VAMPIRIC_HEAL' | 'NOVA_SHIELD' | 'FLICKER_STEP';
  // กรณีหลอมรวมการ์ด 2 ใบใน Munitorum Forge
  fusedSecondaryEffectId?: string;
}

// 4. โครงสร้างการ์ดยูนิตในคลังของผู้เล่น (แต่ละใบมีเอกลักษณ์และแผลเป็นสงคราม)
export interface RosterUnitCard {
  instanceId: string;
  datasheetId: string;
  unitName: string;
  factionId: string;
  role: UnitCombatRole;
  maxSockets: 1 | 2 | 3;
  socketedRelics: SocketedRelicCard[];
  veterancyTraits: string[]; // สุ่มได้รับเมื่อรบครบทุก 3 ด่าน
  isCorrupted: boolean;
  corruptionModifier?: string;
}

// 5. โครงสร้าง Dynamic Battlefield Event ในแต่ละด่าน
export interface BattlefieldAnomaly {
  id: string;
  type: 'WARP_BREACH' | 'ARCHEOTECH_SHRINE' | 'ELDRITCH_ALTAR' | 'PROMETHIUM_HAZARD';
  position: { x: number; y: number };
  radiusInches: number;
  isActive: boolean;
  turnsRemaining: number;
  altarChoices?: {
    optionA: { downsideDesc: string; rewardDesc: string; modifierId: string };
    optionB: { downsideDesc: string; rewardDesc: string; modifierId: string };
  };
}
```

---

## 10. แผนการนำไปพัฒนาในโค้ด (Roadmap Phasing)

1. **เฟสที่ 1: ระบบแยกชั้นข้อมูลและ Combat Tokens & Ailments**
   - อัปเดต State ของยูนิตในสนามรบให้รองรับ `UnitCombatState` (3 Tokens: Auspex, Fervour, Bastion และ 4 Ailments: Soulfire, Bleeding, Corroded, Pinned)
   - กำหนด `UnitCombatRole` (VANGUARD, BREACHER, SKIRMISHER, GUNSHIP, BEHEMOTH, CONDUIT) ให้ยูนิตทุกตัวตามประเภทยูนิต และเพิ่มปุ่ม/ลอจิก Intrinsic Mechanic ของแต่ละ Role
2. **เฟสที่ 2: ยกเครื่องระบบ Relic Sockets & Procs (ลบความซ้ำซ้อน)**
   - นำ Weapon Keywords ทั้งหมดออกจากโหนดใน Skill Tree
   - เปลี่ยนระบบการ์ด Relic ให้เป็นการสวมใส่ลงใน Socket ของการ์ดยูนิตแต่ละใบ (1-3 Sockets) พร้อมเขียนฟังก์ชันตรวจจับ Trigger Events (`ON_CRIT_HIT`, `ON_MODEL_KILL`, `ON_CHARGE_COMPLETE`)
3. **เฟสที่ 3: อัปเดต Skill Tree & Transformative Keystones**
   - ปรับปรุงโหนดใน Skill Tree ทั้ง 7 กิ่งให้เน้นการเพิ่มเพดาน Token, การกระจายสถานะ Ailments, และใส่ 12 Transformative Keystones
4. **เฟสที่ 4: เพิ่ม Faction Ascendancy UI & Battlefield Anomalies**
   - สร้าง UI Widget เฉพาะเผ่าบนหน้าจอการรบ (Thousand Sons Cabal Matrix, Orks Waaagh! Meter, Necrons Reanimation Grid, World Eaters Blood Tithe)
   - สุ่มวาง Battlefield Anomalies (Warp Breach, Archeotech Shrine, และ Eldritch War-Altar ในรอบที่ 2 และ 4)
