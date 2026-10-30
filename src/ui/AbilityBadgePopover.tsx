import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ModelState, UnitState, WeaponData, WeaponProfileData } from '../engine/types';

export interface AbilityOrWeaponInfo {
  title: string;
  badgeLabel: string;
  category: {
    label: string;
    variant: 'cp' | 'ranged' | 'melee' | 'ability' | 'buff' | 'special';
  };
  summary: string;
  stats?: {
    range: string;
    a: string;
    skillLabel?: string;
    bs: string;
    s: string;
    ap: string;
    d: string;
  };
  keywords?: string[];
}

/** Known descriptions for key weapons, abilities, and wargear */
const KNOWN_DATA: Record<string, Partial<AbilityOrWeaponInfo>> = {
  'bolt rifle': {
    title: 'Bolt Rifle',
    badgeLabel: 'Bolt Rifle',
    category: { label: 'Ranged Weapon', variant: 'ranged' },
    summary: 'Standard-issue Astartes precision firearm featuring high-velocity mass-reactive bolts capable of punching through ceramite armor.',
    stats: { range: '24"', a: '2', bs: '3+', s: '4', ap: '-1', d: '1' },
    keywords: ['[RAPID FIRE 1]', '[ASSAULT]', '[HEAVY]'],
  },
  'plasma pistol & power fist': {
    title: 'Plasma Pistol & Power Fist',
    badgeLabel: 'Plasma Pistol & Power Fist',
    category: { label: 'Dual Loadout', variant: 'special' },
    summary: 'Deadly dual loadout pairing superheated plasma energy with devastating close-quarters crushing power.',
    stats: { range: '12" / Melee', a: '1 / 4', skillLabel: 'BS/WS', bs: '3+', s: '7 / 8', ap: '-2 / -2', d: '1 / 2' },
    keywords: ['[PISTOL]', '[HAZARDOUS]'],
  },
  'grenade launcher': {
    title: 'Astartes Grenade Launcher',
    badgeLabel: 'Grenade Launcher',
    category: { label: 'Ranged Weapon', variant: 'ranged' },
    summary: 'Versatile auxiliary launcher firing either high-explosive Frag rounds against swarms or high-impact Krak rounds against armored foes.',
    stats: { range: '24"', a: 'D3', bs: '3+', s: '9', ap: '-2', d: 'D3' },
    keywords: ['[BLAST]'],
  },
  'astartes grenade launcher': {
    title: 'Astartes Grenade Launcher',
    badgeLabel: 'Grenade Launcher',
    category: { label: 'Ranged Weapon', variant: 'ranged' },
    summary: 'Versatile auxiliary launcher firing either high-explosive Frag rounds against swarms or high-impact Krak rounds against armored foes.',
    stats: { range: '24"', a: 'D3', bs: '3+', s: '9', ap: '-2', d: 'D3' },
    keywords: ['[BLAST]'],
  },
  '+cp': {
    title: 'Tactical Precision',
    badgeLabel: '+1 CP',
    category: { label: 'Gains +1 CP', variant: 'cp' },
    summary: 'Gain 1 Command Point (CP) on a 4+ roll whenever you target this unit with a Stratagem.',
  },
  '+1 cp': {
    title: 'Command Uplink',
    badgeLabel: '+1 CP',
    category: { label: 'Gains +1 CP', variant: 'cp' },
    summary: 'Gain 1 Command Point (CP) on a 4+ roll whenever you target this unit with a Stratagem.',
  },
  '+1 cp ability': {
    title: 'Command Uplink',
    badgeLabel: '+1 CP',
    category: { label: 'Gains +1 CP', variant: 'cp' },
    summary: 'Gain 1 Command Point (CP) on a 4+ roll whenever you target this unit with a Stratagem.',
  },
  'stealth': {
    title: 'Stealth',
    badgeLabel: 'Stealth',
    category: { label: 'Core Ability', variant: 'ability' },
    summary: 'Subtract 1 from Hit rolls made against this unit by ranged attacks.',
  },
  'cover': {
    title: 'Benefit of Cover',
    badgeLabel: 'Cover −1 BS',
    category: { label: 'Battlefield Benefit', variant: 'buff' },
    summary: 'Subtract 1 from the Ballistic Skill (BS) of incoming ranged attacks made against this unit.',
  },
  'fights first': {
    title: 'Fights First',
    badgeLabel: 'Fights First',
    category: { label: 'Core Ability', variant: 'ability' },
    summary: 'This unit is eligible to fight in the Fight phase before units without Fights First, even if it did not charge.',
  },
  'lone operative': {
    title: 'Lone Operative',
    badgeLabel: 'Lone Operative',
    category: { label: 'Core Ability', variant: 'ability' },
    summary: 'This model can only be selected as the target of a ranged attack if the attacking model is within 12".',
  },
  'feel no pain': {
    title: 'Feel No Pain',
    badgeLabel: 'Feel No Pain',
    category: { label: 'Core Ability', variant: 'buff' },
    summary: 'Each time this model loses a wound, roll one D6. On the specified roll or higher, that wound is not lost.',
  },
  'oath of moment': {
    title: 'Oath of Moment',
    badgeLabel: 'Oath Target',
    category: { label: 'Army Rule', variant: 'special' },
    summary: 'Designated enemy priority target. Friendly Adeptus Astartes units re-roll Hit rolls when attacking this unit.',
  },
  'spotted +1 bs': {
    title: 'Spotted Target',
    badgeLabel: 'Spotted +1 BS',
    category: { label: 'T’au For the Greater Good', variant: 'buff' },
    summary: 'Target marked by an Observer unit. Friendly Guided units improve their Ballistic Skill by 1 when shooting at this unit.',
  },
  'observer': {
    title: 'Observer Unit',
    badgeLabel: 'Observer',
    category: { label: 'T’au For the Greater Good', variant: 'ability' },
    summary: 'Designating enemy targets for friendly Guided squads to improve their accuracy.',
  },
  'guided': {
    title: 'Guided Squad',
    badgeLabel: 'Guided',
    category: { label: 'T’au For the Greater Good', variant: 'buff' },
    summary: 'Receiving targeting telemetry from an Observer unit, gaining +1 to Ballistic Skill vs spotted targets.',
  },
};

/** Normalize names for lookup (strip punctuation, extra spaces) */
function norm(s: string): string {
  return s.toLowerCase().replace(/^[+\u26A1\u{1F3AF}\u{1F6E1}\u{1F441}\u2694\uFE0F\s]+|[+\u26A1\u{1F3AF}\u{1F6E1}\u{1F441}\u2694\uFE0F\s]+$/gu, '').replace(/–/g, '-').trim();
}

/** Resolve complete ability or weapon details from model / unit data or fallback tables */
export function getAbilityOrWeaponInfo(
  rawName: string,
  unit?: UnitState,
  model?: ModelState
): AbilityOrWeaponInfo {
  const clean = rawName.trim();
  const k = norm(clean);

  // 1. Direct known special case check
  if (KNOWN_DATA[k]) {
    const d = KNOWN_DATA[k];
    return {
      title: d.title ?? clean,
      badgeLabel: d.badgeLabel ?? clean,
      category: d.category ?? { label: 'Special Gear', variant: 'special' },
      summary: d.summary ?? clean,
      stats: d.stats,
      keywords: d.keywords,
    };
  }

  // 2. CP ability shorthand check
  if (k.includes('cp') || k.includes('+cp')) {
    return {
      title: 'Command Uplink',
      badgeLabel: '+1 CP',
      category: { label: 'Gains +1 CP', variant: 'cp' },
      summary: 'Gain 1 Command Point (CP) on a 4+ roll whenever you target this unit with a Stratagem.',
    };
  }

  // 3. Search weapons on model or unit
  const allWeapons: WeaponData[] = [
    ...(model?.weapons ?? []),
    ...(unit?.models.flatMap((m) => m.weapons) ?? []),
  ];

  const matchedWeapon = allWeapons.find((w) => norm(w.name) === k || norm(w.name).includes(k) || k.includes(norm(w.name)));
  if (matchedWeapon && matchedWeapon.profiles?.length > 0) {
    const prof: WeaponProfileData = matchedWeapon.profiles[0];
    const isMelee = prof.range === 'Melee';

    let badgeLabel = matchedWeapon.name;
    if (badgeLabel.length > 18) {
      badgeLabel = badgeLabel.replace(/^(Astartes|Master-crafted|Relic)\s+/i, '');
    }

    const kw = (prof.abilities ?? []).map((a) => (a.startsWith('[') ? a.toUpperCase() : `[${a.toUpperCase()}]`));

    let summary = isMelee
      ? `Melee weapon striking with Strength ${prof.S} and Armor Penetration ${prof.AP}.`
      : `Ranged weapon firing at up to ${prof.range}" with Strength ${prof.S} and Armor Penetration ${prof.AP}.`;

    if (kw.length) {
      summary += ` Equipped with: ${kw.join(', ')}.`;
    }

    return {
      title: matchedWeapon.name,
      badgeLabel,
      category: {
        label: isMelee ? 'Melee Weapon' : 'Ranged Weapon',
        variant: isMelee ? 'melee' : 'ranged',
      },
      summary,
      stats: {
        range: typeof prof.range === 'number' ? `${prof.range}"` : String(prof.range),
        a: String(prof.A),
        skillLabel: isMelee ? 'WS' : 'BS',
        bs: prof.skill ? `${prof.skill}+` : 'N/A',
        s: String(prof.S),
        ap: String(prof.AP),
        d: String(prof.D),
      },
      keywords: kw.length ? kw : undefined,
    };
  }

  // 4. Search unit abilities
  if (unit?.abilities) {
    const matchedAbility = unit.abilities.find((a) => norm(a.name) === k || norm(a.name).includes(k) || k.includes(norm(a.name)));
    if (matchedAbility) {
      return {
        title: matchedAbility.name,
        badgeLabel: matchedAbility.name.length > 20 ? matchedAbility.name.slice(0, 19) + '…' : matchedAbility.name,
        category: {
          label: matchedAbility.type ? `${matchedAbility.type} Ability` : 'Datasheet Ability',
          variant: 'ability',
        },
        summary: matchedAbility.text ? matchedAbility.text.slice(0, 200) + (matchedAbility.text.length > 200 ? '…' : '') : `Special rules apply to this unit.`,
      };
    }
  }

  // 5. Check if it's an Astra Militarum Order
  if (clean.toLowerCase().startsWith('order:') || clean.toLowerCase().startsWith('[order:')) {
    const orderName = clean.replace(/^[\[\s]*order:\s*/i, '').replace(/[\]\s]*$/, '');
    return {
      title: `Order: ${orderName}`,
      badgeLabel: `Order: ${orderName}`,
      category: { label: 'Astra Militarum Order', variant: 'buff' },
      summary: `Active tactical order issued by an Officer: "${orderName}". Confers battlefield bonuses until the end of the phase.`,
    };
  }

  // 6. Generic Fallback
  return {
    title: clean,
    badgeLabel: clean.length > 18 ? clean.slice(0, 17) + '…' : clean,
    category: { label: 'Special', variant: 'special' },
    summary: `Active wargear or tactical effect: ${clean}.`,
  };
}

function getCategoryStyle(variant: AbilityOrWeaponInfo['category']['variant']): React.CSSProperties {
  switch (variant) {
    case 'cp':
      return { background: '#064E3B', color: '#34D399', border: '1px solid #059669' };
    case 'ranged':
      return { background: '#2A2012', color: '#F59E0B', border: '1px solid #D99B26' };
    case 'melee':
      return { background: '#2D1412', color: '#F87171', border: '1px solid #DC2626' };
    case 'ability':
      return { background: '#0C2840', color: '#38BDF8', border: '1px solid #0284C7' };
    case 'buff':
      return { background: '#1E1B4B', color: '#A78BFA', border: '1px solid #7C3AED' };
    case 'special':
    default:
      return { background: '#1F242D', color: '#FBBF24', border: '1px solid rgba(245, 158, 11, 0.4)' };
  }
}

/** Highlight numeric measurements (8", D6", 4+, +1, -2, etc.) in amber gold */
export function renderHighlightedText(text: string): React.ReactNode {
  // Regex matches numbers with inches (e.g. 24", 6"), plus/minus modifiers (+1, -2), D3/D6, dice checks (4+, 3+)
  const parts = text.split(/(\b\d+(?:\.\d+)?["']|\b[Dd][36]\b|\b\d+\+|\b[+-]\d+\b|\b\d+\s+Command\s+Points?\b|\b\d+\s+CP\b)/g);
  return parts.map((part, i) => {
    if (/^(\d+(?:\.\d+)?["']|[Dd][36]|\d+\+|[+-]\d+|\d+\s+Command\s+Points?|\d+\s+CP)$/i.test(part)) {
      return (
        <span key={i} style={{ color: '#FBBF24', fontWeight: 700 }}>
          {part}
        </span>
      );
    }
    return part;
  });
}

/** Floating Rich Popover Card with backdrop blur, dark & gold styling */
export function PopoverCard({
  info,
  anchorRect,
  onClose,
}: {
  info: AbilityOrWeaponInfo;
  anchorRect: DOMRect | null;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleDown = (e: MouseEvent | TouchEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown, true);
    document.addEventListener('touchstart', handleDown, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown, true);
      document.removeEventListener('touchstart', handleDown, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  if (!anchorRect) return null;

  const popWidth = 280;
  const margin = 8;
  const approxHeight = 170;

  // Horizontal clamping within viewport
  let left = anchorRect.left + anchorRect.width / 2 - popWidth / 2;
  left = Math.max(margin, Math.min(window.innerWidth - popWidth - margin, left));

  // Vertical: flip above/below depending on space
  const placeAbove = anchorRect.top > approxHeight + margin;
  const top = placeAbove ? anchorRect.top - margin : anchorRect.bottom + margin;

  return createPortal(
    <div
      ref={popoverRef}
      className="ability-popover-card"
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        transform: placeAbove ? 'translateY(-100%)' : 'none',
        width: `${popWidth}px`,
        maxWidth: 'calc(100vw - 20px)',
        background: 'rgba(18, 20, 23, 0.96)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid #374151',
        borderLeft: '3px solid #F59E0B',
        borderRadius: '8px',
        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.75), 0 0 1px rgba(245, 158, 11, 0.3)',
        zIndex: 9999,
        padding: '12px 14px',
        color: '#E2E8F0',
        fontSize: '12.5px',
        lineHeight: 1.45,
        pointerEvents: 'auto',
        animation: 'popoverFadeIn 0.15s ease-out',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
        <div style={{ fontWeight: 700, fontSize: '14px', color: '#F8FAFC', letterSpacing: '0.01em', lineHeight: 1.25 }}>
          {info.title}
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '2px 7px',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            ...getCategoryStyle(info.category.variant),
          }}
        >
          {info.category.label}
        </span>
      </div>

      {/* Summary */}
      <div style={{ fontSize: '12px', color: '#CBD5E1', marginBottom: info.stats ? '10px' : '0', lineHeight: 1.45 }}>
        {renderHighlightedText(info.summary)}
      </div>

      {/* Quick Stats Row (if weapon) */}
      {info.stats && (
        <div style={{ display: 'flex', gap: '4px', marginTop: '8px', marginBottom: info.keywords?.length ? '6px' : '0' }}>
          <div style={statBoxStyle}>
            <span style={statLabelStyle}>Range</span>
            <b style={statValStyle}>{info.stats.range}</b>
          </div>
          <div style={statBoxStyle}>
            <span style={statLabelStyle}>A</span>
            <b style={statValStyle}>{info.stats.a}</b>
          </div>
          <div style={statBoxStyle}>
            <span style={statLabelStyle}>{info.stats.skillLabel || 'BS'}</span>
            <b style={statValStyle}>{info.stats.bs}</b>
          </div>
          <div style={statBoxStyle}>
            <span style={statLabelStyle}>S</span>
            <b style={statValStyle}>{info.stats.s}</b>
          </div>
          <div style={statBoxStyle}>
            <span style={statLabelStyle}>AP</span>
            <b style={statValStyle}>{info.stats.ap}</b>
          </div>
          <div style={statBoxStyle}>
            <span style={statLabelStyle}>D</span>
            <b style={statValStyle}>{info.stats.d}</b>
          </div>
        </div>
      )}

      {/* Keywords / Weapon Abilities */}
      {info.keywords && info.keywords.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
          {info.keywords.map((kw) => (
            <span
              key={kw}
              style={{
                fontSize: '9.5px',
                fontWeight: 700,
                background: '#1F242D',
                color: '#FBBF24',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '3px',
                padding: '1px 5px',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              {kw}
            </span>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}

const statBoxStyle: React.CSSProperties = {
  background: '#1B1F26',
  border: '1px solid #2A303C',
  borderRadius: '4px',
  padding: '4px 2px',
  flex: 1,
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  minWidth: 0,
};

const statLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94A3B8',
  textTransform: 'uppercase',
  fontWeight: 600,
  lineHeight: 1,
};

const statValStyle: React.CSSProperties = {
  fontSize: '11.5px',
  color: '#F8FAFC',
  fontWeight: 700,
  marginTop: '2px',
  lineHeight: 1.1,
};

/** Interactive Pill Badge with Popover trigger */
function AbilityBadgeImpl({
  name,
  unit,
  model,
  compact = false,
  className = '',
  style = {},
}: {
  name: string;
  unit?: UnitState;
  model?: ModelState;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  const info = React.useMemo(() => getAbilityOrWeaponInfo(name, unit, model), [name, unit, model]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (badgeRef.current) {
      setRect(badgeRef.current.getBoundingClientRect());
      setOpen((v) => !v);
    }
  }, []);

  return (
    <>
      <button
        ref={badgeRef}
        type="button"
        className={`ability-pill-badge ${open ? 'open' : ''} ${className}`}
        onClick={handleToggle}
        title={info.title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: open ? 'rgba(245, 158, 11, 0.16)' : 'rgba(27, 31, 38, 0.9)',
          border: `1px solid ${open ? '#F59E0B' : '#374151'}`,
          borderRadius: '9999px',
          padding: compact ? '1px 6px' : '2px 8px',
          fontSize: compact ? '11px' : '11.5px',
          fontWeight: 600,
          color: '#E2E8F0',
          cursor: 'pointer',
          outline: 'none',
          whiteSpace: 'nowrap',
          maxWidth: '160px',
          maxHeight: '26px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          boxSizing: 'border-box',
          transition: 'all 0.15s ease',
          pointerEvents: 'auto',
          ...style,
        }}
      >
        {info.category.variant === 'cp' && (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="#34D399" style={{ flexShrink: 0 }}>
            <path d="M9 1 L3 9 L8 9 L7 15 L13 7 L8 7 Z" />
          </svg>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '110px' }}>
          {info.badgeLabel}
        </span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#F59E0B" strokeWidth="1.5" style={{ opacity: 0.9, flexShrink: 0 }}>
          <circle cx="8" cy="8" r="7" />
          <circle cx="8" cy="4.8" r="0.8" fill="#F59E0B" />
          <path d="M7 7.5 H8 V12 H9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && <PopoverCard info={info} anchorRect={rect} onClose={() => setOpen(false)} />}
    </>
  );
}

export const AbilityBadge = React.memo(AbilityBadgeImpl);

