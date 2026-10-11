// An on-screen joystick for moving a unit with the thumb: hold the knob and push it the way the unit should go; the
// further it is pushed, the faster the unit walks. The finger stays off the board, so it never hides the models.
import { useEffect, useRef, useState } from 'react';

interface Props {
  /** called every frame while the knob is pushed: direction (screen axes, length 0..1) and the seconds since the last frame */
  onMove: (x: number, y: number, dt: number) => void;
  /** the knob was let go */
  onEnd: () => void;
  size?: number;
  disabled?: boolean;
}

export function Joystick({ onMove, onEnd, size = 116, disabled }: Props) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const vec = useRef({ x: 0, y: 0 });
  const held = useRef<number | null>(null);
  const raf = useRef(0);
  const last = useRef(0);
  // the latest callbacks (the loop outlives the render that started it)
  const cb = useRef({ onMove, onEnd });
  cb.current = { onMove, onEnd };
  const R = size / 2 - 20;

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const aim = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const L = Math.hypot(x, y);
    if (L > R) { x *= R / L; y *= R / L; }
    setKnob({ x, y });
    vec.current = { x: x / R, y: y / R };
  };
  const loop = (t: number) => {
    const dt = last.current ? Math.min(0.05, (t - last.current) / 1000) : 0;
    last.current = t;
    // a little dead zone in the middle, so resting the thumb doesn't creep the unit
    if (dt > 0 && Math.hypot(vec.current.x, vec.current.y) > 0.15) cb.current.onMove(vec.current.x, vec.current.y, dt);
    raf.current = requestAnimationFrame(loop);
  };
  const release = () => {
    if (held.current === null) return;
    held.current = null;
    cancelAnimationFrame(raf.current);
    vec.current = { x: 0, y: 0 };
    setKnob({ x: 0, y: 0 });
    cb.current.onEnd();
  };

  return (
    <div
      ref={base}
      className={`joystick ${disabled ? 'off' : ''} ${held.current !== null ? 'held' : ''}`}
      style={{ width: size, height: size }}
      role="slider"
      aria-label="Move joystick: hold and push the way the unit should go"
      aria-valuenow={Math.round(Math.hypot(knob.x, knob.y))}
      onPointerDown={(e) => {
        if (disabled) return;
        held.current = e.pointerId;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        aim(e);
        last.current = 0;
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(loop);
      }}
      onPointerMove={(e) => { if (held.current === e.pointerId) aim(e); }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className="joystick-ring" aria-hidden="true" />
      <span className="joystick-knob" aria-hidden="true" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
