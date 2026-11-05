import { useEffect, useState } from 'react';
import { applyTheme, getEffectiveTheme, getStoredTheme, type ThemeMode } from './theme';
import { Icon } from './Icon';

interface Props {
  className?: string;
  size?: number;
}

export function ThemeToggle({ className, size = 18 }: Props) {
  const [theme, setThemeState] = useState<ThemeMode>(getStoredTheme);
  const [effective, setEffective] = useState<'light' | 'dark'>(() => getEffectiveTheme(getStoredTheme()));

  useEffect(() => {
    const handleMediaChange = () => {
      const current = getStoredTheme();
      setEffective(getEffectiveTheme(current));
    };

    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    media?.addEventListener('change', handleMediaChange);
    return () => media?.removeEventListener('change', handleMediaChange);
  }, []);

  const handleToggle = () => {
    // Cycles between light and dark
    const nextTheme: ThemeMode = effective === 'dark' ? 'light' : 'dark';
    setThemeState(nextTheme);
    applyTheme(nextTheme);
    setEffective(nextTheme);
  };

  const isDark = effective === 'dark';

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className ?? ''}`}
      onClick={handleToggle}
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 36,
        minHeight: 36,
        padding: '6px',
        borderRadius: 8,
        border: '1px solid var(--line-2)',
        background: 'var(--surface)',
        color: isDark ? '#fbbf24' : '#d97706',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      <Icon name={isDark ? 'sun' : 'moon'} size={size} />
    </button>
  );
}
