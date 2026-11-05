// Theme management: supports 'auto' (system preference), 'light', and 'dark'.
// Persisted in localStorage and synchronized with <html data-theme="...">.

export type ThemeMode = 'auto' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'warhammer_theme_preference';
let inMemoryTheme: ThemeMode = 'auto';

export function getStoredTheme(): ThemeMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(THEME_STORAGE_KEY);
      if (val === 'light' || val === 'dark' || val === 'auto') return val;
    }
  } catch {
    // fallback
  }
  return inMemoryTheme;
}

export function applyTheme(theme: ThemeMode) {
  inMemoryTheme = theme;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // ignore
  }

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (theme === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }
}

export function getEffectiveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function initTheme(): ThemeMode {
  const current = getStoredTheme();
  applyTheme(current);
  return current;
}
