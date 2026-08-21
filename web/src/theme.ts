// The theme is one of three choices, and it belongs to the account rather than
// to the browser: it is written to the server so the same person opening Wend
// on another device finds the choice they already made.
//
// Local storage is still used, but only as a cache for the very first frame.
// The shell applies it inline before React boots, which is what stops a dark
// interface flashing white on load; the server's answer then wins.
export type Theme = 'auto' | 'light' | 'dark'

const KEY = 'wend-theme'

const DARK = '#141613'
const LIGHT = '#ECEEEA'

export const THEMES: Theme[] = ['auto', 'light', 'dark']

export function isTheme(value: unknown): value is Theme {
  return value === 'auto' || value === 'light' || value === 'dark'
}

/** The last theme this browser saw, for the first paint only. */
export function cachedTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    return isTheme(stored) ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** What "auto" resolves to right now. */
export function resolve(theme: Theme): 'light' | 'dark' {
  if (theme === 'auto') return prefersDark() ? 'dark' : 'light'
  return theme
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  // Auto leaves the attribute off entirely and lets the stylesheet's
  // prefers-color-scheme rules decide, so the system change needs no repaint.
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolve(theme) === 'dark' ? DARK : LIGHT)

  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* private browsing: the account still remembers, this browser will not */
  }
}

/**
 * Keeps the address bar in step with the system while the theme is on auto.
 * The colours themselves are handled by the stylesheet.
 */
export function watchSystem(theme: Theme, onChange: () => void): () => void {
  if (theme !== 'auto') return () => {}
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** auto → light → dark → auto. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
}
