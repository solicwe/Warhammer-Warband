import { useEffect, useRef, useState } from 'react';
import { alive } from '../engine/state';
import type { GameState, Pt, UnitState } from '../engine/types';
import { Icon } from './Icon';

/** Where the live map looks: the unit picked (or being moved) when it stands on the table; null for the whole board. */
export function camFocus(picked: UnitState | null): Pt | null {
  const ms = picked && picked.status === 'board' ? alive(picked) : [];
  return ms.length ? { x: ms.reduce((a, m) => a + m.x, 0) / ms.length, y: ms.reduce((a, m) => a + m.y, 0) / ms.length } : null;
}

const VIEW = 20; // base inches across when focused on a unit

/**
 * Phone & Desktop PiP Mirror: a live view of the battlefield while a sheet hides it (or on demand).
 * Mirrors the board itself (an SVG <use>), so it costs no extra rendering of units.
 * Features:
 *  - Zoom inside the mirror: buttons (+, -, cycle), mouse wheel, and pinch-to-zoom!
 *  - Pan inside the mirror: drag the battlefield to look around.
 *  - Recenter on active unit with crosshair button.
 *  - Move the window by dragging the header bar.
 *  - Enlarge / compact window toggle (180px <-> 280px).
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
  const focusRef = useRef(focus);
  focusRef.current = focus;

  // Window drag ref
  const dragWindow = useRef<{ id: number; dx: number; dy: number } | null>(null);

  // In-map pointer tracking for pan & pinch-zoom
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartZoom = useRef<number>(1);
  const panStart = useRef<{ clientX: number; clientY: number; center: Pt } | null>(null);

  // When focus prop changes (user selected another unit), update center if user hasn't locked their own pan
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

        // Show if field is obscured by sheet/tray, or if drawer covers >94%
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
  const baseVw = focus ? VIEW : W + 2;
  const baseVh = focus ? VIEW * 0.75 : H + 2;
  const curVw = baseVw / zoom;
  const curVh = baseVh / zoom;

  // Clamp camera position within battlefield bounds (+/- small margin)
  const minX = -2;
  const maxX = W + 2 - curVw;
  const vx = maxX >= minX ? Math.max(minX, Math.min(maxX, center.x - curVw / 2)) : (W - curVw) / 2;

  const minY = -2;
  const maxY = H + 2 - curVh;
  const vy = maxY >= minY ? Math.max(minY, Math.min(maxY, center.y - curVh / 2)) : (H - curVh) / 2;

  // Zoom helpers
  const handleZoomIn = () => {
    setZoom((z) => Math.min(5.0, Number((z * 1.3).toFixed(2))));
    userPanned.current = true;
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(0.6, Number((z / 1.3).toFixed(2))));
    userPanned.current = true;
  };

  const handleCycleZoom = () => {
    setZoom((z) => {
      if (z < 1.4) return 2.0;
      if (z < 2.5) return 3.5;
      return 1.0;
    });
    userPanned.current = true;
  };

  const handleRecenter = () => {
    if (focus) setCenter(focus);
    else setCenter({ x: W / 2, y: H / 2 });
    userPanned.current = false;
  };

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

  // SVG Pan & Pinch-Zoom handlers
  const onMapPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      panStart.current = { clientX: e.clientX, clientY: e.clientY, center: { ...center } };
      setPanning(true);
    } else if (activePointers.current.size === 2) {
      const pts = [...activePointers.current.values()];
      pinchStartDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartZoom.current = zoom;
      panStart.current = null;
    }
  };

  const onMapPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2 && pinchStartDist.current) {
      // Pinch to zoom
      const pts = [...activePointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const scale = dist / pinchStartDist.current;
      const nextZoom = Math.min(5.0, Math.max(0.6, pinchStartZoom.current * scale));
      setZoom(Number(nextZoom.toFixed(2)));
      userPanned.current = true;
    } else if (activePointers.current.size === 1 && panStart.current) {
      // Pan camera
      const rect = e.currentTarget.getBoundingClientRect();
      const dxPixels = e.clientX - panStart.current.clientX;
      const dyPixels = e.clientY - panStart.current.clientY;
      const inchesPerPixelX = curVw / Math.max(1, rect.width);
      const inchesPerPixelY = curVh / Math.max(1, rect.height);

      setCenter({
        x: panStart.current.center.x - dxPixels * inchesPerPixelX,
        y: panStart.current.center.y - dyPixels * inchesPerPixelY,
      });
      userPanned.current = true;
    }
  };

  const onMapPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      pinchStartDist.current = null;
    }
    if (activePointers.current.size === 0) {
      panStart.current = null;
      setPanning(false);
    }
  };

  const onMapWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    setZoom((z) => Math.min(5.0, Math.max(0.6, Number((z * factor).toFixed(2)))));
    userPanned.current = true;
  };

  const onMapDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    setZoom((z) => (z > 1.4 ? 1.0 : 2.5));
    userPanned.current = true;
  };

  return (
    <div
      className={`map-cam ${expanded ? 'expanded' : ''}`}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto' } : { top }}
      role="region"
      aria-label="Live Mirror Battlefield View"
    >
      {/* Header bar: drag to move window, resize toggle, close button */}
      <div
        className="map-cam-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        title="Drag header to move window"
      >
        <div className="map-cam-title-wrap">
          <span className="map-cam-dot" aria-hidden="true" />
          <Icon name="camera" size={12} />
          <span>MIRROR</span>
        </div>
        <div className="map-cam-header-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button
            className="map-cam-hbtn"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Compact view' : 'Enlarge view'}
            aria-label={expanded ? 'Compact view' : 'Enlarge view'}
          >
            <Icon name={expanded ? 'collapse' : 'expand'} size={13} />
          </button>
          <button
            className="map-cam-hbtn"
            onClick={() => {
              setClosed(true);
              onClose?.();
            }}
            title="Close mirror"
            aria-label="Close mirror"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      </div>

      {/* Battlefield SVG Viewport: drag to pan, wheel/pinch to zoom, double tap to toggle */}
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
          onWheel={onMapWheel}
          onDoubleClick={onMapDoubleClick}
        >
          <use href="#board-live" />
        </svg>

        {/* Floating Zoom & Pan Controls Pill */}
        <div className="map-cam-controls">
          <div className="map-cam-zoom-pill" role="toolbar" aria-label="Mirror zoom controls">
            <button
              className="map-cam-zbtn"
              onClick={handleZoomOut}
              title="Zoom out (−)"
              aria-label="Zoom out"
              disabled={zoom <= 0.65}
            >
              <Icon name="minus" size={13} />
            </button>
            <button
              className="map-cam-zlvl"
              onClick={handleCycleZoom}
              title="Click to cycle zoom presets (1x, 2x, 3.5x)"
              aria-label={`Current zoom: ${zoom.toFixed(1)}x. Click to cycle.`}
            >
              {zoom.toFixed(1)}×
            </button>
            <button
              className="map-cam-zbtn"
              onClick={handleZoomIn}
              title="Zoom in (+)"
              aria-label="Zoom in"
              disabled={zoom >= 4.9}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>

          <button
            className="map-cam-target-btn"
            onClick={handleRecenter}
            title={focus ? 'Recenter on active unit' : 'Recenter to center of board'}
            aria-label="Recenter map"
          >
            <Icon name="crosshair" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
