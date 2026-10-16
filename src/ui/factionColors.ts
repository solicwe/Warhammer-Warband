// Universal dynamic faction color system for Warhammer 40k.
// Replaces hardcoded Blue vs Red across the entire game board, panels, scoreboards, and unit aura rings.
import type { GameState, PlayerId, UnitState } from '../engine/types';

export interface FactionTheme {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  soft: string;
  glow: string;
}

const FACTION_THEMES: Record<string, FactionTheme> = {
  // Adeptus Custodes: Auramite Gold
  AC: {
    id: 'AC',
    name: 'Adeptus Custodes',
    primary: '#eab308',
    secondary: '#fef08a',
    soft: 'rgba(234, 179, 8, 0.18)',
    glow: 'rgba(234, 179, 8, 0.6)',
  },
  // Adeptus Mechanicus: Martian Crimson
  AdM: {
    id: 'AdM',
    name: 'Adeptus Mechanicus',
    primary: '#dc2626',
    secondary: '#f87171',
    soft: 'rgba(220, 38, 38, 0.18)',
    glow: 'rgba(220, 38, 38, 0.6)',
  },
  // Aeldari: Craftworld Amber & Star Cyan
  AE: {
    id: 'AE',
    name: 'Aeldari',
    primary: '#f59e0b',
    secondary: '#38bdf8',
    soft: 'rgba(245, 158, 11, 0.18)',
    glow: 'rgba(245, 158, 11, 0.6)',
  },
  // Astra Militarum: Cadian Olive Green
  AM: {
    id: 'AM',
    name: 'Astra Militarum',
    primary: '#65a30d',
    secondary: '#a3e635',
    soft: 'rgba(101, 163, 13, 0.18)',
    glow: 'rgba(101, 163, 13, 0.6)',
  },
  // Imperial Agents: Inquisitorial Amber & Gold
  AoI: {
    id: 'AoI',
    name: 'Imperial Agents',
    primary: '#d97706',
    secondary: '#fbbf24',
    soft: 'rgba(217, 119, 6, 0.18)',
    glow: 'rgba(217, 119, 6, 0.6)',
  },
  // Adepta Sororitas: Order Ruby Crimson
  AS: {
    id: 'AS',
    name: 'Adepta Sororitas',
    primary: '#be123c',
    secondary: '#fda4af',
    soft: 'rgba(190, 18, 60, 0.18)',
    glow: 'rgba(190, 18, 60, 0.6)',
  },
  // Chaos Daemons: Warp Magenta
  CD: {
    id: 'CD',
    name: 'Chaos Daemons',
    primary: '#c026d3',
    secondary: '#f0abfc',
    soft: 'rgba(192, 38, 211, 0.18)',
    glow: 'rgba(192, 38, 211, 0.6)',
  },
  // Chaos Space Marines: Heretic Crimson & Brass
  CSM: {
    id: 'CSM',
    name: 'Chaos Space Marines',
    primary: '#b91c1c',
    secondary: '#f59e0b',
    soft: 'rgba(185, 28, 28, 0.18)',
    glow: 'rgba(185, 28, 28, 0.6)',
  },
  // Death Guard: Rusting Plague Green
  DG: {
    id: 'DG',
    name: 'Death Guard',
    primary: '#4d7c0f',
    secondary: '#84cc16',
    soft: 'rgba(77, 124, 15, 0.18)',
    glow: 'rgba(77, 124, 15, 0.6)',
  },
  // Drukhari: Commorrite Poison Teal
  DRU: {
    id: 'DRU',
    name: 'Drukhari',
    primary: '#0d9488',
    secondary: '#2dd4bf',
    soft: 'rgba(13, 148, 136, 0.18)',
    glow: 'rgba(13, 148, 136, 0.6)',
  },
  // Emperor's Children: Slaanesh Shocking Violet
  EC: {
    id: 'EC',
    name: 'Emperor’s Children',
    primary: '#db2777',
    secondary: '#f472b6',
    soft: 'rgba(219, 39, 119, 0.18)',
    glow: 'rgba(219, 39, 119, 0.6)',
  },
  // Genestealer Cults: Industrial Amber & Purple
  GC: {
    id: 'GC',
    name: 'Genestealer Cults',
    primary: '#d97706',
    secondary: '#a855f7',
    soft: 'rgba(217, 119, 6, 0.18)',
    glow: 'rgba(217, 119, 6, 0.6)',
  },
  // Grey Knights: Aegis Silver & Pale Blue
  GK: {
    id: 'GK',
    name: 'Grey Knights',
    primary: '#38bdf8',
    secondary: '#e2e8f0',
    soft: 'rgba(56, 189, 248, 0.18)',
    glow: 'rgba(56, 189, 248, 0.6)',
  },
  // Leagues of Votann: Hearth Bronze & Cyan
  LoV: {
    id: 'LoV',
    name: 'Leagues of Votann',
    primary: '#ea580c',
    secondary: '#38bdf8',
    soft: 'rgba(234, 88, 12, 0.18)',
    glow: 'rgba(234, 88, 12, 0.6)',
  },
  // Necrons: Gauss Emerald Green
  NEC: {
    id: 'NEC',
    name: 'Necrons',
    primary: '#10b981',
    secondary: '#34d399',
    soft: 'rgba(16, 185, 129, 0.18)',
    glow: 'rgba(16, 185, 129, 0.6)',
  },
  // Orks: Waaagh Green
  ORK: {
    id: 'ORK',
    name: 'Orks',
    primary: '#16a34a',
    secondary: '#4ade80',
    soft: 'rgba(22, 163, 74, 0.18)',
    glow: 'rgba(22, 163, 74, 0.6)',
  },
  // Imperial Knights: Chivalric Cobalt Blue
  QI: {
    id: 'QI',
    name: 'Imperial Knights',
    primary: '#2563eb',
    secondary: '#fbbf24',
    soft: 'rgba(37, 99, 235, 0.18)',
    glow: 'rgba(37, 99, 235, 0.6)',
  },
  // Chaos Knights: Dread Copper
  QT: {
    id: 'QT',
    name: 'Chaos Knights',
    primary: '#b45309',
    secondary: '#f97316',
    soft: 'rgba(180, 83, 9, 0.18)',
    glow: 'rgba(180, 83, 9, 0.6)',
  },
  // Space Marines: Ultramarine Cobalt Blue
  SM: {
    id: 'SM',
    name: 'Space Marines',
    primary: '#2563eb',
    secondary: '#60a5fa',
    soft: 'rgba(37, 99, 235, 0.18)',
    glow: 'rgba(37, 99, 235, 0.6)',
  },
  // T'au Empire: Sept Ochre
  TAU: {
    id: 'TAU',
    name: 'T’au Empire',
    primary: '#f59e0b',
    secondary: '#06b6d4',
    soft: 'rgba(245, 158, 11, 0.18)',
    glow: 'rgba(245, 158, 11, 0.6)',
  },
  // Adeptus Titanicus: God-Engine Gold
  TL: {
    id: 'TL',
    name: 'Adeptus Titanicus',
    primary: '#ca8a04',
    secondary: '#facc15',
    soft: 'rgba(202, 138, 4, 0.18)',
    glow: 'rgba(202, 138, 4, 0.6)',
  },
  // Thousand Sons: Arcane Turquoise & Gold
  TS: {
    id: 'TS',
    name: 'Thousand Sons',
    primary: '#06b6d4',
    secondary: '#f59e0b',
    soft: 'rgba(6, 182, 212, 0.18)',
    glow: 'rgba(6, 182, 212, 0.6)',
  },
  // Tyranids: Hive Chitin Purple
  TYR: {
    id: 'TYR',
    name: 'Tyranids',
    primary: '#9333ea',
    secondary: '#e879f9',
    soft: 'rgba(147, 51, 234, 0.18)',
    glow: 'rgba(147, 51, 234, 0.6)',
  },
  // Unbound Adversaries: Void Indigo
  UA: {
    id: 'UA',
    name: 'Unbound Adversaries',
    primary: '#6366f1',
    secondary: '#a5b4fc',
    soft: 'rgba(99, 102, 241, 0.18)',
    glow: 'rgba(99, 102, 241, 0.6)',
  },
  // World Eaters: Blood Red & Brass
  WE: {
    id: 'WE',
    name: 'World Eaters',
    primary: '#b91c1c',
    secondary: '#ef4444',
    soft: 'rgba(185, 28, 28, 0.18)',
    glow: 'rgba(185, 28, 28, 0.6)',
  },
};

// Subfaction Chapter Overrides for Space Marines
const SUBFACTION_THEMES: Record<string, Partial<FactionTheme>> = {
  'BLOOD ANGELS': {
    primary: '#dc2626',
    secondary: '#f87171',
    soft: 'rgba(220, 38, 38, 0.18)',
    glow: 'rgba(220, 38, 38, 0.6)',
  },
  'DARK ANGELS': {
    primary: '#15803d',
    secondary: '#4ade80',
    soft: 'rgba(21, 128, 61, 0.18)',
    glow: 'rgba(21, 128, 61, 0.6)',
  },
  'SPACE WOLVES': {
    primary: '#0ea5e9',
    secondary: '#7dd3fc',
    soft: 'rgba(14, 165, 233, 0.18)',
    glow: 'rgba(14, 165, 233, 0.6)',
  },
  'BLACK TEMPLARS': {
    primary: '#e2e8f0',
    secondary: '#cbd5e1',
    soft: 'rgba(226, 232, 240, 0.18)',
    glow: 'rgba(226, 232, 240, 0.6)',
  },
  'SALAMANDERS': {
    primary: '#059669',
    secondary: '#34d399',
    soft: 'rgba(5, 150, 105, 0.18)',
    glow: 'rgba(5, 150, 105, 0.6)',
  },
  'IMPERIAL FISTS': {
    primary: '#eab308',
    secondary: '#fef08a',
    soft: 'rgba(234, 179, 8, 0.18)',
    glow: 'rgba(234, 179, 8, 0.6)',
  },
  'WHITE SCARS': {
    primary: '#ef4444',
    secondary: '#f8fafc',
    soft: 'rgba(239, 68, 68, 0.18)',
    glow: 'rgba(239, 68, 68, 0.6)',
  },
  'IRON HANDS': {
    primary: '#64748b',
    secondary: '#94a3b8',
    soft: 'rgba(100, 116, 139, 0.18)',
    glow: 'rgba(100, 116, 139, 0.6)',
  },
  'RAVEN GUARD': {
    primary: '#475569',
    secondary: '#cbd5e1',
    soft: 'rgba(71, 85, 105, 0.18)',
    glow: 'rgba(71, 85, 105, 0.6)',
  },
  'DEATHWATCH': {
    primary: '#94a3b8',
    secondary: '#f59e0b',
    soft: 'rgba(148, 163, 184, 0.18)',
    glow: 'rgba(148, 163, 184, 0.6)',
  },
};

// High-contrast alternate themes for mirror matches (e.g. SM vs SM or ORK vs ORK)
const ALTERNATE_THEMES: Record<string, FactionTheme> = {
  SM: {
    id: 'SM_ALT',
    name: 'Space Marines (Successor)',
    primary: '#f59e0b',
    secondary: '#fbbf24',
    soft: 'rgba(245, 158, 11, 0.18)',
    glow: 'rgba(245, 158, 11, 0.6)',
  },
  ORK: {
    id: 'ORK_ALT',
    name: 'Orks (Bad Moons)',
    primary: '#eab308',
    secondary: '#facc15',
    soft: 'rgba(234, 179, 8, 0.18)',
    glow: 'rgba(234, 179, 8, 0.6)',
  },
  TS: {
    id: 'TS_ALT',
    name: 'Thousand Sons (Changehost)',
    primary: '#a855f7',
    secondary: '#c084fc',
    soft: 'rgba(168, 85, 247, 0.18)',
    glow: 'rgba(168, 85, 247, 0.6)',
  },
  NEC: {
    id: 'NEC_ALT',
    name: 'Necrons (Mephrit Solar)',
    primary: '#f97316',
    secondary: '#fb923c',
    soft: 'rgba(249, 115, 22, 0.18)',
    glow: 'rgba(249, 115, 22, 0.6)',
  },
  TYR: {
    id: 'TYR_ALT',
    name: 'Tyranids (Hive Fleet Kraken)',
    primary: '#e11d48',
    secondary: '#fb7185',
    soft: 'rgba(225, 29, 72, 0.18)',
    glow: 'rgba(225, 29, 72, 0.6)',
  },
  CSM: {
    id: 'CSM_ALT',
    name: 'Chaos Space Marines (Iron)',
    primary: '#64748b',
    secondary: '#f59e0b',
    soft: 'rgba(100, 116, 139, 0.18)',
    glow: 'rgba(100, 116, 139, 0.6)',
  },
  WE: {
    id: 'WE_ALT',
    name: 'World Eaters (Brass)',
    primary: '#d97706',
    secondary: '#f59e0b',
    soft: 'rgba(217, 119, 6, 0.18)',
    glow: 'rgba(217, 119, 6, 0.6)',
  },
  defaultAlt: {
    id: 'ALT',
    name: 'Opposing Force',
    primary: '#f43f5e',
    secondary: '#fda4af',
    soft: 'rgba(244, 63, 94, 0.18)',
    glow: 'rgba(244, 63, 94, 0.6)',
  },
};

export function getFactionTheme(factionId?: string, subfaction?: string, isAlternate?: boolean): FactionTheme {
  const base = FACTION_THEMES[factionId ?? ''] ?? {
    id: 'UNKNOWN',
    name: 'Warhammer 40k',
    primary: '#d99b26',
    secondary: '#fbbf24',
    soft: 'rgba(217, 155, 38, 0.18)',
    glow: 'rgba(217, 155, 38, 0.6)',
  };

  if (isAlternate) {
    return ALTERNATE_THEMES[factionId ?? ''] ?? ALTERNATE_THEMES.defaultAlt;
  }

  if (subfaction && SUBFACTION_THEMES[subfaction.toUpperCase()]) {
    return { ...base, ...SUBFACTION_THEMES[subfaction.toUpperCase()] };
  }

  return base;
}

/** Get the dynamic faction theme for Player 0 or Player 1 in the current game state. */
export function getPlayerFactionTheme(s: GameState, p: PlayerId): FactionTheme {
  const P = s.players[p];
  if (!P) {
    return p === 0 ? getFactionTheme('SM') : getFactionTheme('ORK');
  }

  const p0 = s.players[0];
  const p1 = s.players[1];

  // In mirror matches (same faction and same primary color), provide Player 1 with a high-contrast alternate theme
  const isMirror = p === 1 && p0 && p1 && p0.factionId === p1.factionId;
  return getFactionTheme(P.factionId, P.subfaction, isMirror);
}

/** Get the faction theme for a specific unit based on its owning player and keywords. */
export function getUnitFactionTheme(s: GameState, u: UnitState): FactionTheme {
  return getPlayerFactionTheme(s, u.owner);
}

