import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { accountStatus, applySave, CLIENT_ID, cloudLoad, cloudSave, loadGis, makeSave, onAccountChange, parseSave, signIn, signOut, withStatus, type SaveFile } from '../services/account';
import { KEYS } from '../services/storage';
import { Icon } from './Icon';

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Home: sign in with Google so armies and the campaign follow you, or move them by file. */
export function AccountPanel() {
  const st = useSyncExternalStore(onAccountChange, accountStatus);
  const [offer, setOffer] = useState<SaveFile | null>(null); // a backup found in Google Drive, waiting for a yes
  const [armed, setArmed] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (CLIENT_ID) loadGis().catch(() => { /* shown when the player taps */ }); }, []);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(null), 3000); return () => window.clearTimeout(t); }, [armed]);

  // a whole save replaces this device's: everything on screen comes from it, so the page starts over
  const restore = (f: SaveFile) => { applySave(f); window.location.reload(); };
  const twice = (id: string, act: () => void) => { if (armed !== id) { setArmed(id); return; } setArmed(null); act(); };

  const doSignIn = () => withStatus(async () => {
    const cloud = await signIn();
    if (!cloud) return;
    const local = makeSave();
    if (!local.data[KEYS.armies] || local.data[KEYS.armies] === '[]') restore(cloud); // a new device: take it
    else setOffer(cloud);
  });

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
    if (!save) { setNote('That file is not a Warhammer Warband save.'); return; }
    setOffer(save);
  };

  return (
    <section className="group account" aria-label="Account and saves">
      <div className="group-head"><h3>Account and saves</h3></div>
      {CLIENT_ID && (st.profile ? (
        <div className="account-who">
          {st.profile.picture ? <img className="account-pic" src={st.profile.picture} alt="" referrerPolicy="no-referrer" /> : <Icon name="cloud" size={22} />}
          <span className="account-text">
            <b>{st.profile.name}</b>
            <small>{st.lastBackup ? `Backed up to Google Drive ${when(st.lastBackup)}` : 'Tap Back up now to save to Google Drive'}</small>
          </span>
        </div>
      ) : (
        <p className="small muted">Sign in with Google to keep your armies, campaign and battle on every device. They are stored in a private folder of your own Google Drive.</p>
      ))}
      <div className="account-acts">
        {CLIENT_ID && !st.profile && <button className="btn primary" disabled={st.busy} onClick={doSignIn}><Icon name="cloud" size={18} />Sign in with Google</button>}
        {CLIENT_ID && st.profile && <>
          <button className="btn" disabled={st.busy} onClick={() => withStatus(cloudSave)}><Icon name="upload" size={18} />Back up now</button>
          <button className="btn" disabled={st.busy} onClick={() => withStatus(async () => { const c = await cloudLoad(); if (c) setOffer(c); else setNote('There is no Google backup yet.'); })}><Icon name="download" size={18} />Restore</button>
          <button className="btn ghost" disabled={st.busy} onClick={signOut}>Sign out</button>
        </>}
        <button className="btn ghost" onClick={exportFile}><Icon name="download" size={18} />Export file</button>
        <button className="btn ghost" onClick={() => file.current?.click()}><Icon name="upload" size={18} />Import file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {offer && (
        <div className="account-offer">
          <span className="small">Saves from {offer.savedAt ? when(offer.savedAt) : 'a file'}: they replace the armies, campaign and battle on this device.</span>
          <button className={`btn ${armed === 'offer' ? 'danger' : 'primary'}`} onClick={() => twice('offer', () => restore(offer))}>{armed === 'offer' ? 'Tap again to replace' : 'Use these saves'}</button>
          <button className="btn ghost" onClick={() => setOffer(null)}>Keep this device's</button>
        </div>
      )}
      {(st.error || note) && <p className="small account-error" role="alert">{st.error ?? note}</p>}
      {st.originHint && (
        <p className="tiny muted">
          If Google said <b>origin_mismatch</b> or <b>redirect_uri_mismatch</b>, the owner of this site must add <code>{window.location.origin}</code> to
          the Authorized JavaScript origins of its Google OAuth client (Google Cloud Console, APIs and Services, Credentials).
        </p>
      )}
    </section>
  );
}
