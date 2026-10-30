// The game's own line icons (24×24, drawn with the current text colour). No emoji, no image files:
// every icon is a few SVG strokes, so it stays sharp at any size and follows the theme.
import type { ReactNode } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
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
  fight: <><path {...S} d="M3.5 3.5l3.2.7 9 9-2.5 2.5-9-9z" /><path {...S} d="M20.5 3.5l-3.2.7-9 9 2.5 2.5 9-9z" /><path {...S} d="M12.3 17.3l5-5M6.7 12.3l5 5" /><path {...S} d="M16.2 16.2l3 3M7.8 16.2l-3 3" /><circle {...F} cx="19.8" cy="19.8" r="1.2" /><circle {...F} cx="4.2" cy="19.8" r="1.2" /></>,
  dice: <><rect {...S} x="4" y="4" width="16" height="16" rx="3.5" /><circle {...F} cx="9" cy="9" r="1.5" /><circle {...F} cx="15" cy="15" r="1.5" /><circle {...F} cx="12" cy="12" r="1.5" /></>,
  reroll: <><path {...S} d="M20 12a8 8 0 1 1-2.3-5.6" /><path {...S} d="M20 4v5h-5" /></>,
  skull: <><path {...S} d="M6 10.5a6 6 0 0 1 12 0v3l-1.6 1.1V18H7.6v-3.4L6 13.5z" /><path {...F} d="M8.3 11h2.9l-.5 2.3H8.6zM12.8 11h2.9l-.3 2.3h-2.1z" /><path {...F} d="M12 14.4l.9 1.4h-1.8z" /><path {...S} d="M10.2 18v-1.6M13.8 18v-1.6" /></>,
  shock: <><path {...S} d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /><path {...S} d="M12.6 5.5l-1.8 4 2.6 2-2.4 3.6 1 3" /></>,
  // things on the table
  objective: <><ellipse {...S} cx="12" cy="18.5" rx="7.5" ry="2.6" /><path {...S} d="M10 18.5V3.5" /><path {...S} d="M10 4h8.5l-2.2 3 2.2 3H10" /></>,
  transport: <><path {...S} d="M3.5 14.5l1.5-4h5.5l1.5-3h5l1 3h2.5l.5 4" /><rect {...S} x="2.5" y="14.5" width="19" height="5" rx="2.5" /><circle {...F} cx="7" cy="17" r="1.1" /><circle {...F} cx="12" cy="17" r="1.1" /><circle {...F} cx="17" cy="17" r="1.1" /></>,
  reserves: <><ellipse {...S} cx="12" cy="18.5" rx="8" ry="2.5" strokeDasharray="2 2" /><path {...S} d="M12 3v11.5" /><path {...S} d="M8 10.5l4 4 4-4" /></>,
  ruler: <><rect {...S} x="2" y="8" width="20" height="8" rx="1.5" /><path {...S} d="M6 8v3M10 8v4M14 8v3M18 8v4" /></>,
  // army builder
  leader: <><path {...S} d="M4 17L3 7.5l5 3.5 4-7 4 7 5-3.5-1 9.5z" /><path {...S} d="M4.5 20.5h15" /><circle {...F} cx="12" cy="13.5" r="1.4" /></>,
  embark: <><path {...S} d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" /><path {...S} d="M3 12h11M10 8l4 4-4 4" /></>,
  size: <><path {...S} d="M9 10.5V8.8a3 3 0 0 1 6 0v1.7l-1 1h-4z" /><path {...S} d="M3 10.8V9.5a2.6 2.6 0 0 1 5.2 0v1.3l-.9.8H3.9zM15.8 10.8V9.5a2.6 2.6 0 0 1 5.2 0v1.3l-.9.8h-3.4z" /><path {...S} d="M7 20c0-3.5 2.2-5.5 5-5.5s5 2 5 5.5M2.5 19c0-2.6 1.4-4.2 3.1-4.2M21.5 19c0-2.6-1.4-4.2-3.1-4.2" /></>,
  duplicate: <><rect {...S} x="8" y="8" width="12" height="12" rx="2" /><path {...S} d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  delete: <><circle {...S} cx="12" cy="12" r="9" /><path {...S} d="M9 9l6 6M15 9l-6 6" /></>,
  gear: <><circle {...S} cx="12" cy="12" r="3.2" /><path {...S} d="M12 2.5l1.6 2.6 3-.8.6 3 2.8 1.4-1.4 2.8 1.4 2.8-2.8 1.4-.6 3-3-.8L12 21.5l-1.6-2.6-3 .8-.6-3-2.8-1.4 1.4-2.8-1.4-2.8 2.8-1.4.6-3 3 .8z" /></>,
  leave: <><circle {...S} cx="12" cy="12" r="9" /><path {...S} d="M7.5 12h9" /></>,
  wargear: <><path {...S} d="M2.5 10.5h15v3h-4.2l-1.5 5.5H8.6l1.2-5.5H2.5z" /><path {...S} d="M17.5 11.6h4M5.5 10.5V9h3.5v1.5" /></>,
  enhancement: <><path {...S} d="M12 5.5l3 4.5-3 7-3-7z" /><path {...S} d="M9 9.5C6.5 8.5 4.5 9.5 2.5 7.5c.8 3 3 5.2 6.8 5.2M15 9.5c2.5-1 4.5 0 6.5-2-.8 3-3 5.2-6.8 5.2" /><path {...S} d="M12 19.5v1.5" /></>,
  // general
  ability: <><path {...S} d="M12 3.5l6.5 8.5-6.5 8.5L5.5 12z" /><path {...S} d="M12 8v8M9.3 12h5.4" /><path {...S} d="M12 1.5v1M12 21.5v1M2 12h1.5M20.5 12H22" /></>,
  bot: <><path {...S} d="M7 11a5 5 0 0 1 10 0v2.5l-1.2.9v1.8H8.2v-1.8L7 13.5z" /><circle {...F} cx="9.9" cy="11.3" r="1.25" /><circle {...F} cx="14.1" cy="11.3" r="1.25" /><path {...S} d="M7 9.5H3.5V13M17 9.5h3.5V13M12 16.2V19M9.5 21h5" /></>,
  camera: <><path {...S} d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle {...S} cx="12" cy="13" r="3.5" /></>,
  cloud: <><path {...S} d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5" /><path {...S} d="M12 21v-8M9 16l3-3 3 3" /></>,
  download: <><path {...S} d="M12 4v11M7 10l5 5 5-5" /><path {...S} d="M4 19h16" /></>,
  upload: <><path {...S} d="M12 15V4M7 9l5-5 5 5" /><path {...S} d="M4 19h16" /></>,
  clean: <><path {...S} d="M14 3l-5 9" /><path {...S} d="M6 12h6l2 9H4z" /><path {...S} d="M7 16v5M10 16v5" /></>,
  check: <path {...S} d="M4 12.5l5 5L20 6.5" />,
  partial: <><circle {...S} cx="12" cy="12" r="8" /><path {...F} d="M12 4a8 8 0 0 1 0 16z" /></>,
  hand: <><path {...S} d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10V5.5a1.5 1.5 0 0 1 3 0V13" /><path {...S} d="M17 10a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.5-2.7L4 15a1.6 1.6 0 0 1 2.5-2L8 14.5" /></>,
  next: <path {...S} d="M9 5l7 7-7 7" />,
  back: <path {...S} d="M15 5l-7 7 7 7" />,
  close: <path {...S} d="M6 6l12 12M18 6L6 18" />,
  // an attack: from the shooter to its target
  target: <><path {...S} d="M3 12h12" /><path {...S} d="M11 7l5 5-5 5" /><circle {...S} cx="19.5" cy="12" r="2" /></>,
  // a ritual or psychic mark on a unit
  mark: <><path {...S} d="M12 3c1.5 4 3 5.5 7 7-4 1.5-5.5 3-7 7-1.5-4-3-5.5-7-7 4-1.5 5.5-3 7-7z" /></>,
  sound: <><path {...S} d="M4 9h4l5-4v14l-5-4H4z" /><path {...S} d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  mute: <><path {...S} d="M4 9h4l5-4v14l-5-4H4z" /><path {...S} d="M17 9l5 6M22 9l-5 6" /></>,
  down: <path {...S} d="M6 9l6 6 6-6" />,
  plus: <path {...S} d="M12 5v14M5 12h14" />,
  more: <><circle {...F} cx="12" cy="5" r="2" /><circle {...F} cx="12" cy="12" r="2" /><circle {...F} cx="12" cy="19" r="2" /></>,
  menu: <path {...S} d="M4 7h16M4 12h16M4 17h16" />,
  hint: <><circle {...S} cx="12" cy="12" r="9" /><path {...S} d="M10 8l4 4-4 4" /></>,
  undo: <><path {...S} d="M9 14L4 9l5-5" /><path {...S} d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  wait: <><circle {...S} cx="12" cy="12" r="9" /><path {...S} d="M12 7v5l3 2" /></>,
  search: <><circle {...S} cx="11" cy="11" r="7" /><path {...S} d="M21 21l-5-5" /></>,
  trophy: <><path {...S} d="M8 4h8v5a4 4 0 0 1-8 0z" /><path {...S} d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8" /></>,
  // the hand of Secondary Mission cards, and Stratagems (spent from Command points)
  cards: <><rect {...S} x="8" y="3" width="12" height="16" rx="2" /><path {...S} d="M5 6.5V19a2 2 0 0 0 2 2h9" /></>,
  strat: <><path {...S} d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" /><path {...S} d="M13 7.5l-3.5 5h3l-1 4 3.5-5h-3z" /></>,
  // tactical markers & army rules (replacing emojis)
  bullhorn: <><path {...S} d="M3 11v2a1 1 0 0 0 1 1h3l7 4V6l-7 4H4a1 1 0 0 0-1 1z" /><path {...S} d="M17 9a4 4 0 0 1 0 6" /><path {...S} d="M7 14v4a1 1 0 0 0 1 1h1" /></>,
  crosshair: <><circle {...S} cx="12" cy="12" r="7" /><path {...S} d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle {...F} cx="12" cy="12" r="1.5" /></>,
  radar: <><path {...S} d="M12 20a8 8 0 1 0-8-8" /><path {...S} d="M12 16a4 4 0 1 0-4-4" /><circle {...F} cx="12" cy="12" r="1.5" /><path {...S} d="M12 12L18 6" /></>,
  zap: <path {...S} d="M13 2L4 14h7v8l9-12h-7z" />,
  sparkles: <><path {...S} d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><path {...S} d="M19 17l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /></>,
  fate: <><polygon {...S} points="12 2 20 7 20 17 12 22 4 17 4 7" /><circle {...F} cx="12" cy="12" r="2.5" /></>,
  heal: <><path {...S} d="M12 5v14M5 12h14" /><rect {...S} x="2" y="2" width="20" height="20" rx="4" /></>,
  shop: <><path {...S} d="M3 9l2-5h14l2 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path {...S} d="M3 9h18M9 13a3 3 0 0 0 6 0" /></>,
  swords: <><path {...S} d="M14.5 17.5L3 6V3h3l11.5 11.5" /><path {...S} d="M13 19l6-6M16 16l4 4" /><path {...S} d="M9.5 17.5L21 6V3h-3L6.5 14.5" /><path {...S} d="M11 19l-6-6M8 16l-4 4" /></>,
  shield: <path {...S} d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />,
  stealth: <><path {...S} d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle {...S} cx="12" cy="12" r="3" strokeDasharray="2 1.5" /></>,
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

/** Warhammer Warband's mark: a power-armoured helm (blue dome, red crest stripe with a skull, eye slits, grilled faceplate, breather tubes). `tile` draws it on its dark app-icon square. */
export function Logo({ size = 28, tile = false }: { size?: number; tile?: boolean }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {tile && <rect width="64" height="64" rx="14" fill="#16191d" />}
      <rect x="5" y="33" width="9" height="15" rx="3.5" fill="#7d838b" /><rect x="50" y="33" width="9" height="15" rx="3.5" fill="#7d838b" /><path d="M12 33C12 16 20.5 6.5 32 6.5S52 16 52 33v10l-5 8H17l-5-8z" fill="#2f5597" /><path d="M24.6 7.6Q32 5.4 39.4 7.6L38.6 25H25.4z" fill="#e8e6e1" /><path d="M27 7Q32 5.9 37 7L36.4 25h-8.8z" fill="#c8302a" /><circle cx="32" cy="16.5" r="3.6" fill="#c9cdd2" /><rect x="29.6" y="18.6" width="4.8" height="3.2" rx="1" fill="#c9cdd2" /><circle cx="30.6" cy="16.3" r="1" fill="#2a2d31" /><circle cx="33.4" cy="16.3" r="1" fill="#2a2d31" /><path d="M14.5 27.5l13.5 3.6-1.2 5.4-10.8-2.4z" fill="#0d1014" /><path d="M49.5 27.5L36 31.1l1.2 5.4 10.8-2.4z" fill="#0d1014" /><path d="M22.5 33.5h19l2.5 11-5 9.5H25l-5-9.5z" fill="#3a63a8" /><path d="M24.6 38.5l4.6 2.2M24.2 42.6l4.6 2.2M24.8 46.7l4.2 2M39.4 38.5l-4.6 2.2M39.8 42.6l-4.6 2.2M39.2 46.7l-4.2 2" stroke="#0d1014" strokeWidth="2" strokeLinecap="round" /><rect x="11" y="45" width="9" height="10" rx="3" fill="#6b7178" /><rect x="44" y="45" width="9" height="10" rx="3" fill="#6b7178" /><path d="M13.2 46.5v7M15.5 46.5v7M17.8 46.5v7M46.2 46.5v7M48.5 46.5v7M50.8 46.5v7" stroke="#474c52" strokeWidth="1.1" />
    </svg>
  );
}
