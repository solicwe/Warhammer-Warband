// User-supplied unit photos, keyed by datasheet name. Stored only in this browser.
import { useSyncExternalStore } from 'react';

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
