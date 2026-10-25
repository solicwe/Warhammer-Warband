import { useEffect, useRef, useState } from 'react';
import { applySave, makeSave, parseSave, type SaveFile } from '../services/saves';
import { Icon } from './Icon';

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Home: move armies, the campaign and the battle in progress to another device with one file. */
export function SavesPanel() {
  const [offer, setOffer] = useState<SaveFile | null>(null); // a file read, waiting for a yes
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(false), 3000); return () => window.clearTimeout(t); }, [armed]);

  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(makeSave())], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `warhammer-warband-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    const save = parseSave(await f.text());
    setNote(save ? null : 'That file is not a Warhammer Warband save.');
    setOffer(save);
  };

  return (
    <section className="group saves" aria-label="Saves">
      <div className="group-head"><h3>Saves</h3></div>
      <p className="small muted">Your armies, campaign and battle are kept on this device. Export a file to keep a copy or move them to another device.</p>
      <div className="saves-acts">
        <button className="btn ghost" onClick={exportFile}><Icon name="download" size={18} />Export file</button>
        <button className="btn ghost" onClick={() => file.current?.click()}><Icon name="upload" size={18} />Import file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {offer && (
        <div className="saves-offer">
          <span className="small">Saves from {offer.savedAt ? when(offer.savedAt) : 'a file'}: they replace the armies, campaign and battle on this device.</span>
          {/* everything on screen comes from the saves, so the page starts over with them */}
          <button className={`btn ${armed ? 'danger' : 'primary'}`} onClick={() => { if (!armed) { setArmed(true); return; } applySave(offer); window.location.reload(); }}>{armed ? 'Tap again to replace' : 'Use these saves'}</button>
          <button className="btn ghost" onClick={() => setOffer(null)}>Keep this device's</button>
        </div>
      )}
      {note && <p className="small saves-error" role="alert">{note}</p>}
    </section>
  );
}
