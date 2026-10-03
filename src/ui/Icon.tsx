// The game's own line icons (24×24, drawn with the current text colour). No emoji, no image files:
// every icon is a few SVG strokes, so it stays sharp at any size and follows the theme.
import type { ReactNode } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const F = { fill: 'currentColor', stroke: 'none' } as const;

const ICONS = {
  // movement
  move: <><path {...S} d="M4 12h13" /><path {...S} d="M12 6l6 6-6 6" /><path {...S} d="M3 7h4M3 17h4" /></>,
  advance: <><path {...S} d="M4 6l6 6-6 6" /><path {...S} d="M12 6l6 6-6 6" /><path {...S} d="M20 5v14" /></>,
  fallback: <><path {...S} d="M9 6l-6 6 6 6" /><path {...S} d="M3 12h11a6 6 0 0 1 6 6v1" /></>,
  hold: <><path {...S} d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /><path {...S} d="M9 12h6" /></>,
  // combat
  shoot: <><circle {...S} cx="12" cy="12" r="7" /><circle {...F} cx="12" cy="12" r="1.6" /><path {...S} d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  charge: <path {...S} d="M13 2L5 13h6l-1 9 8-11h-6z" />,
  fight: <><path {...S} d="M4 4h3l10 10M20 4h-3L7 14" /><path {...S} d="M14 17l3-3 3 3M10 17l-3-3-3 3" /><path {...S} d="M17 17l3 3M7 17l-3 3" /></>,
  dice: <><rect {...S} x="4" y="4" width="16" height="16" rx="3.5" /><circle {...F} cx="9" cy="9" r="1.5" /><circle {...F} cx="15" cy="15" r="1.5" /><circle {...F} cx="12" cy="12" r="1.5" /></>,
  reroll: <><path {...S} d="M20 12a8 8 0 1 1-2.3-5.6" /><path {...S} d="M20 4v5h-5" /></>,
  skull: <><path {...S} d="M5 11a7 7 0 1 1 14 0v3l-2 1v3H7v-3l-2-1z" /><circle {...F} cx="9.5" cy="11.5" r="1.6" /><circle {...F} cx="14.5" cy="11.5" r="1.6" /><path {...S} d="M10 18v-2M14 18v-2" /></>,
  shock: <><path {...S} d="M12 3l9 16H3z" /><path {...S} d="M12 9v4" /><circle {...F} cx="12" cy="16.5" r="1.2" /></>,
  // things on the table
  objective: <><circle {...S} cx="12" cy="12" r="8" /><circle {...S} cx="12" cy="12" r="3.5" /></>,
  transport: <><path {...S} d="M2 7h11v9H2zM13 10h4l4 3v3h-8" /><circle {...S} cx="6" cy="17.5" r="1.8" /><circle {...S} cx="17" cy="17.5" r="1.8" /></>,
  reserves: <><path {...S} d="M6 3h12M6 21h12" /><path {...S} d="M8 3v3l4 6 4-6V3M8 21v-3l4-6 4 6v3" /></>,
  ruler: <><rect {...S} x="2" y="8" width="20" height="8" rx="1.5" /><path {...S} d="M6 8v3M10 8v4M14 8v3M18 8v4" /></>,
  // army builder
  leader: <path {...S} d="M3 8l4 4 5-7 5 7 4-4-2 11H5z" />,
  embark: <><path {...S} d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" /><path {...S} d="M3 12h11M10 8l4 4-4 4" /></>,
  size: <><circle {...S} cx="8" cy="9" r="3" /><circle {...S} cx="17" cy="10" r="2.4" /><path {...S} d="M3 20c0-3 2.3-5 5-5s5 2 5 5M14 20c0-2.5 1.4-4 3.2-4S21 17.5 21 20" /></>,
  duplicate: <><rect {...S} x="8" y="8" width="12" height="12" rx="2" /><path {...S} d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  delete: <><circle {...S} cx="12" cy="12" r="9" /><path {...S} d="M9 9l6 6M15 9l-6 6" /></>,
  leave: <><circle {...S} cx="12" cy="12" r="9" /><path {...S} d="M7.5 12h9" /></>,
  wargear: <><path {...S} d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z" /></>,
  enhancement: <path {...S} d="M12 3l2.4 5.6L20 9.3l-4.3 3.9 1.3 6-5-3-5 3 1.3-6L4 9.3l5.6-.7z" />,
  // general
  ability: <path {...S} d="M12 2v6M12 16v6M2 12h6M16 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />,
  bot: <><rect {...S} x="4" y="8" width="16" height="11" rx="3" /><path {...S} d="M12 4v4" /><circle {...F} cx="12" cy="3.5" r="1.5" /><circle {...F} cx="9" cy="13" r="1.6" /><circle {...F} cx="15" cy="13" r="1.6" /><path {...S} d="M2 12v3M22 12v3" /></>,
  camera: <><path {...S} d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle {...S} cx="12" cy="13" r="3.5" /></>,
  cloud: <><path {...S} d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5" /><path {...S} d="M12 21v-8M9 16l3-3 3 3" /></>,
  download: <><path {...S} d="M12 4v11M7 10l5 5 5-5" /><path {...S} d="M4 19h16" /></>,
  upload: <><path {...S} d="M12 15V4M7 9l5-5 5 5" /><path {...S} d="M4 19h16" /></>,
  clean: <><path {...S} d="M14 3l-5 9" /><path {...S} d="M6 12h6l2 9H4z" /><path {...S} d="M7 16v5M10 16v5" /></>,
  check: <path {...S} d="M4 12.5l5 5L20 6.5" />,
  partial: <><circle {...S} cx="12" cy="12" r="8" /><path {...F} d="M12 4a8 8 0 0 1 0 16z" /></>,
  hand: <><path {...S} d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10V5.5a1.5 1.5 0 0 1 3 0V13" /><path {...S} d="M17 10a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.5-2.7L4 15a1.6 1.6 0 0 1 2.5-2L8 14.5" /></>,
  next: <path {...S} d="M9 5l7 7-7 7" />,
  down: <path {...S} d="M6 9l6 6 6-6" />,
  plus: <path {...S} d="M12 5v14M5 12h14" />,
  more: <><circle {...F} cx="12" cy="5" r="2" /><circle {...F} cx="12" cy="12" r="2" /><circle {...F} cx="12" cy="19" r="2" /></>,
  menu: <path {...S} d="M4 7h16M4 12h16M4 17h16" />,
  hint: <><circle {...S} cx="12" cy="12" r="9" /><path {...S} d="M10 8l4 4-4 4" /></>,
  undo: <><path {...S} d="M9 14L4 9l5-5" /><path {...S} d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  wait: <><circle {...S} cx="12" cy="12" r="9" /><path {...S} d="M12 7v5l3 2" /></>,
  trophy: <><path {...S} d="M8 4h8v5a4 4 0 0 1-8 0z" /><path {...S} d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}

/** The same icon placed inside another SVG (the board), centred on (x, y). */
export function SvgIcon({ name, x, y, size, color }: { name: IconName; x: number; y: number; size: number; color?: string }) {
  return (
    <svg x={x - size / 2} y={y - size / 2} width={size} height={size} viewBox="0 0 24 24" style={{ color, overflow: 'visible' }} pointerEvents="none">
      {ICONS[name]}
    </svg>
  );
}
