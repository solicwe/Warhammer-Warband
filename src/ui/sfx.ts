// Sounds made on the spot with Web Audio (no sound files): short clicks, thuds and chimes that tell the player what
// just happened without looking. Browsers only allow sound after the first tap, which a game always has.

export type Sfx = 'tick' | 'hit' | 'wound' | 'kill' | 'destroy' | 'vp' | 'gem' | 'spend' | 'turn' | 'dice' | 'land' | 'card' | 'think' | 'bad' | 'good' | 'shock' | 'heal' | 'arrive' | 'charge';

const PREF = 'sfx-on';
let on = (() => { try { return localStorage.getItem(PREF) !== '0'; } catch { return true; } })();
let ctx: AudioContext | null = null;

export const soundOn = () => on;
export function setSoundOn(v: boolean) {
  on = v;
  try { localStorage.setItem(PREF, v ? '1' : '0'); } catch { /* private window: this session only */ }
}

function audio(): AudioContext | null {
  if (!on) return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    // iOS leaves it 'interrupted' after switching apps or tabs: wake it up whatever the state
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch { return null; }
}

// coming back to the page (or the next tap after it) resumes the sound
if (typeof window !== 'undefined') {
  // the first tap creates the sound context: one made later, outside a tap (the roll-off that opens a game), stays muted
  const wake = (e?: Event) => {
    // leaving the page: drop the context; mobile browsers can hand back one that says 'running' but stays silent
    if (document.visibilityState === 'hidden') { void ctx?.close().catch(() => undefined); ctx = null; return; }
    if (!ctx && e && e.type !== 'visibilitychange' && e.type !== 'pageshow') audio();
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
  window.addEventListener('pagehide', () => { void ctx?.close().catch(() => undefined); ctx = null; });
  for (const t of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(t, wake, { passive: true });
}

/** One note: an oscillator with a quick attack and an exponential fall. */
function tone(a: AudioContext, freq: number, at: number, len: number, type: OscillatorType, vol: number, slide = 0) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), at + len);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + len + 0.02);
}

/** A die knocking on the table: a short click of filtered noise with a hard little tone in it. */
function clack(a: AudioContext, at: number, vol: number, pitch: number) {
  noise(a, at, 0.025, vol, 2600 + pitch * 1800, 'bandpass');
  tone(a, 900 + pitch * 900, at, 0.03, 'square', vol * 0.18);
}

/** A burst of noise (dice rattle, impacts). */
function noise(a: AudioContext, at: number, len: number, vol: number, lowpass: number, kind: BiquadFilterType = 'lowpass') {
  const n = Math.max(1, Math.floor(a.sampleRate * len));
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = kind;
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(at);
}

// a major scale: each counted step of an attack plays one note higher (Balatro's rising count)
const SCALE = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5];

/** Play a sound. `step` raises the pitch of a counting sound; `size` makes a kill sound heavier (0..1). */
export function play(kind: Sfx, step = 0, size = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  switch (kind) {
    case 'tick': tone(a, SCALE[Math.min(SCALE.length - 1, step)], t, 0.09, 'triangle', 0.12); break;
    case 'hit': tone(a, SCALE[Math.min(SCALE.length - 1, step)] / 2, t, 0.08, 'square', 0.05); break;
    case 'wound': tone(a, 196 + step * 20, t, 0.12, 'sawtooth', 0.05, 0.6); break;
    case 'kill':
      noise(a, t, 0.12 + size * 0.2, 0.25 + size * 0.25, 900);
      tone(a, 110 - size * 30, t, 0.25 + size * 0.3, 'sine', 0.35, 0.5);
      break;
    case 'destroy':
      noise(a, t, 0.45, 0.45, 600);
      tone(a, 70, t, 0.6, 'sine', 0.5, 0.45);
      tone(a, 1046.5, t + 0.05, 0.25, 'triangle', 0.08);
      break;
    case 'vp': [783.99, 987.77, 1318.5].forEach((f, i) => tone(a, f, t + i * 0.07, 0.25, 'triangle', 0.12)); break;
    case 'gem': tone(a, 1567.98, t, 0.18, 'sine', 0.1); tone(a, 2093, t + 0.05, 0.2, 'sine', 0.06); break;
    case 'spend': tone(a, 880, t, 0.12, 'triangle', 0.1, 0.5); break;
    case 'turn': tone(a, 392, t, 0.18, 'triangle', 0.1); tone(a, 523.25, t + 0.12, 0.25, 'triangle', 0.1); break;
    case 'dice': {
      // dice shaken in the hand, then tumbling: knocks that come faster and fade (step = how many dice, roughly)
      const n = 7 + Math.min(8, step);
      let at = t;
      for (let i = 0; i < n; i++) {
        clack(a, at, 0.22 * (1 - i / (n * 1.4)), Math.random());
        at += 0.028 + Math.random() * 0.05 + i * 0.006;
      }
      break;
    }
    case 'land':
      // the dice settle: a soft double knock on the table
      noise(a, t, 0.06, 0.3, 700);
      clack(a, t + 0.07, 0.12, 0.2);
      break;
    case 'card':
      // a card flicked onto the table
      noise(a, t, 0.09, 0.22, 5200, 'highpass');
      noise(a, t + 0.05, 0.05, 0.1, 1500);
      break;
    case 'good': [659.25, 987.77].forEach((f, i) => tone(a, f, t + i * 0.08, 0.2, 'triangle', 0.1)); break;
    case 'think': tone(a, 660 + step * 40, t, 0.06, 'sine', 0.03); break;
    case 'bad': tone(a, 220, t, 0.22, 'square', 0.05, 0.7); break;
    // a unit breaks: two clashing low notes falling away
    case 'shock': tone(a, 233, t, 0.45, 'sawtooth', 0.05, 0.5); tone(a, 247, t, 0.45, 'sawtooth', 0.04, 0.48); break;
    // wounds regained: a soft rising shimmer
    case 'heal': [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => tone(a, f, t + i * 0.06, 0.3, 'sine', 0.06)); break;
    // from Reserves: a rush of air down, then the landing
    case 'arrive': noise(a, t, 0.35, 0.12, 3200, 'highpass'); noise(a, t + 0.3, 0.2, 0.35, 500); tone(a, 80, t + 0.3, 0.35, 'sine', 0.3, 0.5); break;
    // a charge slams home
    case 'charge': noise(a, t, 0.12, 0.3, 800); tone(a, 120, t, 0.18, 'sine', 0.25, 0.6); break;
  }
}
