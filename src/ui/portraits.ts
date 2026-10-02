// User-supplied unit photos, keyed by datasheet name. Stored only in this browser.
import { useEffect, useSyncExternalStore } from 'react';

const KEY = 'w40k11-portraits';
let cache: Record<string, string> = {};
try { cache = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { cache = {}; }
let version = 0;
const listeners = new Set<() => void>();

function save() {
  version++;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage full or blocked: keep in memory */ }
  listeners.forEach((l) => l());
}

export const getPortrait = (datasheet: string): string | undefined => cache[datasheet];

export function setPortrait(datasheet: string, dataUrl: string | null) {
  if (dataUrl) cache[datasheet] = dataUrl; else delete cache[datasheet];
  save();
}

/** Re-render when portraits change; returns a version number usable as a memo key. */
export function usePortraitsVersion() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version);
}

/** Read an image file, centre-crop to a square and shrink to 160px JPEG. */
export function fileToPortrait(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const side = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
    img.src = url;
  });
}

const norm = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Match an image file name like "intercessor-squad.jpg" or "Warboss_2023.webp" to a datasheet name. */
export function matchDatasheet(fileName: string, names: string[]): string | undefined {
  const f = norm(fileName).replace(/\b(\d+|official|model|mini|photo|image|img|copy)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!f) return undefined;
  const exact = names.find((n) => norm(n) === f);
  if (exact) return exact;
  const contained = names.filter((n) => f.includes(norm(n)) || norm(n).includes(f)).sort((a, b) => norm(b).length - norm(a).length);
  if (contained.length) return contained[0];
  // fall back to word overlap
  const fw = new Set(f.split(' '));
  let best: string | undefined;
  let bestScore = 0;
  for (const n of names) {
    const w = norm(n).split(' ');
    const hit = w.filter((x) => fw.has(x) || fw.has(x.replace(/s$/, ''))).length;
    const score = hit / Math.max(w.length, fw.size);
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return bestScore >= 0.5 ? best : undefined;
}

/** While mounted, an image pasted anywhere on the page becomes this datasheet's portrait. */
export function usePastePortrait(datasheet: string | undefined) {
  useEffect(() => {
    if (!datasheet) return;
    const onPaste = async (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      try { setPortrait(datasheet, await fileToPortrait(file)); } catch { /* unreadable image */ }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [datasheet]);
}
