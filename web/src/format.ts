// Date and label formatting, in the deployment's language.
import { lang, t } from './i18n'

const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
const dateFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat(lang, {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

const DAY = 86_400_000

/** "in 5 days", "3 days ago", "never". */
export function relative(iso: string | null): string {
  if (!iso) return t('time.never')
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return t('time.never')
  const diff = then - Date.now()
  const days = Math.round(diff / DAY)
  if (Math.abs(days) >= 1) return rtf.format(days, 'day')
  const hours = Math.round(diff / 3_600_000)
  if (Math.abs(hours) >= 1) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(diff / 60_000), 'minute')
}

export function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

export function longDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d)
}

/** How long ago the link was made: "12 days ago". */
export function age(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const days = Math.round((then - Date.now()) / DAY)
  if (days === 0) {
    const hours = Math.round((then - Date.now()) / 3_600_000)
    if (hours === 0) return t('time.just_now')
    return rtf.format(hours, 'hour')
  }
  return rtf.format(days, 'day')
}

/** A day and a month, the way this language writes them. */
export function dayMonth(d: Date): string {
  return dateFmt.format(d)
}

/** The address without its scheme, the way you would read it aloud. */
export function destLabel(raw: string): string {
  try {
    const u = new URL(raw)
    return u.host.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + u.search
  } catch {
    return raw
  }
}

// Three shapes for each preset, because the same choice is offered in three
// widths: a chip in the create panel, a value on the finished link, and a
// crowded row of buttons in the detail sheet.
export const EXPIRY_KEYS = ['1h', 'today', '7d', '30d'] as const

export type ExpiryKey = (typeof EXPIRY_KEYS)[number]

export type ExpiryPreset = { key: ExpiryKey; label: string; short: string; compact: string }

/** Built on demand so the labels are read from the catalogue, not frozen at import. */
export function expiryPresets(): ExpiryPreset[] {
  return EXPIRY_KEYS.map((key) => ({
    key,
    label: t(`expiry.${key}`),
    short: t(`expiry.${key}.short`),
    compact: t(`expiry.${key}.compact`),
  }))
}

/** Turns an expiry shorthand into an actual instant. */
export function expiryToDate(key: ExpiryKey): Date {
  const d = new Date()
  switch (key) {
    case '1h':
      d.setHours(d.getHours() + 1)
      return d
    case 'today':
      d.setHours(23, 59, 59, 0)
      return d
    case '7d':
      d.setDate(d.getDate() + 7)
      return d
    case '30d':
      d.setDate(d.getDate() + 30)
      return d
  }
}
