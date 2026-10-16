import { useEffect, useRef, useState } from 'react';
import { RULES } from '../engine/config';
import { listPoints } from '../engine/army';
import { loadRun } from '../engine/campaign';
import { lastRound } from '../engine/state';
import type { GameState } from '../engine/types';
import { Emblem, titleCase } from './ArmyBuilder';
import { useFactions, type FactionIndex } from './data';
import { Icon, Logo } from './Icon';
import { armyColor } from './Sheet';
import { exportArmiesJson, importArmiesJson, type Army } from './library';
import { clearAllLocalPortraits, download, exportPortraitsJson, exportPortraitsZip, importPortraitsJson, ownPortraitCount, usePortraitsVersion } from './portraits';

interface Props {
  armies: Army[];
  index: FactionIndex | null;
  saved: GameState | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onImportArmies?: (armies: Army[]) => void;
  onBattle: () => void;
  onCampaign: () => void;
  onTutorial: () => void;
  onContinue: () => void;
  onAbandon: () => void;
}

export function Home({ armies, index, saved, onOpen, onNew, onDuplicate, onDelete, onImportArmies, onBattle, onCampaign, onTutorial, onContinue, onAbandon }: Props) {
  const run = loadRun();
  const runLayer = run ? Math.max(0, ...run.path.map((id) => (run.map.find((n) => n.id === id)?.layer ?? -1) + 1)) : 0;
  const runLayers = run ? Math.max(...run.map.map((n) => n.layer)) + 1 : 0;
  const [pop, setPop] = useState<{ id: string; x: number; y: number } | null>(null);
  const facs = useFactions(armies.map((a) => a.factionId)); // points with the duplicate tax, as in the army builder
  const [armed, setArmed] = useState<string | null>(null); // a delete that needs a second tap (dialogs are blocked here)
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(null), 3000); return () => window.clearTimeout(t); }, [armed]);
  const factionName = (id: string) => index?.factions.find((f) => f.id === id)?.name ?? id;
  const live = saved && saved.phase !== 'gameover' ? saved : null;
  const score = (g: GameState, p: 0 | 1) => g.players[p].vp + g.players[p].secVp;

  usePortraitsVersion();
  const [showSync, setShowSync] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const portraitFileRef = useRef<HTMLInputElement>(null);
  const armiesFileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="app home">
      <header className="appbar">
        <span className="brand"><Logo size={30} />Pocket Warband</span>
        <span className="appbar-note">11th edition</span>
        <button
          className="btn ghost small"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          onClick={() => { setShowSync(true); setSyncStatus(null); setClearArmed(false); }}
          title="Backup & Sync (รูปภาพ & กองทัพ)"
        >
          <Icon name="cloud" size={17} />
          <span>Sync & Backup</span>
        </button>
      </header>
      <main className="screen">
        {live && (
          <section className="resume slate" aria-label="Battle in progress">
           <div className="slate-in">
            <div className="resume-head">
              <span className="label">{live.campaign ? 'Campaign battle' : 'Battle in progress'}</span>
              <span className="resume-round">{live.phase === 'deploy' || live.phase === 'scouts' ? 'Deployment' : `Round ${live.round} of ${lastRound(live)}`}</span>
            </div>
            <div className="resume-score">
              <span className="p0">{live.players[0].name}</span>
              <b className="num">{score(live, 0)}<i>:</i>{score(live, 1)}</b>
              <span className="p1">{live.players[1].name}</span>
            </div>
            <div className="resume-acts">
              <button className="btn primary grow" onClick={onContinue}>Continue</button>
              <button className={`btn ${armed === 'game' ? 'danger on-armed' : 'ghost'}`} onClick={() => (armed === 'game' ? (setArmed(null), onAbandon()) : setArmed('game'))}>
                {armed === 'game' ? 'Tap again to abandon' : 'Abandon'}
              </button>
            </div>
           </div>
          </section>
        )}

        <nav className="modes" aria-label="Play">
          <button className="mode slate main" onClick={onBattle}>
            <span className="slate-in">
              <span className="mode-icon"><Icon name="fight" size={26} /></span>
              <span className="mode-text"><b>New battle</b><small>Against the bot, two players on one device, or bot against bot</small></span>
              <Icon name="next" size={20} className="mode-go" />
            </span>
          </button>
          <button className="mode slate" onClick={onCampaign}>
            <span className="slate-in">
              <span className="mode-icon"><Icon name="trophy" size={22} /></span>
              <span className="mode-text"><b>Campaign (Roguelike)</b><small>{run && !run.over ? `Stage ${Math.min(runLayer + 1, runLayers)} of ${runLayers} · ${run.fate} Fate · ${run.scrap ?? 0} Scrap` : 'Branching battles, armory, battle honors, and Warlord'}</small></span>
            </span>
          </button>
          <button className="mode slate" onClick={onTutorial}>
            <span className="slate-in">
              <span className="mode-icon"><Icon name="hint" size={22} /></span>
              <span className="mode-text"><b>How to play</b><small>A first battle with tips at every step</small></span>
            </span>
          </button>
        </nav>

        <section className="group" aria-label="Your armies">
          <div className="group-head">
            <h3>Armies</h3>
            <span className="group-count num">{armies.length}</span>
            <button
              className="btn ghost small"
              onClick={() => { setShowSync(true); setSyncStatus(null); setClearArmed(false); }}
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              title="Sync & Backup Portraits / Armies"
            >
              <Icon name="cloud" size={16} />
              <span>Sync & Backup</span>
            </button>
          </div>
          <button className="list-new" onClick={onNew}><Icon name="plus" size={20} />New army</button>
          {armies.map((a) => {
            const size = RULES.battleSizes.find((b) => b.id === a.battleSize) ?? RULES.battleSizes[0];
            const pts = listPoints(a, facs[a.factionId]);
            const over = pts > size.points;
            return (
              <div key={a.id} className="army" style={{ ['--accent' as string]: armyColor(a.factionId, a.subfaction), ['--accent-2' as string]: armyColor(a.factionId, a.subfaction) }}>
                <button className="army-main" onClick={() => onOpen(a.id)}>
                  <Emblem factionId={a.factionId} sub={a.subfaction} />
                  <span className="army-text">
                    <span className="army-title">{a.name || 'Untitled army'}</span>
                    <span className="army-meta">{factionName(a.factionId)}{a.subfaction ? ` · ${titleCase(a.subfaction)}` : ''}</span>
                    <span className="army-meta">{a.detachments.join(' + ') || 'No Detachment yet'}</span>
                    <span className={`army-foot ${over ? 'over' : ''}`}>
                      <span className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, (pts / size.points) * 100)}%` }} /></span>
                      <span className="army-pts-val"><b className="num">{pts}</b><span className="num">/{size.points} pts</span></span>
                      <span className="army-units">{a.units.length} {a.units.length === 1 ? 'unit' : 'units'}</span>
                    </span>
                  </span>
                </button>
                <button
                  className="army-more"
                  aria-label={`More for ${a.name || 'this army'}`}
                  aria-expanded={pop?.id === a.id}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPop(pop?.id === a.id ? null : { id: a.id, x: r.right, y: r.bottom });
                    setArmed(null);
                  }}
                >
                  <Icon name="more" size={20} />
                </button>
              </div>
            );
          })}
          {!armies.length && <div className="empty">No armies yet. Tap “New army” to build one.</div>}
        </section>

        {pop && (() => {
          const a = armies.find((x) => x.id === pop.id);
          if (!a) return null;
          const w = 240;
          const pad = 8;
          const left = Math.max(pad, Math.min(window.innerWidth - w - pad, pop.x - w));
          const top = Math.min(window.innerHeight - 130, Math.max(pad, pop.y + 4));
          return (
            <div className="ab-pop-backdrop" onClick={() => { setPop(null); setArmed(null); }}>
              <div className="ab-pop" style={{ left, top, width: w }} onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => { setPop(null); onDuplicate(a.id); }}>
                  <Icon name="duplicate" size={22} />
                  <span>Duplicate</span>
                </button>
                <button type="button" className={armed === a.id ? 'danger' : ''} onClick={() => {
                  if (armed !== a.id) { setArmed(a.id); return; }
                  setArmed(null); setPop(null); onDelete(a.id);
                }}>
                  <Icon name="delete" size={22} />
                  <span>{armed === a.id ? 'Tap again to delete' : 'Delete'}</span>
                </button>
              </div>
            </div>
          );
        })()}

        <footer className="foot">Datasheets: Wahapedia 11th edition export{index ? ` · updated ${index.lastUpdate.slice(0, 10)}` : ''} · Core Rules June 2026 · Warhammer 40,000 is a trademark of Games Workshop</footer>
      </main>

      {showSync && (
        <div className="cmp-modal-backdrop" onClick={() => setShowSync(false)}>
          <div className="cmp-armory-modal" style={{ width: 'min(100%, 580px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="cmp-armory-header">
              <div>
                <div className="cmp-armory-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icon name="cloud" size={20} />
                  <span>Sync & Backup (รูปภาพและกองทัพ)</span>
                </div>
                <div className="cmp-armory-sub">ย้ายรูปตัวละครและกองทัพข้ามเครื่อง หรือเตรียมไฟล์ขึ้น Cloudflare</div>
              </div>
              <button className="btn ghost small" onClick={() => setShowSync(false)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="cmp-armory-body" style={{ gap: '16px' }}>
              {syncStatus && (
                <div style={{ padding: '8px 12px', background: 'rgba(211, 160, 74, 0.15)', border: '1px solid rgba(211, 160, 74, 0.4)', borderRadius: '6px', color: '#fef08a', fontSize: '13px' }}>
                  {syncStatus}
                </div>
              )}

              {/* Section 1: Portraits */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: '15px', color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Icon name="camera" size={18} />
                    <span>Unit Portraits (รูปตัวละคร)</span>
                  </div>
                  <span style={{ fontSize: '13px', color: '#94a3b8' }}>{ownPortraitCount()} รูปในเบราว์เซอร์นี้</span>
                </div>
                <div style={{ fontSize: '12.5px', color: '#94a3b8', lineHeight: 1.4 }}>
                  รูปที่อัปโหลดจะถูกบันทึกไว้ในเบราว์เซอร์เครื่องนี้ หากต้องการย้ายไปเครื่องอื่นหรือมือถือ ให้ Export ไฟล์แล้วนำไป Import ในเครื่องปลายทาง
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <button
                    className="btn small"
                    onClick={async () => {
                      const json = exportPortraitsJson();
                      await download('pocketwarband-portraits.json', json, 'application/json');
                      setSyncStatus('ส่งออกไฟล์ pocketwarband-portraits.json เรียบร้อย');
                    }}
                  >
                    <Icon name="download" size={16} />
                    <span>Export Portraits (.json)</span>
                  </button>

                  <button
                    className="btn small"
                    onClick={() => portraitFileRef.current?.click()}
                  >
                    <Icon name="upload" size={16} />
                    <span>Import Portraits (.json)</span>
                  </button>
                  <input
                    ref={portraitFileRef}
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        try {
                          const n = importPortraitsJson(String(ev.target?.result ?? ''));
                          setSyncStatus(`นำเข้ารูปตัวละครสำเร็จ ${n} รูป!`);
                        } catch {
                          setSyncStatus('ไม่สามารถอ่านไฟล์ JSON ได้');
                        }
                      };
                      reader.readAsText(f);
                      e.target.value = '';
                    }}
                  />

                  <button
                    className="btn small"
                    onClick={async () => {
                      setSyncStatus('กำลังสร้างไฟล์ zip...');
                      try {
                        const bytes = await exportPortraitsZip((name) => {
                          for (const a of armies) {
                            if (a.units.some((u) => u.datasheet === name || name.startsWith(u.datasheet))) return a.factionId;
                          }
                          return 'other';
                        });
                        await download('pocketwarband-images.zip', bytes, 'application/zip');
                        setSyncStatus('ดาวน์โหลด pocketwarband-images.zip เรียบร้อย');
                      } catch {
                        setSyncStatus('สร้างไฟล์ zip ไม่สำเร็จ');
                      }
                    }}
                  >
                    <Icon name="download" size={16} />
                    <span>Export Server Zip (.zip)</span>
                  </button>

                  {ownPortraitCount() > 0 && (
                    <button
                      className={`btn small ${clearArmed ? 'danger armed' : 'ghost'}`}
                      style={{ marginLeft: 'auto' }}
                      onClick={() => {
                        if (!clearArmed) { setClearArmed(true); return; }
                        clearAllLocalPortraits();
                        setClearArmed(false);
                        setSyncStatus('ล้างรูปในเครื่องนี้แล้ว');
                      }}
                    >
                      <Icon name="delete" size={16} />
                      <span>{clearArmed ? 'กดอีกครั้งเพื่อล้างรูป' : 'ล้างรูปในเครื่อง'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Section 2: Armies */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: '15px', color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Icon name="wargear" size={18} />
                    <span>Saved Armies (กองทัพที่บันทึกไว้)</span>
                  </div>
                  <span style={{ fontSize: '13px', color: '#94a3b8' }}>{armies.length} กองทัพ</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <button
                    className="btn small"
                    onClick={async () => {
                      const json = exportArmiesJson(armies);
                      await download('pocketwarband-armies.json', json, 'application/json');
                      setSyncStatus('ส่งออกไฟล์ pocketwarband-armies.json เรียบร้อย');
                    }}
                  >
                    <Icon name="download" size={16} />
                    <span>Export Armies (.json)</span>
                  </button>

                  <button
                    className="btn small"
                    onClick={() => armiesFileRef.current?.click()}
                  >
                    <Icon name="upload" size={16} />
                    <span>Import Armies (.json)</span>
                  </button>
                  <input
                    ref={armiesFileRef}
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        try {
                          const list = importArmiesJson(String(ev.target?.result ?? ''));
                          if (list && list.length && onImportArmies) {
                            onImportArmies(list);
                            setSyncStatus(`นำเข้ากองทัพสำเร็จ ${list.length} กองทัพ!`);
                          } else {
                            setSyncStatus('ไม่พบข้อมูลกองทัพที่ถูกต้องในไฟล์');
                          }
                        } catch {
                          setSyncStatus('ไม่สามารถอ่านไฟล์ JSON ได้');
                        }
                      };
                      reader.readAsText(f);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              {/* Section 3: Cloudflare deploy note */}
              <div style={{ background: 'rgba(211, 160, 74, 0.08)', border: '1px solid rgba(211, 160, 74, 0.25)', borderRadius: '8px', padding: '12px 14px', fontSize: '12.5px', color: '#cbd5e1', lineHeight: 1.5 }}>
                <b style={{ color: '#fef08a' }}>วิธีนำรูปขึ้นเซิร์ฟเวอร์ Cloudflare ถาวร:</b>
                <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                  <li>กด <b>Export Server Zip</b> ด้านบน แล้วแตกไฟล์ลงในโฟลเดอร์ <code style={{ color: '#93c5fd' }}>public/images/</code> ของโปรเจกต์</li>
                  <li>เปิด PowerShell ในโฟลเดอร์โปรเจกต์ รันคำสั่ง:
                    <div style={{ margin: '4px 0', padding: '4px 8px', background: 'rgba(0,0,0,0.4)', borderRadius: '4px', fontFamily: 'monospace', color: '#86efac' }}>
                      npm run images<br />
                      npm run build<br />
                      npx wrangler deploy
                    </div>
                  </li>
                  <li>รูปจะถูกขึ้นระบบบน Cloudflare ทันที ทุกเครื่องที่เข้าเว็บจะมองเห็นรูปตรงกัน</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

