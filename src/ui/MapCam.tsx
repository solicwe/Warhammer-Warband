import { useEffect, useRef, useState } from 'react';
import { alive } from '../engine/state';
import type { GameState, Pt, UnitState } from '../engine/types';
import { Icon } from './Icon';

/** Where the live map looks: the unit picked (or being moved) when it stands on the table; null for the whole board. */
export function camFocus(picked: UnitState | null): Pt | null {
  const ms = picked && picked.status === 'board' ? alive(picked) : [];
  return ms.length ? { x: ms.reduce((a, m) => a + m.x, 0) / ms.length, y: ms.reduce((a, m) => a + m.y, 0) / ms.length } : null;
}

/**
 * Phone & Desktop PiP Mirror: a live view of the battlefield while a sheet covers the board (or on demand).
 *
 * Controls are strictly separated to prevent conflicts:
 *  - Top header: drag to move the floating window anywhere on screen.
 *  - Middle map viewport: drag with mouse/finger to pan camera around the battlefield.
 *  - Bottom control bar: dedicated zoom buttons (1×, 2×, 3×, 4×, +, -) and target recenter button.
 *    (Events on the control bar stop propagation so tapping zoom NEVER triggers map panning).
 */
export function MapCam({
  s,
  focus,
  onClose,
  forceShow = false,
}: {
  s: GameState;
  focus: Pt | null;
  onClose?: () => void;
  forceShow?: boolean;
}) {
  const [covered, setCovered] = useState(false);
  const [closed, setClosed] = useState(false);
  const [top, setTop] = useState(96);
  const [pos, setPos] = useState<Pt | null>(null);
  const [expanded, setExpanded] = useState(false);

  // In-mirror zoom and camera position
  const [zoom, setZoom] = useState(1.0);
  const W = s.table?.width ?? 44;
  const H = s.table?.height ?? 60;
  const [center, setCenter] = useState<Pt>(() => focus ?? { x: W / 2, y: H / 2 });
  const [panning, setPanning] = useState(false);

  const userPanned = useRef(false);
  const prevFocus = useRef(focus);

  // Window drag ref (for moving window via header)
  const dragWindow = useRef<{ id: number; dx: number; dy: number } | null>(null);

  // Map panning refs (for panning viewport)
  const isMapPointerDown = useRef(false);
  const mapPanStart = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(null);
  const mapHasMoved = useRef(false);

  // Multi-touch pinch tracking on map viewport
  const touchStartDist = useRef<number | null>(null);
  const touchStartZoom = useRef<number>(1.0);

  // Auto-focus on active unit when it changes, unless user manually panned during this unit
  useEffect(() => {
    if (focus && (focus.x !== prevFocus.current?.x || focus.y !== prevFocus.current?.y)) {
      prevFocus.current = focus;
      if (!userPanned.current) {
        setCenter(focus);
      }
    }
  }, [focus]);

  // Check whether board is obscured by drawers / sheets
  useEffect(() => {
    const check = () => {
      const svg = document.querySelector('.board-wrap > svg:not(.fx-overlay)') as SVGSVGElement | null;
      const m = svg?.getScreenCTM();
      let now = false;
      if (svg && m) {
        const box = svg.getBoundingClientRect();
        const sheet = document.querySelector('.game-side');
        const sheetTop = sheet ? sheet.getBoundingClientRect().top : box.bottom;
        const visibleHeight = Math.max(0, Math.min(box.bottom, sheetTop) - box.top);
        const visibleRatio = box.height > 0 ? visibleHeight / box.height : 1;
        const hasOverlay = !!document.querySelector('.tray, .sheet-wrap, .rule-drawer');

        now = hasOverlay || visibleHeight < 30 || visibleRatio < 0.06;
      }
      setCovered(now);

      const board = document.querySelector('.board-wrap');
      if (board) setTop(board.getBoundingClientRect().top + 8);
    };
    check();
    const t = window.setInterval(check, 500);
    return () => window.clearInterval(t);
  }, []);

  if ((!covered && !forceShow) || closed) return null;

  // ViewBox dimensions with zoom factor applied
  // Full board reference: (W + 2) x (H + 2)
  const curVw = (W + 2) / zoom;
  const curVh = (H + 2) / zoom;

  // Clamped viewBox top-left
  const minX = -1;
  const maxX = W + 1 - curVw;
  const vx = maxX >= minX ? Math.max(minX, Math.min(maxX, center.x - curVw / 2)) : (W - curVw) / 2;

  const minY = -1;
  const maxY = H + 1 - curVh;
  const vy = maxY >= minY ? Math.max(minY, Math.min(maxY, center.y - curVh / 2)) : (H - curVh) / 2;

  // Header window drag handlers
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const parent = e.currentTarget.parentElement!;
    const r = parent.getBoundingClientRect();
    dragWindow.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragWindow.current;
    if (!d || d.id !== e.pointerId) return;
    const parent = e.currentTarget.parentElement!;
    const r = parent.getBoundingClientRect();
    const newX = Math.min(window.innerWidth - r.width, Math.max(0, e.clientX - d.dx));
    const newY = Math.min(window.innerHeight - r.height, Math.max(0, e.clientY - d.dy));
    setPos({ x: newX, y: newY });
  };

  const onHeaderPointerUp = () => {
    dragWindow.current = null;
  };

  // Map viewport panning handlers (single touch/mouse)
  const onMapPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    isMapPointerDown.current = true;
    mapHasMoved.current = false;
    mapPanStart.current = {
      x: e.clientX,
      y: e.clientY,
      centerX: center.x,
      centerY: center.y,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const onMapPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isMapPointerDown.current || !mapPanStart.current) return;
    const dx = e.clientX - mapPanStart.current.x;
    const dy = e.clientY - mapPanStart.current.y;

    if (!mapHasMoved.current && Math.hypot(dx, dy) < 4) return;
    mapHasMoved.current = true;
    setPanning(true);

    const rect = e.currentTarget.getBoundingClientRect();
    const inchesPerPixelX = curVw / Math.max(1, rect.width);
    const inchesPerPixelY = curVh / Math.max(1, rect.height);

    const newCenterX = mapPanStart.current.centerX - dx * inchesPerPixelX;
    const newCenterY = mapPanStart.current.centerY - dy * inchesPerPixelY;

    setCenter({
      x: Math.max(0, Math.min(W, newCenterX)),
      y: Math.max(0, Math.min(H, newCenterY)),
    });
    userPanned.current = true;
  };

  const onMapPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    isMapPointerDown.current = false;
    mapPanStart.current = null;
    setPanning(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  // Touch handlers for multi-touch pinch-to-zoom
  const onTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 2) {
      touchStartDist.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartZoom.current = zoom;
      isMapPointerDown.current = false;
      mapPanStart.current = null;
    }
  };

  const onTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 2 && touchStartDist.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = dist / touchStartDist.current;
      const nextZoom = Math.min(5.0, Math.max(1.0, touchStartZoom.current * scale));
      setZoom(Number(nextZoom.toFixed(1)));
      userPanned.current = true;
    }
  };

  const onTouchEnd = () => {
    touchStartDist.current = null;
  };

  // Wheel zoom on desktop
  const onMapWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const step = e.deltaY < 0 ? 0.3 : -0.3;
    setZoom((z) => Math.min(5.0, Math.max(1.0, Number((z + step).toFixed(1)))));
    userPanned.current = true;
  };

  // Double click toggles between 1x and 2.5x
  const onMapDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setZoom((z) => (z >= 2.0 ? 1.0 : 2.5));
    userPanned.current = true;
  };

  return (
    <div
      className={`map-cam ${expanded ? 'expanded' : ''}`}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto' } : { top }}
      role="region"
      aria-label="Live Mirror Battlefield View"
    >
      {/* 1. Header bar: Drag to move the floating window */}
      <div
        className="map-cam-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        title="Drag here to move window"
      >
        <div className="map-cam-title-wrap">
          <span className="map-cam-dot" aria-hidden="true" />
          <Icon name="camera" size={12} />
          <span>MIRROR</span>
        </div>
        <div className="map-cam-header-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="map-cam-hbtn"
            onClick={() => {
              if (focus) setCenter(focus);
              else setCenter({ x: W / 2, y: H / 2 });
              userPanned.current = false;
            }}
            title={focus ? 'Recenter on unit' : 'Recenter map'}
            aria-label="Recenter map"
          >
            <Icon name="crosshair" size={12} />
          </button>
          <button
            type="button"
            className="map-cam-hbtn"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Compact view' : 'Enlarge view'}
            aria-label={expanded ? 'Compact view' : 'Enlarge view'}
          >
            <Icon name={expanded ? 'collapse' : 'expand'} size={12} />
          </button>
          <button
            type="button"
            className="map-cam-hbtn"
            onClick={() => {
              setClosed(true);
              onClose?.();
            }}
            title="Close mirror"
            aria-label="Close mirror"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      </div>

      {/* 2. Battlefield SVG Viewport: Drag to pan inside, wheel/pinch to zoom */}
      <div className="map-cam-viewport">
        <svg
          className={`map-cam-svg ${panning ? 'panning' : ''}`}
          viewBox={`${vx} ${vy} ${curVw} ${curVh}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          onPointerDown={onMapPointerDown}
          onPointerMove={onMapPointerMove}
          onPointerUp={onMapPointerUp}
          onPointerCancel={onMapPointerUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onWheel={onMapWheel}
          onDoubleClick={onMapDoubleClick}
        >
          <use href="#board-live" />
        </svg>
      </div>
    </div>
  );
}
