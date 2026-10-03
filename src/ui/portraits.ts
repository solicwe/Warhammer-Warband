// Unit photos, keyed by datasheet name. Two sources:
//  1. images on the server: `public/images/units/<FACTION>/<datasheet-slug>.webp|jpg|png`, listed in
//     `public/images/manifest.json` (built by `npm run images`). The folder can live elsewhere: set VITE_IMAGE_BASE.
//  2. photos the player adds in the app, stored only in this browser. These win over the server images, and can be
//     exported as a zip in the same folder layout, ready to drop into `public/images/units/` and upload.
import { useEffect, useSyncExternalStore } from 'react';

const KEY = 'w40k11-portraits';
let cache: Record<string, string> = {};
try { cache = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { cache = {}; }
let version = 0;
const listeners = new Set<() => void>();

/** false when the browser refused to store the photos (storage full / blocked): they last until the page closes. */
export let portraitsPersisted = true;
function save() {
  version++;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); portraitsPersisted = true; } catch { portraitsPersisted = false; }
  listeners.forEach((l) => l());
}

/** Where the server images live (a folder next to the page by default, or a CDN / bucket URL). */
export const IMAGE_BASE: string = ((import.meta.env?.VITE_IMAGE_BASE as string | undefined) ?? './images/').replace(/\/?$/, '/');

/** Datasheet name → image URL, from the server manifest. */
let served: Record<string, string> = {};
export interface ImageManifest { version: number; units: Record<string, Record<string, string>> }

/** Fill the server images from a manifest (`units: { FACTION: { "Datasheet": "units/FACTION/file.webp" } }`). */
export function applyManifest(m: ImageManifest, base = IMAGE_BASE) {
  const next: Record<string, string> = {};
  for (const faction of Object.values(m.units ?? {})) {
    for (const [name, file] of Object.entries(faction)) next[name] ??= /^(https?:|data:|\/)/.test(file) ? file : base + file;
  }
  served = next;
  version++;
  listeners.forEach((l) => l());
}

let manifestLoad: Promise<void> | null = null;
/** Fetch the server's image list once; no folder / no manifest simply means no server images. */
export function loadImageManifest(): Promise<void> {
  manifestLoad ??= (typeof fetch === 'function' ? fetch(IMAGE_BASE + 'manifest.json') : Promise.reject())
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((m: ImageManifest) => applyManifest(m))
    .catch(() => undefined);
  return manifestLoad;
}

/** The picture to show: the player's own photo, else the server image. */
export const getPortrait = (datasheet: string): string | undefined => cache[datasheet] ?? served[datasheet];
/** true when the player added this photo in the app (so it can be removed); server images can't be. */
export const hasOwnPortrait = (datasheet: string): boolean => datasheet in cache;
export const ownPortraitCount = (): number => Object.keys(cache).length;
export const servedPortraitCount = (): number => Object.keys(served).length;

export function setPortrait(datasheet: string, dataUrl: string | null): boolean {
  if (dataUrl) cache[datasheet] = dataUrl; else delete cache[datasheet];
  save();
  return portraitsPersisted;
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้ (ใช้ JPG / PNG / WebP — รูป HEIC จาก iPhone ให้แปลงก่อน)')); };
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

/** File name used in the images folder: "Intercessor Squad" → "intercessor-squad". Same rule as scripts/build-images.mjs. */
export const imageSlug = (name: string) =>
  name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- export / import (for moving photos to the server or another device) ----

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A plain (uncompressed) zip: images are already compressed. */
export function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint32(14, crc, true); head.setUint32(18, f.data.length, true); head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, f.data.length, true); dir.setUint32(24, f.data.length, true);
    dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true);
    parts.push(new Uint8Array(head.buffer), name, f.data);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

function dataUrlBytes(url: string): { bytes: Uint8Array; ext: string } {
  const [head, body] = url.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext: mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg' };
}

/**
 * The player's photos as a zip laid out like the server folder: `units/<FACTION>/<slug>.jpg` + `manifest.json`.
 * `factionOf` tells which faction folder a datasheet goes in (unknown ones go in `units/other/`).
 */
export function exportPortraitsZip(factionOf: (datasheet: string) => string | undefined): Uint8Array {
  const files: { name: string; data: Uint8Array }[] = [];
  const units: ImageManifest['units'] = {};
  for (const [name, url] of Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))) {
    const { bytes, ext } = dataUrlBytes(url);
    const faction = factionOf(name) ?? 'other';
    const path = `units/${faction}/${imageSlug(name)}.${ext}`;
    files.push({ name: path, data: bytes });
    (units[faction] ??= {})[name] = path;
  }
  files.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({ version: 1, units }, null, 2) + '\n') });
  return makeZip(files);
}

/** A backup of the player's photos ({ datasheet: dataURL }), to move them to another browser. */
export const exportPortraitsJson = (): string => JSON.stringify({ kind: 'w40k11-portraits', version: 1, portraits: cache });

/** Load a backup made by exportPortraitsJson; returns how many photos were added. */
export function importPortraitsJson(text: string): number {
  const j = JSON.parse(text);
  const src: Record<string, unknown> = j?.portraits ?? j;
  let n = 0;
  for (const [name, url] of Object.entries(src)) if (typeof url === 'string' && url.startsWith('data:image/')) { cache[name] = url; n++; }
  if (n) save();
  return n;
}

/** Save bytes / text as a file on the player's device. */
export function download(name: string, data: Uint8Array | string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
