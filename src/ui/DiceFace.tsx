import React from 'react';

export interface DiceFaceProps {
  value: number;
  size?: number;
  variant?: 'miracle' | 'fate' | 'crimson' | 'standard';
  className?: string;
  style?: React.CSSProperties;
}

/**
 * High-fidelity, tabletop-authentic D6 die face with clean vector pips.
 * Provides instant scannability and prevents raw bracketed text like [4][2].
 */
export const DiceFace = React.memo(function DiceFace({
  value,
  size = 22,
  variant = 'miracle',
  className = '',
  style = {},
}: DiceFaceProps) {
  const clamped = Math.max(1, Math.min(6, Math.round(value)));

  const isMiracle = variant === 'miracle';
  const isFate = variant === 'fate';
  const isCrimson = variant === 'crimson';

  // Theme palettes:
  // miracle: Ivory white face, warm amber-gold border, dark crimson/vermilion pips
  // fate: Cosmic deep navy face, luminous cyan border, glowing aqua pips
  // crimson: Deep dark red face, ruby border, pale ivory pips
  // standard: Dark slate face, subtle grey border, amber pips
  const bgFill = isMiracle ? '#FFFDF5' : isFate ? '#082F49' : isCrimson ? '#450A0A' : '#1E293B';
  const borderColor = isMiracle ? '#D97706' : isFate ? '#38BDF8' : isCrimson ? '#DC2626' : '#64748B';
  const pipColor = isMiracle ? '#991B1B' : isFate ? '#67E8F9' : isCrimson ? '#FEF08A' : '#F59E0B';
  const bevelHighlight = isMiracle ? 'rgba(255,255,255,0.9)' : isFate ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.25)';
  const bevelShadow = isMiracle ? 'rgba(180,83,9,0.25)' : isFate ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.5)';

  // Pip coordinates in a 24x24 viewBox:
  // Center: (12, 12)
  // Top-left: (6.5, 6.5), Top-right: (17.5, 6.5)
  // Mid-left: (6.5, 12), Mid-right: (17.5, 12)
  // Bottom-left: (6.5, 17.5), Bottom-right: (17.5, 17.5)
  const pips: { x: number; y: number }[] = [];
  if (clamped === 1) {
    pips.push({ x: 12, y: 12 });
  } else if (clamped === 2) {
    pips.push({ x: 6.5, y: 6.5 }, { x: 17.5, y: 17.5 });
  } else if (clamped === 3) {
    pips.push({ x: 6.5, y: 6.5 }, { x: 12, y: 12 }, { x: 17.5, y: 17.5 });
  } else if (clamped === 4) {
    pips.push({ x: 6.5, y: 6.5 }, { x: 17.5, y: 6.5 }, { x: 6.5, y: 17.5 }, { x: 17.5, y: 17.5 });
  } else if (clamped === 5) {
    pips.push({ x: 6.5, y: 6.5 }, { x: 17.5, y: 6.5 }, { x: 12, y: 12 }, { x: 6.5, y: 17.5 }, { x: 17.5, y: 17.5 });
  } else if (clamped === 6) {
    pips.push({ x: 6.5, y: 6.5 }, { x: 17.5, y: 6.5 }, { x: 6.5, y: 12 }, { x: 17.5, y: 12 }, { x: 6.5, y: 17.5 }, { x: 17.5, y: 17.5 });
  }

  const pipRadius = clamped === 1 ? 2.8 : 2.1;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`dice-face ${variant} ${className}`}
      role="img"
      aria-label={`Die: ${clamped}`}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        borderRadius: '5px',
        flexShrink: 0,
        filter: isFate ? 'drop-shadow(0 0 4px rgba(56,189,248,0.5))' : 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))',
        ...style,
      }}
    >
      <title>{`Die: ${clamped}`}</title>
      {/* Outer die body */}
      <rect x="1" y="1" width="22" height="22" rx="4.5" fill={bgFill} stroke={borderColor} strokeWidth="1.4" />
      {/* 3D top-left specular bevel highlight */}
      <path d="M 3.5 3.5 L 20.5 3.5" stroke={bevelHighlight} strokeWidth="1" strokeLinecap="round" />
      <path d="M 3.5 3.5 L 3.5 20.5" stroke={bevelHighlight} strokeWidth="1" strokeLinecap="round" />
      {/* 3D bottom-right bevel shadow */}
      <path d="M 3.5 20.5 L 20.5 20.5" stroke={bevelShadow} strokeWidth="1" strokeLinecap="round" />
      <path d="M 20.5 3.5 L 20.5 20.5" stroke={bevelShadow} strokeWidth="1" strokeLinecap="round" />
      {/* D6 Pips */}
      {pips.map((pt, i) => (
        <circle key={i} cx={pt.x} cy={pt.y} r={pipRadius} fill={pipColor} />
      ))}
    </svg>
  );
});
