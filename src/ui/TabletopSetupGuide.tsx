// Tournament Tabletop Physical Setup Reference (Official WTC/GW Standard)
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

  const getDeploymentDetails = () => {
    switch (dep) {
      case 'hammer-and-anvil':
        return {
          title: 'Hammer and Anvil',
          table: '44" x 60"',
          attacker: 'Short edge (Top) - 18" deep (Y: 0" to 18")',
          defender: 'Short edge (Bottom) - 18" deep (Y: 42" to 60")',
          noMansLand: '24" wide central band (Y: 18" to 42")',
          centerLine: 'Horizontal center line at 30"',
        };
      case 'dawn-of-war':
        return {
          title: 'Dawn of War',
          table: '44" x 60"',
          attacker: 'Long edge (Left) - 12" deep (X: 0" to 12")',
          defender: 'Long edge (Right) - 12" deep (X: 32" to 44")',
          noMansLand: '20" wide central band (X: 12" to 32")',
          centerLine: 'Vertical center line at 22"',
        };
      case 'search-and-destroy':
        return {
          title: 'Search and Destroy',
          table: '44" x 60"',
          attacker: 'Top-left quadrant (0"-22", 0"-30") outside 9" center circle',
          defender: 'Bottom-right quadrant (22"-44", 30"-60") outside 9" center circle',
          noMansLand: 'Top-right, bottom-left quadrants, and 9" center exclusion bubble',
          centerLine: 'Table split into 4 equal quadrants (X=22", Y=30")',
        };
      case 'sweeping-engagement':
        return {
          title: 'Sweeping Engagement',
          table: '44" x 60"',
          attacker: 'Stepped edge: top half (0"-30") 14" deep, bottom half (30"-60") 8" deep',
          defender: 'Stepped edge: top half (0"-30") 8" deep, bottom half (30"-60") 14" deep',
          noMansLand: 'Central stepped diagonal corridor',
          centerLine: 'Transverse center divider at 30"',
        };
      case 'crucible-of-battle':
        return {
          title: 'Crucible of Battle',
          table: '44" x 60"',
          attacker: 'Top-right triangle from (44", 0") to (0", 30")',
          defender: 'Bottom-left triangle from (0", 60") to (44", 30")',
          noMansLand: 'Broad diagonal center corridor',
          centerLine: 'Center intersection at (22", 30")',
        };
      case 'tipping-point':
        return {
          title: 'Tipping Point',
          table: '44" x 60"',
          attacker: 'Stepped edge: left half (0"-22") 20" deep, right half (22"-44") 12" deep',
          defender: 'Stepped edge: left half (0"-22") 12" deep, right half (22"-44") 20" deep',
          noMansLand: 'Central stepped corridor',
          centerLine: 'Vertical divider at 22"',
        };
      default:
        return {
          title: layout.deployment,
          table: '44" x 60"',
          attacker: 'Attacker Deployment Zone',
          defender: 'Defender Deployment Zone',
          noMansLand: 'No Man\'s Land',
          centerLine: 'Center Point (22", 30")',
        };
    }
  };

  const info = getDeploymentDetails();

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
          <b style={{ fontSize: 13, color: 'var(--text)' }}>
            1. Deployment Zones & Table Setup
          </b>
          <span className="tiny badge" style={{ background: 'var(--accent)', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
            44" x 60"
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: 12 }}>
          <div style={{ padding: '8px 10px', background: 'rgba(178, 34, 34, 0.12)', borderLeft: '3px solid #b22222', borderRadius: 4 }}>
            <span style={{ fontWeight: 800, color: '#e53e3e', display: 'block' }}>Attacker ({layout.attackerEdge} edge):</span>
            <span style={{ color: 'var(--text-2)' }}>{info.attacker}</span>
          </div>
          <div style={{ padding: '8px 10px', background: 'rgba(14, 111, 164, 0.12)', borderLeft: '3px solid #0e6fa4', borderRadius: 4 }}>
            <span style={{ fontWeight: 800, color: '#3182ce', display: 'block' }}>Defender ({layout.defenderEdge} edge):</span>
            <span style={{ color: 'var(--text-2)' }}>{info.defender}</span>
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div><b>No Man's Land:</b> {info.noMansLand}</div>
          <div><b>Center Reference:</b> {info.centerLine}</div>
        </div>
      </div>

      {/* 2. OBJECTIVES EXACT MEASUREMENTS TABLE */}
      <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line-2)' }}>
        <b style={{ fontSize: 13, display: 'block', marginBottom: 4, color: 'var(--text)' }}>
          2. Objective Marker Placement (40mm Bases)
        </b>
        <div className="tiny muted" style={{ marginBottom: 8 }}>
          Standard tape measurements from table edges to center of 40mm marker
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line-2)', color: 'var(--text-3)' }}>
                <th style={{ padding: '4px 6px' }}>#</th>
                <th style={{ padding: '4px 6px' }}>Role</th>
                <th style={{ padding: '4px 6px' }}>Coordinates (X", Y")</th>
                <th style={{ padding: '4px 6px' }}>Edge Offsets</th>
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
                      Left: <b>{distLeft}"</b> (Right: {distRight}"), Top: <b>{distTop}"</b> (Bottom: {distBottom}")
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
        <b style={{ fontSize: 13, display: 'block', marginBottom: 4, color: 'var(--text)' }}>
          3. Terrain Footprints & Ruin Checklist
        </b>
        <div className="tiny muted" style={{ marginBottom: 8 }}>
          Footprint dimensions in inches (width x height)
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
                  {t.w}" x {t.h}"
                </span>
              </div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                Center: ({t.cx}", {t.cy}")
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
