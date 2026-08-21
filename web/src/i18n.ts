// Every word the interface says comes from locales/strings.json, the same file
// the Go server reads for its own pages. The language is chosen once, at deploy
// time, with CG_LANG: the server stamps it into the app shell, so it is settled
// before the first paint and there is nothing to switch at runtime.
import catalogue from '../../locales/strings.json'

type Catalogue = typeof catalogue
export type Key = keyof Catalogue['app']
export type Lang = string

const FALLBACK = 'en'

declare global {
  interface Window {
    __WEND_LANG__?: string
  }
}

function normalise(raw: string | undefined | null): string {
  return (raw ?? '').trim().toLowerCase().split(/[-_]/)[0]
}

function chooseLang(): Lang {
  const known = catalogue.languages as readonly string[]
  for (const candidate of [window.__WEND_LANG__, document.documentElement.lang]) {
    const code = normalise(candidate)
    if (code && known.includes(code)) return code
  }
  return FALLBACK
}

/** The one language this deployment speaks. */
export const lang: Lang = chooseLang()

const app = catalogue.app as Record<string, Record<string, string>>

/**
 * A translated string, with {placeholders} filled in. A key the catalogue has
 * not been taught falls back to English, then to the key itself, so a missing
 * translation is a cosmetic problem rather than a blank interface.
 */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const entry = app[key]
  let out = entry?.[lang] ?? entry?.[FALLBACK] ?? String(key)
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.split(`{${name}}`).join(String(value))
    }
  }
  return out
}
