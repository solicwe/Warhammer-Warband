# รูปหน่วย (unit images)

โฟลเดอร์นี้เก็บรูปของแต่ละ datasheet ที่จะขึ้นเซิร์ฟเวอร์ไปพร้อมกับเกม

```
public/images/
  manifest.json          ← สร้างอัตโนมัติด้วย `npm run images` (อย่าแก้มือ)
  units/
    SM/
      intercessor-squad.webp
      captain.jpg
    ORK/
      boyz.webp
      warboss.png
```

## ใส่รูป
1. ตั้งชื่อไฟล์ตามชื่อ datasheet แบบตัวเล็ก ใช้ `-` แทนช่องว่าง/สัญลักษณ์: `Intercessor Squad` → `intercessor-squad.webp`
   (`npm run images -- --missing` แสดงชื่อไฟล์ที่ยังขาดของ SM / ORK ทั้งหมด)
2. ใส่ใน `units/<FACTION>/` (SM, ORK, …) — ใส่ผิดโฟลเดอร์ก็ยังหาเจอ แต่จะเป็นระเบียบกว่า
3. รัน `npm run images` เพื่ออัปเดต `manifest.json` (ไฟล์ที่ชื่อไม่ตรง datasheet ไหนจะถูกแจ้ง)
4. `npm run build` / `npm run artifact` จะเอาโฟลเดอร์นี้ไปด้วย

รูปควรเป็นสี่เหลี่ยมจัตุรัส ราว 256–512 px, WebP หรือ JPG (เกมจะครอปเป็นวงกลมเอง) — ไฟล์ใหญ่ทำให้โหลดช้าบนมือถือ

## รูปที่ผู้เล่นใส่เองในแอป
รูปที่ใส่ในหน้า Army Builder เก็บในเบราว์เซอร์เครื่องนั้นเท่านั้น และจะ **ทับ** รูปเซิร์ฟเวอร์
- **ส่งออก (.zip สำหรับเซิร์ฟเวอร์)** ได้ไฟล์ zip ที่จัดโฟลเดอร์แบบเดียวกับข้างบน — แตกลงใน `public/images/` แล้วรัน `npm run images`
- **สำรอง / กู้คืน (.json)** ย้ายรูปไปอีกเครื่อง/เบราว์เซอร์

## เก็บรูปไว้ที่อื่น (CDN, S3, …)
อัปโฟลเดอร์ `images/` ทั้งก้อน (รวม `manifest.json`) ขึ้นที่ไหนก็ได้ แล้ว build ด้วย
`VITE_IMAGE_BASE=https://cdn.example.com/w40k/images/ npm run build`
ค่าใน `manifest.json` จะเป็น path ต่อจาก base นี้ (หรือใส่ URL เต็ม `https://…` รายไฟล์ก็ได้)
