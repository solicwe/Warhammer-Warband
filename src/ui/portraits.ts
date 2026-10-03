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
export const getPortrait = (datasheet: string): string | undefined =>
  cache[datasheet] ?? (cloud[datasheet] ? `/_blob/${cloud[datasheet].asset}` : undefined) ?? served[datasheet];
/** true when the player added this photo in the app (so it can be removed); server images can't be. */
export const hasOwnPortrait = (datasheet: string): boolean => datasheet in cache || (cloudMode === 'write' && datasheet in cloud);
export const ownPortraitCount = (): number => Object.keys(cache).length;
/** photos to export: this browser's and the web page's */
export const exportablePortraitCount = (): number => new Set([...Object.keys(cache), ...Object.keys(cloud)]).size;
export const servedPortraitCount = (): number => Object.keys(served).length;

export function setPortrait(datasheet: string, dataUrl: string | null): boolean {
  if (dataUrl) cache[datasheet] = dataUrl; else delete cache[datasheet];
  save();
  // on the web link: the photo goes up to the site (shown at once from here, kept locally until the upload lands)
  if (dataUrl) void uploadToCloud(datasheet, dataUrl);
  else if (cloud[datasheet]) void removeFromCloud(datasheet);
  return portraitsPersisted;
}

// ---- photos kept on the web page itself (claude.ai artifact: `assets` for the files, `db` for which is which) ----

type CloudDoc = { name: string; asset: string };
interface DbLike {
  collection(path: string): { onSnapshot(next: (q: { docs: { id: string; data(): Record<string, unknown> | undefined }[] }) => void, err?: (e: unknown) => void): () => void };
  doc(path: string): { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> };
}
interface AssetsLike { upload(b: Blob, o?: { type?: string }): Promise<{ id: string; url: string }>; delete(ref: string): Promise<unknown> }
type Host = { use?: (name: string) => Promise<unknown> };

/** Datasheet name → photo on the web page (everyone who opens the link sees it). */
let cloud: Record<string, CloudDoc> = {};
let cloudDb: DbLike | null = null;
let cloudAssets: AssetsLike | null = null;
/** 'off': not on the web link · 'read': photos show, this viewer can't add · 'write': photos added here go up */
export let cloudMode: 'off' | 'read' | 'write' = 'off';
const COLL = 'portraits';
const docId = (name: string) => imageSlug(name).slice(0, 180) || 'unit';

let cloudInit: Promise<void> | null = null;
/** Connect to the page's own storage when running as a claude.ai artifact; elsewhere nothing happens. */
export function initCloudPortraits(): Promise<void> {
  cloudInit ??= (async () => {
    const host = (globalThis as unknown as { claude?: Host }).claude;
    if (!host?.use) return;
    cloudDb = (await host.use('db').catch(() => null)) as DbLike | null;
    if (!cloudDb) return;
    cloudAssets = (await host.use('assets').catch(() => null)) as AssetsLike | null;
    cloudMode = cloudAssets ? 'write' : 'read';
    cloudDb.collection(COLL).onSnapshot((q) => {
      const next: Record<string, CloudDoc> = {};
      for (const d of q.docs) {
        const b = d.data() as Partial<CloudDoc> | undefined;
        if (b && typeof b.name === 'string' && typeof b.asset === 'string' && /^[0-9a-f]{32}$/.test(b.asset)) next[b.name] = { name: b.name, asset: b.asset };
      }
      cloud = next;
      version++;
      listeners.forEach((l) => l());
    }, () => { cloudMode = 'off'; });
    version++;
    listeners.forEach((l) => l());
  })().catch(() => { cloudMode = 'off'; });
  return cloudInit;
}

/** The last upload problem, for the screen to show (cleared when the next upload starts). */
export let cloudError: string | null = null;

// Uploads go one at a time, in order. A photo already waiting or on its way is never sent twice, and a photo
// replaced or removed before its turn is skipped: each name keeps exactly one file on the site.
let queue: Promise<unknown> = Promise.resolve();
const waiting = new Map<string, { url: string; done: Promise<boolean> }>();
export const uploadsPending = (): number => waiting.size;

function uploadToCloud(name: string, dataUrl: string): Promise<boolean> {
  const w = waiting.get(name);
  if (w?.url === dataUrl) return w.done;
  const done = queue.then(() => uploadNow(name, dataUrl)).finally(() => {
    if (waiting.get(name)?.done === done) waiting.delete(name);
    version++;
    listeners.forEach((l) => l());
  });
  waiting.set(name, { url: dataUrl, done });
  queue = done.catch(() => undefined);
  version++;
  listeners.forEach((l) => l());
  return done;
}

async function uploadNow(name: string, dataUrl: string): Promise<boolean> {
  await initCloudPortraits();
  if (cloudMode !== 'write' || !cloudDb || !cloudAssets) return false;
  if (waiting.get(name)?.url !== dataUrl || cache[name] !== dataUrl) return false; // replaced or removed meanwhile
  cloudError = null;
  try {
    const { bytes, ext } = dataUrlBytes(dataUrl);
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const old = cloud[name]?.asset;
    const up = await cloudAssets.upload(new Blob([bytes as BlobPart], { type }), { type });
    try {
      await cloudDb.doc(`${COLL}/${docId(name)}`).set({ name, asset: up.id });
    } catch (e) {
      await cloudAssets.delete(up.id).catch(() => undefined); // nothing points at it: don't leave it behind
      throw e;
    }
    if (old && old !== up.id) await cloudAssets.delete(old).catch(() => undefined);
    cloud[name] = { name, asset: up.id };
    if (cache[name] === dataUrl) delete cache[name];
    save();
    return true;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    cloudError = code === 'quota_or_state' ? 'พื้นที่เก็บรูปบนเว็บเต็ม' : code === 'too_large' ? 'รูปใหญ่เกินไป'
      : code === 'rate_limited' || code === 'resource_exhausted' ? 'อัปถี่เกินไป — รอสักครู่แล้วกดอัปรูปในเครื่องอีกครั้ง'
      : 'อัปรูปขึ้นเว็บไม่สำเร็จ — เก็บไว้ในเครื่องนี้แทน';
    return false;
  }
}

async function removeFromCloud(name: string) {
  const c = cloud[name];
  if (!c || cloudMode !== 'write' || !cloudDb || !cloudAssets) return;
  delete cloud[name];
  version++;
  listeners.forEach((l) => l());
  try {
    await cloudDb.doc(`${COLL}/${docId(name)}`).delete();
    await cloudAssets.delete(c.asset);
  } catch { cloudError = 'ลบรูปบนเว็บไม่สำเร็จ'; }
}

/** Send every photo kept only in this browser up to the site. Resolves to how many went up. */
export async function uploadAllLocal(): Promise<number> {
  const results = await Promise.all(Object.entries(cache).map(([name, url]) => uploadToCloud(name, url)));
  return results.filter(Boolean).length;
}

/**
 * Clean the site's photo store: photos of units that are in no army any more (moved to Legends …, when `known`
 * lists every current datasheet name), and files no photo points at (left by an interrupted or doubled upload;
 * only those older than two minutes, so an upload on its way is never touched). Deletes for good — only on the
 * player's say-so. Resolves to what was removed.
 */
export async function removeUnusedCloudFiles(known?: Set<string>): Promise<{ photos: string[]; files: number }> {
  const out = { photos: [] as string[], files: 0 };
  if (cloudMode !== 'write' || !cloudAssets || !cloudDb || waiting.size) return out;
  if (known?.size) {
    for (const name of Object.keys(cloud)) {
      if (known.has(name)) continue;
      try { await cloudDb.doc(`${COLL}/${docId(name)}`).delete(); delete cloud[name]; out.photos.push(name); } catch { /* keep it */ }
    }
  }
  const list = (cloudAssets as AssetsLike & { list(): Promise<{ assets: { id: string; createdAt: string }[] }> }).list;
  const { assets } = await list.call(cloudAssets);
  const used = new Set(Object.values(cloud).map((c) => c.asset));
  const old = Date.now() - 2 * 60_000;
  for (const a of assets) {
    if (used.has(a.id) || Date.parse(a.createdAt) > old) continue;
    try { await cloudAssets.delete(a.id); out.files++; } catch { /* try the rest */ }
  }
  version++;
  listeners.forEach((l) => l());
  return out;
}

/** Names of photos on the site that are not in `known` (units no longer in any army). */
export const cloudPhotosNotIn = (known: Set<string>): string[] => Object.keys(cloud).filter((n) => !known.has(n));

export const cloudPortraitCount = (): number => Object.keys(cloud).length;
export const cloudErrorNow = (): string | null => cloudError;

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
export async function exportPortraitsZip(factionOf: (datasheet: string) => string | undefined): Promise<Uint8Array> {
  const files: { name: string; data: Uint8Array }[] = [];
  const units: ImageManifest['units'] = {};
  const all = new Map<string, () => Promise<{ bytes: Uint8Array; ext: string }>>();
  for (const [name, c] of Object.entries(cloud)) {
    all.set(name, async () => {
      const r = await fetch(`/_blob/${c.asset}`);
      const type = r.headers.get('content-type') ?? '';
      return { bytes: new Uint8Array(await r.arrayBuffer()), ext: type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg' };
    });
  }
  for (const [name, url] of Object.entries(cache)) all.set(name, async () => dataUrlBytes(url));
  for (const [name, read] of [...all].sort(([a], [b]) => a.localeCompare(b))) {
    const got = await read().catch(() => null);
    if (!got) continue;
    const faction = factionOf(name) ?? 'other';
    const path = `units/${faction}/${imageSlug(name)}.${got.ext}`;
    files.push({ name: path, data: got.bytes });
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

type SaveFn = (r: { filename: string; data: Blob }) => Promise<unknown>;
type ClaudeHost = { use?: (name: string) => Promise<{ save: SaveFn } | null> };

/**
 * Save bytes / text as a file on the player's device. Inside a claude.ai artifact the page may not download by
 * itself, so the file goes through the host's `downloads` capability (the player confirms). Resolves to a message.
 */
export async function download(name: string, data: Uint8Array | string, type: string): Promise<string> {
  const blob = new Blob([data as BlobPart], { type });
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const dl = await host.use('downloads').catch(() => null);
    if (!dl) return 'หน้านี้บันทึกไฟล์ไม่ได้';
    try { await dl.save({ filename: name, data: blob }); return `บันทึก ${name} แล้ว`; }
    catch (e) { return (e as { code?: string })?.code === 'declined' ? 'ยกเลิกการบันทึก' : 'บันทึกไฟล์ไม่ได้'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return `บันทึก ${name} แล้ว`;
}
