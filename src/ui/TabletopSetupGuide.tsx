// Physical Tabletop Setup Guide (คู่มือวัดระยะจัดโต๊ะจริงสำหรับแข่งทัวร์นาเมนต์ Warhammer 40k)
import type { LayoutDef } from '../engine/config';

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

function getBoundingBox(poly: number[][]): BoundingBox {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

export function TabletopSetupGuide({ layout }: { layout: LayoutDef }) {
  const dep = layout.deployment;

  // Deployment-specific physical setup steps
  const getDeploymentDetails = () => {
    switch (dep) {
      case 'hammer-and-anvil':
        return {
          title: 'Hammer and Anvil',
          table: '44" × 60" (กว้าง 44" × ยาว 60")',
          attacker: 'ขอบบน (Short Edge) — วัดลึกเข้ามา 18" (Y: 0" ถึง 18")',
          defender: 'ขอบล่าง (Short Edge) — วัดลึกเข้ามา 18" (Y: 42" ถึง 60")',
          noMansLand: 'กว้าง 24" ตลอดแนวกึ่งกลาง (Y: 18" ถึง 42")',
          centerLine: 'เส้นแบ่งครึ่งแนวนอนที่ระยะ 30" จากขอบบนและขอบล่าง',
        };
      case 'dawn-of-war':
        return {
          title: 'Dawn of War',
          table: '44" × 60" (กว้าง 44" × ยาว 60")',
          attacker: 'ขอบซ้าย (Long Edge) — วัดลึกเข้ามา 12" (X: 0" ถึง 12")',
          defender: 'ขอบขวา (Long Edge) — วัดลึกเข้ามา 12" (X: 32" ถึง 44")',
          noMansLand: 'กว้าง 20" ตลอดแนวกึ่งกลาง (X: 12" ถึง 32")',
          centerLine: 'เส้นแบ่งครึ่งแนวตั้งที่ระยะ 22" จากขอบซ้ายและขอบขวา',
        };
      case 'search-and-destroy':
        return {
          title: 'Search and Destroy',
          table: '44" × 60" (กว้าง 44" × ยาว 60")',
          attacker: 'ช่องสี่เหลี่ยมมุมบนซ้าย (0"-22", 0"-30") อยู่นอกวง 9" ตรงกลาง',
          defender: 'ช่องสี่เหลี่ยมมุมล่างขวา (22"-44", 30"-60") อยู่นอกวง 9" ตรงกลาง',
          noMansLand: 'ช่องมุมบนขวา, มุมล่างซ้าย และวงกลมรัศมี 9" ตรงกลาง',
          centerLine: 'แบ่ง 4 ช่องเท่ากัน (แกน X ที่ 22", แกน Y ที่ 30") + วงรัศมี 9" จากจุดศูนย์กลาง',
        };
      case 'sweeping-engagement':
        return {
          title: 'Sweeping Engagement',
          table: '44" × 60" (กว้าง 44" × ยาว 60")',
          attacker: 'ขอบซ้ายแบบขั้นบันได: ครึ่งบน (0"-30") ลึก 14", ครึ่งล่าง (30"-60") ลึก 8"',
          defender: 'ขอบขวาแบบขั้นบันได: ครึ่งบน (0"-30") ลึก 8", ครึ่งล่าง (30"-60") ลึก 14"',
          noMansLand: 'พื้นที่ตรงกลางระหว่างขั้นบันไดทั้งสองฝั่ง',
          centerLine: 'เส้นแบ่งแนวขวางที่ความยาว 30"',
        };
      case 'crucible-of-battle':
        return {
          title: 'Crucible of Battle',
          table: '44" × 60" (กว้าง 44" × ยาว 60")',
          attacker: 'สามเหลี่ยมมุมบนขวา: ลากเส้นทแยงจาก (44", 0") ถึงกึ่งกลางขอบซ้าย (0", 30")',
          defender: 'สามเหลี่ยมมุมล่างซ้าย: ลากเส้นทแยงจาก (0", 60") ถึงกึ่งกลางขอบขวา (44", 30")',
          noMansLand: 'แถบเฉียงตรงกลางกว้างขวาง',
          centerLine: 'จุดตัดกึ่งกลางโต๊ะ (22", 30")',
        };
      case 'tipping-point':
        return {
          title: 'Tipping Point',
          table: '44" × 60" (กว้าง 44" × ยาว 60")',
          attacker: 'ขอบบนแบบขั้นบันได: ซีกซ้าย (0"-22") ลึก 20", ซีกขวา (22"-44") ลึก 12"',
          defender: 'ขอบล่างแบบขั้นบันได: ซีกซ้าย (0"-22") ลึก 12", ซีกขวา (22"-44") ลึก 20"',
          noMansLand: 'พื้นที่ตรงกลางระหว่างขั้นบันได',
          centerLine: 'เส้นแบ่งกึ่งกลางแนวตั้งที่ 22"',
        };
      default:
        return {
          title: layout.deployment,
          table: '44" × 60"',
          attacker: 'Attacker Deployment Zone',
          defender: 'Defender Deployment Zone',
          noMansLand: 'No Man\'s Land',
          centerLine: 'Center Point (22", 30")',
        };
    }
  };

  const info = getDeploymentDetails();

  // Terrain pieces grouped by category
  const terrainItems = layout.terrain.map((t, idx) => {
    const bb = getBoundingBox(t.poly);
    const w = Math.round(bb.w);
    const h = Math.round(bb.h);
    let category = 'Small Ruin';
    if (w >= 11 || h >= 11) category = 'Large Ruin (L-Shape / 3-Story)';
    else if (w >= 8 || h >= 8) category = 'Medium Ruin (2-Story)';
    else if (w <= 4 && h <= 3) category = 'Barricade / Pipe / Vent';

    return {
      index: idx + 1,
      w,
      h,
      cx: bb.cx.toFixed(1),
      cy: bb.cy.toFixed(1),
      category,
    };
  });

  return (
    <div className="tabletop-setup-guide" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. TABLE & DEPLOYMENT MEASUREMENTS */}
      <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <b style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
            📏 1. ขนาดโต๊ะและระยะกางโซนวางทัพ (Deployment Zones)
          </b>
          <span className="tiny badge" style={{ background: 'var(--accent)', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
            44" × 60"
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: 12 }}>
          <div style={{ padding: '8px 10px', background: 'rgba(178, 34, 34, 0.12)', borderLeft: '3px solid #b22222', borderRadius: 4 }}>
            <span style={{ fontWeight: 800, color: '#e53e3e', display: 'block' }}>🔴 ฝ่าย Attacker ({layout.attackerEdge} edge):</span>
            <span style={{ color: 'var(--text-2)' }}>{info.attacker}</span>
          </div>
          <div style={{ padding: '8px 10px', background: 'rgba(14, 111, 164, 0.12)', borderLeft: '3px solid #0e6fa4', borderRadius: 4 }}>
            <span style={{ fontWeight: 800, color: '#3182ce', display: 'block' }}>🔵 ฝ่าย Defender ({layout.defenderEdge} edge):</span>
            <span style={{ color: 'var(--text-2)' }}>{info.defender}</span>
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div>⚪ <b>No Man's Land:</b> {info.noMansLand}</div>
          <div>➖ <b>เส้น Center Line:</b> {info.centerLine} (จุดกึ่งกลางโต๊ะ: X=22", Y=30")</div>
        </div>
      </div>

      {/* 2. OBJECTIVES EXACT MEASUREMENTS TABLE */}
      <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line-2)' }}>
        <b style={{ fontSize: 13, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
          🎯 2. พิกัดวางมาร์กเกอร์ภารกิจ 6 จุด (Objective Measurements)
        </b>
        <div className="tiny muted" style={{ marginBottom: 8 }}>
          ใช้ตลับเมตรวัดจากขอบโต๊ะซ้าย (X) และขอบบน/ล่าง (Y) เพื่อวางมาร์กเกอร์ 40mm ให้ตรงตามมาตรฐาน WTC/GW
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line-2)', color: 'var(--text-3)' }}>
                <th style={{ padding: '4px 6px' }}>#</th>
                <th style={{ padding: '4px 6px' }}>บทบาท</th>
                <th style={{ padding: '4px 6px' }}>พิกัด (X", Y")</th>
                <th style={{ padding: '4px 6px' }}>วัดจากขอบโต๊ะ (Inches)</th>
              </tr>
            </thead>
            <tbody>
              {layout.objectives.map((o, i) => {
                const distLeft = o.x.toFixed(1);
                const distRight = (44 - o.x).toFixed(1);
                const distTop = o.y.toFixed(1);
                const distBottom = (60 - o.y).toFixed(1);
                const isAttacker = o.owner === 'attacker';
                const isDefender = o.owner === 'defender';

                const roleName = isAttacker
                  ? 'Home (Attacker)'
                  : isDefender
                  ? 'Home (Defender)'
                  : o.type === 'central'
                  ? 'Center Objective'
                  : 'No Man\'s Land (Expansion)';

                const badgeBg = isAttacker ? '#b22222' : isDefender ? '#0e6fa4' : '#475569';

                return (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '6px 6px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: badgeBg,
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: 11,
                        }}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td style={{ padding: '6px 6px', fontWeight: 600 }}>{roleName}</td>
                    <td style={{ padding: '6px 6px', fontFamily: 'monospace', fontWeight: 700 }}>
                      ({o.x.toFixed(1)}", {o.y.toFixed(1)}")
                    </td>
                    <td style={{ padding: '6px 6px', color: 'var(--text-2)' }}>
                      ซ้าย <b>{distLeft}"</b> (ขวา {distRight}"), บน <b>{distTop}"</b> (ล่าง {distBottom}")
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. TERRAIN PIECES & RUIN SIZES */}
      <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line-2)' }}>
        <b style={{ fontSize: 13, display: 'block', marginBottom: 8, color: 'var(--text)' }}>
          🏛️ 3. ชิ้นภูมิประเทศและขนาดฐาน (Terrain Ruins Checklist)
        </b>
        <div className="tiny muted" style={{ marginBottom: 8 }}>
          ขนาดพื้นที่ฐาน (Footprint) ในหน่วยนิ้ว — ดูป้ายกำกับขนาดบนตัว Ruin ในแผนที่ด้านบน
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6 }}>
          {terrainItems.slice(0, 8).map((t) => (
            <div
              key={t.index}
              style={{
                padding: '6px 8px',
                borderRadius: 6,
                background: 'var(--surface)',
                border: '1px solid var(--line-2)',
                fontSize: 11.5,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b>Ruin #{t.index}</b>
                <span className="badge" style={{ fontSize: 10, padding: '1px 5px', background: '#334155', color: '#fff' }}>
                  {t.w}" × {t.h}"
                </span>
              </div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                ศูนย์กลาง: ({t.cx}", {t.cy}")
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
