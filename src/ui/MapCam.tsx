import { useEffect, useRef, useState } from 'react';
import { alive } from '../engine/state';
import type { GameState, Pt, UnitState } from '../engine/types';
import { Icon } from './Icon';

/** Where the live map looks: the unit picked (or being moved) when it stands on the table; null for the whole board. */
export function camFocus(picked: UnitState | null): Pt | null {
  const ms = picked && picked.status === 'board' ? alive(picked) : [];
  return ms.length ? { x: ms.reduce((a, m) => a + m.x, 0) / ms.length, y: ms.reduce((a, m) => a + m.y, 0) / ms.length } : null;
}

const VIEW = 20; // inches across when zoomed on a unit

/** Phone: a small live view of the battlefield while a sheet hides it, with one line saying what just happened. It
 *  mirrors the board itself (an SVG <use>), so it costs no extra rendering of units. Zoomed on the picked unit (shown
 *  only while the sheet hides that unit), else the whole board (shown while the sheet hides most of the board); never
 *  over the dice tray. Drag the caption to move the window; close it and it stays away until the board is uncovered. */
export function MapCam({ s, focus }: { s: GameState; focus: Pt | null }) {
  const [covered, setCovered] = useState(false);
  const [closed, setClosed] = useState(false);
  const [top, setTop] = useState(96);
  const [pos, setPos] = useState<Pt | null>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    const check = () => {
      const svg = document.querySelector('.board-wrap > svg:not(.fx-overlay)') as SVGSVGElement | null;
      const m = svg?.getScreenCTM();
      const f = focusRef.current;
      let now = false;
      // the dice tray shows both sides itself, and its 1-Click Resolve sits where this window would go
      if (svg && m && !document.querySelector('.tray')) {
        const box = svg.getBoundingClientRect();
        const sheetTop = Math.min(box.bottom, document.querySelector('.game-side')?.getBoundingClientRect().top ?? Infinity);
        if (f) {
          const at = new DOMPoint(f.x, f.y).matrixTransform(m);
          now = at.x < box.left || at.x > box.right || at.y < box.top || at.y > sheetTop - 24;
        } else now = box.bottom - sheetTop > box.height * 0.5;
      }
      setCovered(now);
      if (!now) setClosed(false);
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
  const x = focus ? Math.min(W + 1 - vw / 2, Math.max(-1 - vw / 2, focus.x - vw / 2)) : -1;
  const y = focus ? Math.min(H + 1 - vh / 2, Math.max(-1 - vh / 2, focus.y - vh / 2)) : -1;
  const line = s.log[s.log.length - 1]?.text ?? '';

  return (
    <div className="map-cam" style={pos ? { left: pos.x, top: pos.y, right: 'auto' } : { top }} role="group" aria-label={`Live map: ${line}`}>
      <svg viewBox={`${x} ${y} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true"><use href="#board-live" /></svg>
      <div
        className="map-cam-line"
        style={{ cursor: 'move' }}
        onPointerDown={(e) => {
          const r = e.currentTarget.parentElement!.getBoundingClientRect();
          drag.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const r = e.currentTarget.parentElement!.getBoundingClientRect();
          setPos({ x: Math.min(window.innerWidth - r.width, Math.max(0, e.clientX - d.dx)), y: Math.min(window.innerHeight - r.height, Math.max(0, e.clientY - d.dy)) });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >{line || 'Live map'}</div>
      <button className="map-cam-close" aria-label="Close the live map" onClick={() => setClosed(true)}><Icon name="close" size={14} /></button>
    </div>
  );
}
