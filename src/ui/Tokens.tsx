// Original token art (simple vector portraits) for models and unit cards.
import { useEffect, useRef, useState } from 'react';
import type { ModelState, UnitState } from '../engine/types';
import { fileToPortrait, getPortrait, hasOwnPortrait, setPortrait, usePortraitsVersion } from './portraits';

export type TokenKind = 'sm' | 'ork' | 'grot' | 'walker' | 'vehicle' | 'monster' | 'generic';

export function tokenKind(keywords: string[], factionKeywords: string[] = keywords): TokenKind {
  const k = (x: string) => keywords.includes(x);
  if (k('WALKER')) return 'walker';
  if (k('VEHICLE')) return 'vehicle';
  if (k('MONSTER')) return 'monster';
  if (k('GROTS')) return 'grot';
  if (factionKeywords.includes('ORKS')) return 'ork';
  if (factionKeywords.includes('ADEPTUS ASTARTES')) return 'sm';
  return 'generic';
}
export const modelToken = (m: ModelState) => tokenKind(m.keywords);
export const unitToken = (u: UnitState) => {
  const lead = u.models.find((m) => m.isCharacter && !m.dead) ?? u.models.find((m) => !m.dead) ?? u.models[0];
  return tokenKind(lead.keywords);
};

/** Hidden sprite sheet; mount once near the root. */
export function TokenSprites() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="g-ceramite" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b8fd6" /><stop offset="1" stopColor="#1f4a8f" />
        </linearGradient>
        <linearGradient id="g-orkskin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fc04a" /><stop offset="1" stopColor="#3f6e1d" />
        </linearGradient>
        <linearGradient id="g-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9ccd2" /><stop offset="1" stopColor="#6b7078" />
        </linearGradient>
        <symbol id="tok-sm" viewBox="0 0 100 100">
          <path d="M18 58 Q16 16 50 12 Q84 16 82 58 L80 72 Q50 94 20 72 Z" fill="url(#g-ceramite)" stroke="#0c1730" strokeWidth="4" />
          <path d="M44 14 L56 14 L55 40 L45 40 Z" fill="#d9b44a" opacity="0.9" />
          <ellipse cx="35" cy="50" rx="10" ry="7" fill="#ff3b30" stroke="#300" strokeWidth="2" />
          <ellipse cx="65" cy="50" rx="10" ry="7" fill="#ff3b30" stroke="#300" strokeWidth="2" />
          <rect x="39" y="62" width="22" height="18" rx="5" fill="#16213a" />
          <path d="M43 66 V77 M50 66 V78 M57 66 V77" stroke="#7a8aa8" strokeWidth="2.5" />
        </symbol>
        <symbol id="tok-ork" viewBox="0 0 100 100">
          <path d="M12 48 Q12 14 50 12 Q88 14 88 48 Q90 74 70 86 L30 86 Q10 74 12 48 Z" fill="url(#g-orkskin)" stroke="#1d3309" strokeWidth="4" />
          <path d="M22 38 Q50 26 78 38 L76 46 Q50 36 24 46 Z" fill="#2c4a10" />
          <circle cx="36" cy="48" r="6" fill="#ff2a1a" stroke="#400" strokeWidth="2" />
          <circle cx="64" cy="48" r="6" fill="#ff2a1a" stroke="#400" strokeWidth="2" />
          <path d="M26 62 Q50 92 74 62 L74 74 Q50 96 26 74 Z" fill="#2f5214" />
          <path d="M32 66 L37 50 L42 67 Z M58 67 L63 50 L68 66 Z" fill="#f2ead2" stroke="#6b5f3a" strokeWidth="1.5" />
        </symbol>
        <symbol id="tok-grot" viewBox="0 0 100 100">
          <path d="M22 52 Q22 26 50 24 Q78 26 78 52 Q78 76 50 82 Q22 76 22 52 Z" fill="#7fb34a" stroke="#22380d" strokeWidth="4" />
          <path d="M22 44 L4 30 L26 38 Z M78 44 L96 30 L74 38 Z" fill="#7fb34a" stroke="#22380d" strokeWidth="3" />
          <circle cx="40" cy="50" r="5" fill="#ffd21a" /><circle cx="60" cy="50" r="5" fill="#ffd21a" />
          <path d="M38 66 Q50 74 62 66" stroke="#22380d" strokeWidth="4" fill="none" />
        </symbol>
        <symbol id="tok-walker" viewBox="0 0 100 100">
          <rect x="28" y="22" width="44" height="52" rx="8" fill="url(#g-metal)" stroke="#23262b" strokeWidth="4" />
          <rect x="6" y="30" width="20" height="34" rx="6" fill="#80858d" stroke="#23262b" strokeWidth="4" />
          <rect x="74" y="30" width="20" height="34" rx="6" fill="#80858d" stroke="#23262b" strokeWidth="4" />
          <rect x="38" y="32" width="24" height="16" rx="3" fill="#2a2f38" />
          <circle cx="50" cy="40" r="4" fill="#ff3b30" />
          <path d="M34 62 H66" stroke="#23262b" strokeWidth="4" />
        </symbol>
        <symbol id="tok-vehicle" viewBox="0 0 100 100">
          <rect x="14" y="20" width="72" height="62" rx="10" fill="url(#g-metal)" stroke="#23262b" strokeWidth="4" />
          <rect x="8" y="22" width="12" height="58" rx="4" fill="#3a3e45" /><rect x="80" y="22" width="12" height="58" rx="4" fill="#3a3e45" />
          <circle cx="50" cy="52" r="17" fill="#8c9199" stroke="#23262b" strokeWidth="4" />
          <rect x="46" y="4" width="8" height="34" rx="2" fill="#2a2f38" />
        </symbol>
        <symbol id="tok-monster" viewBox="0 0 100 100">
          <path d="M14 70 Q10 30 50 16 Q90 30 86 70 Q70 90 50 86 Q30 90 14 70 Z" fill="#8a4b5e" stroke="#2b1119" strokeWidth="4" />
          <path d="M26 30 L14 6 L38 24 Z M74 30 L86 6 L62 24 Z" fill="#e9e1cc" stroke="#2b1119" strokeWidth="3" />
          <circle cx="38" cy="50" r="6" fill="#ffe14a" /><circle cx="62" cy="50" r="6" fill="#ffe14a" />
          <path d="M34 68 L42 62 L50 70 L58 62 L66 68" stroke="#f2ead2" strokeWidth="4" fill="none" />
        </symbol>
        <symbol id="tok-generic" viewBox="0 0 100 100">
          <path d="M22 50 Q22 18 50 16 Q78 18 78 50 Q78 64 66 70 L66 84 L34 84 L34 70 Q22 64 22 50 Z" fill="#d8d2c2" stroke="#33302a" strokeWidth="4" />
          <circle cx="38" cy="48" r="8" fill="#33302a" /><circle cx="62" cy="48" r="8" fill="#33302a" />
          <path d="M50 58 L45 66 H55 Z" fill="#33302a" />
        </symbol>
 <clipPath id="clip-round" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5" /></clipPath>
        <symbol id="tok-crown" viewBox="0 0 100 60">
          <path d="M6 54 L14 10 L34 34 L50 4 L66 34 L86 10 L94 54 Z" fill="#f5b83d" stroke="#5a3d00" strokeWidth="5" />
        </symbol>
      </defs>
    </svg>
  );
}

export function Portrait({ kind, owner, character, size = 56, datasheet, editable }: { kind: TokenKind; owner: 0 | 1; character?: boolean; size?: number; datasheet?: string; editable?: boolean }) {
  usePortraitsVersion();
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = window.setTimeout(() => setMsg(null), 2600); return () => window.clearTimeout(t); }, [msg]);
  const rim = owner ? 'var(--p1)' : 'var(--p0)';
  const photo = datasheet ? getPortrait(datasheet) : undefined;
  const pick = async (f?: File) => {
    if (!f || !datasheet) return;
    try {
      const ok = setPortrait(datasheet, await fileToPortrait(f));
      setMsg(ok ? 'ใส่รูปแล้ว' : 'ใส่รูปแล้ว (เก็บถาวรในเครื่องไม่ได้)');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'อ่านรูปไม่ได้'); }
  };
  return (
    <span className="portrait" style={{ width: size, height: size }} onClick={() => editable && input.current?.click()}>
      {photo
        ? <img className="portrait-img" src={photo} alt="" style={{ borderColor: rim }} />
        : (
          <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ cursor: editable ? 'pointer' : undefined }}>
            <circle cx="50" cy="50" r="48" fill="var(--surface2)" />
            <use href={`#tok-${kind}`} x="14" y="16" width="72" height="72" />
            <circle cx="50" cy="50" r="47" fill="none" stroke={rim} strokeWidth="4" />
            {editable && <text x="50" y="96" fontSize="13" textAnchor="middle" fill="var(--muted)">+ รูป</text>}
          </svg>
        )}
      {character && <svg className="portrait-crown" viewBox="0 0 100 60" aria-hidden="true"><use href="#tok-crown" /></svg>}
      {msg && <span className="portrait-msg">{msg}</span>}
      {editable && <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }} />}
      {editable && datasheet && hasOwnPortrait(datasheet) && <button type="button" className="portrait-x" onClick={(e) => { e.stopPropagation(); if (datasheet) setPortrait(datasheet, null); }} aria-label="ลบรูป">×</button>}
    </span>
  );
}
