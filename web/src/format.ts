// Date and label formatting.

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

const DAY = 86_400_000

/** "in 5 days", "3 days ago", "never". */
export function relative(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
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
    if (hours === 0) return 'just now'
    return rtf.format(hours, 'hour')
  }
  return rtf.format(days, 'day')
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

export const EXPIRY_PRESETS = [
  { key: '1h', label: 'In 1 hour', short: 'in 1 hour' },
  { key: 'today', label: 'End of today', short: 'end of today' },
  { key: '7d', label: 'In 7 days', short: 'in 7 days' },
  { key: '30d', label: 'In 30 days', short: 'in 30 days' },
] as const

export type ExpiryKey = (typeof EXPIRY_PRESETS)[number]['key']

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
