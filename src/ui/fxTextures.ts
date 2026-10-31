// Soft noise sprites for the battle effects, drawn once on a canvas: real smoke, fire, dust and muzzle flashes are
// ragged and uneven, never clean circles or stars. Each kind has a few variants so neighbouring puffs differ.

export type TexKind = 'smoke' | 'fire' | 'flash' | 'dust';
const SIZE = 64, VARIANTS = 4;
let cache: Record<TexKind, string[]> | null | undefined;

/** seeded 2D value noise, summed over octaves (fractal noise) */
function fbm(seed: number) {
  const h = (x: number, y: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return v - Math.floor(v); };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x: number, y: number) => {
    let v = 0, amp = 0.5, f = 1;
    for (let o = 0; o < 4; o++) { v += noise(x * f, y * f) * amp; amp /= 2; f *= 2; }
    return v / 0.9375;
  };
}

function draw(kind: TexKind, seed: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(SIZE, SIZE), n = fbm(seed + 1), n2 = fbm(seed + 7);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = (x + 0.5) / SIZE * 2 - 1, v = (y + 0.5) / SIZE * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
    const turb = n(u * 2.2 + 3, v * 2.2 + 3), fine = n2(u * 5 + 9, v * 5 + 9);
    let R = 0, G = 0, B = 0, A = 0;
    if (kind === 'smoke' || kind === 'dust') {
      // a billow: the edge is pushed in and out by the noise, the body is uneven
      const edge = 0.7 + (turb - 0.5) * 0.9, body = Math.max(0, 1 - r / edge);
      A = Math.pow(body, 1.4) * (0.35 + fine * 0.65) * 0.9; // no hard rim: it thins out into wisps
      const shade = 0.8 + (fine - 0.5) * 0.45;
      [R, G, B] = kind === 'smoke' ? [150 * shade, 146 * shade, 140 * shade] : [138 * shade, 118 * shade, 92 * shade];
    } else if (kind === 'fire') {
      // heat from the centre out: white, yellow, orange, then dark red tongues licking through the noise
      const heat = Math.max(0, 1 - r / (0.65 + (turb - 0.5) * 1.0)) * (0.5 + fine * 0.7);
      A = Math.min(1, Math.pow(heat, 1.3) * 1.7);
      R = 255; G = Math.min(240, 70 + heat * 230); B = Math.max(0, heat * 330 - 210);
      if (heat < 0.3) { R = 190 + heat * 200; G = 50 + heat * 150; B = 15; } // the cooler edge is deep orange-red
    } else {
      // a muzzle flash: uneven rays of flame from a white-hot core, longest forwards (+x)
      const rays = Math.pow(n(Math.cos(a) * 1.5 + 5, Math.sin(a) * 1.5 + 5), 2) * (0.55 + 0.45 * Math.max(0, Math.cos(a)));
      const reach = 0.25 + rays * 1.1, heat = Math.max(0, 1 - r / reach);
      A = Math.min(1, heat * 1.8) * (0.7 + fine * 0.3);
      R = 255; G = Math.min(255, 150 + heat * 140); B = Math.min(255, heat * 260);
    }
    const i = (y * SIZE + x) * 4;
    img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = Math.max(0, Math.min(255, A * 255));
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** The sprite set, made on first use; null where there is no canvas (tests, server rendering): effects then use plain shapes. */
export function fxTextures(): Record<TexKind, string[]> | null {
  if (cache !== undefined) return cache;
  try {
    if (typeof document === 'undefined' || !document.createElement('canvas').getContext('2d')) return (cache = null);
    const kinds: TexKind[] = ['smoke', 'fire', 'flash', 'dust'];
    cache = Object.fromEntries(kinds.map((k, ki) => [k, Array.from({ length: VARIANTS }, (_, v) => draw(k, ki * 13 + v * 5 + 1))])) as Record<TexKind, string[]>;
  } catch { cache = null; }
  return cache;
}

const energyCache = new Map<string, string[]>();

/** Ragged tendrils of light in one colour (warp energy, power fields, sound pressure): a white-hot heart with filaments
 *  of the colour licking out of it. Made on first use per colour; empty where there is no canvas. */
export function energyTex(hex: string): string[] {
  const hit = energyCache.get(hex);
  if (hit) return hit;
  if (!fxTextures()) return [];
  const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = Array.from({ length: 3 }, (_, vi) => {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    if (!g) return '';
    const img = g.createImageData(SIZE, SIZE), n = fbm(vi * 31 + 3), warp = fbm(vi * 17 + 11);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const u = (x + 0.5) / SIZE * 2 - 1, v = (y + 0.5) / SIZE * 2 - 1, r = Math.hypot(u, v);
      // domain warp, then ridges of the noise: thin bright filaments rather than a soft blob
      const wx = u + (warp(u * 2 + 1, v * 2 + 1) - 0.5) * 0.8, wy = v + (warp(u * 2 + 7, v * 2 + 7) - 0.5) * 0.8;
      const ridge = Math.pow(1 - Math.abs(n(wx * 2.5 + 4, wy * 2.5 + 4) * 2 - 1), 4);
      const fall = Math.max(0, 1 - r), core = Math.pow(Math.max(0, 1 - r * 2.2), 2);
      const A = Math.min(1, fall * fall * (ridge * 1.6 + 0.12) + core);
      const w = Math.min(1, core * 1.4 + ridge * fall * 0.35); // whiter where it is hottest
      const i = (y * SIZE + x) * 4;
      img.data[i] = cr + (255 - cr) * w; img.data[i + 1] = cg + (255 - cg) * w; img.data[i + 2] = cb + (255 - cb) * w;
      img.data[i + 3] = A * 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  });
  energyCache.set(hex, out);
  return out;
}
