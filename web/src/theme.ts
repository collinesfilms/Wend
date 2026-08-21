// The theme is the user's choice, kept locally. Light by default: that is the
// version the interface is drawn for.
export type Theme = 'light' | 'dark'

const KEY = 'collines-go-theme'

export function storedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#141613' : '#ECEEEA')
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* private browsing: the choice will not survive, which is fine */
  }
}
