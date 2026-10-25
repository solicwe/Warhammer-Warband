import { useEffect, useRef, useState } from 'react';
import { alive } from '../engine/state';
import type { GameState, Pt, UnitState } from '../engine/types';
import { Icon } from './Icon';

const centreOf = (u: UnitState | null | undefined): Pt | null => {
  const ms = u ? alive(u) : [];
  return ms.length ? { x: ms.reduce((a, m) => a + m.x, 0) / ms.length, y: ms.reduce((a, m) => a + m.y, 0) / ms.length } : null;
};

/** Where the camera looks: the attack under way, else the unit being moved or picked, else the last thing that happened. */
export function camFocus(s: GameState, picked: UnitState | null): Pt | null {
  const by = (id?: string) => (id ? s.units.find((u) => u.id === id) : undefined);
  if (s.attack) {
    const a = centreOf(by(s.attack.attackerId)), t = centreOf(by(s.attack.targetId));
    if (a && t) return { x: (a.x + t.x) / 2, y: (a.y + t.y) / 2 };
    return a ?? t;
  }
  return centreOf(picked) ?? centreOf(by(s.lastAct?.unitId));
}

const VIEW = 20; // inches across when following the action

/** Phone: while a sheet, the dice or a menu covers most of the screen, a small live view of the battlefield where the action is,
 *  with one line saying what just happened. It mirrors the board itself (an SVG <use>), so it costs no extra rendering
 *  of units. Drag the picture to look around, drag the caption to move the window; close it and it stays away until the board is uncovered again. */
export function MapCam({ s, focus }: { s: GameState; focus: Pt | null }) {
  const [covered, setCovered] = useState(false);
  const [closed, setClosed] = useState(false);
  const [top, setTop] = useState(96);
  const [pos, setPos] = useState<Pt | null>(null);
  const drag = useRef<{ id: number; dx: number; dy: number; pan?: { x: number; y: number; ox: number; oy: number } } | null>(null);
  // the player's own look-around, added to the follow camera (dragging the picture pans, dragging the caption moves
  // the window)
  const [off, setOff] = useState<Pt>({ x: 0, y: 0 });

  useEffect(() => {
    const check = () => {
      const h = window.innerHeight;
      const cover = (sel: string) => { const el = document.querySelector(sel); return el ? h - el.getBoundingClientRect().top : 0; };
      const now = Math.max(cover('.game-side'), cover('.tray')) > h * 0.55;
      setCovered(now);
      if (!now) { setClosed(false); setOff({ x: 0, y: 0 }); }
      const board = document.querySelector('.board-wrap');
      if (board) setTop(board.getBoundingClientRect().top + 8);
    };
    check();
    const t = window.setInterval(check, 500);
    return () => window.clearInterval(t);
  }, []);

  if (!covered || closed) return null;
  const W = s.table?.width ?? 44, H = s.table?.height ?? 60;
  const vw = focus ? VIEW : W + 2, vh = focus ? VIEW * 0.72 : H + 2;
  const x = Math.min(W + 1 - vw / 2, Math.max(-1 - vw / 2, (focus ? focus.x - vw / 2 : -1) + off.x));
  const y = Math.min(H + 1 - vh / 2, Math.max(-1 - vh / 2, (focus ? focus.y - vh / 2 : -1) + off.y));
  const line = s.log[s.log.length - 1]?.text ?? '';

  return (
    <div
      className="map-cam"
      style={pos ? { left: pos.x, top: pos.y, right: 'auto' } : { top }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const onPicture = (e.target as Element).closest('svg');
        drag.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, pan: onPicture ? { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y } : undefined };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (d.pan) { const k = vw / r.width; setOff({ x: d.pan.ox - (e.clientX - d.pan.x) * k, y: d.pan.oy - (e.clientY - d.pan.y) * k }); return; }
        setPos({ x: Math.min(window.innerWidth - r.width, Math.max(0, e.clientX - d.dx)), y: Math.min(window.innerHeight - r.height, Math.max(0, e.clientY - d.dy)) });
      }}
      onPointerUp={() => { drag.current = null; }}
      role="img"
      aria-label={`Live map: ${line}`}
    >
      <svg style={{ cursor: 'move' }} viewBox={`${x} ${y} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true"><use href="#board-live" /></svg>
      <div className="map-cam-line">{line || 'Live map'}</div>
      <button className="map-cam-close" aria-label="Close the live map" onPointerDown={(e) => e.stopPropagation()} onClick={() => setClosed(true)}><Icon name="close" size={14} /></button>
    </div>
  );
}
