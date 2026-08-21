// Date and label formatting, in French.

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

const DAY = 86_400_000

/** "dans 5 jours", "il y a 3 jours", "jamais". */
export function relative(iso: string | null): string {
  if (!iso) return 'jamais'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'jamais'
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

/** How long ago the link was made: "il y a 12 jours". */
export function age(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const days = Math.round((then - Date.now()) / DAY)
  if (days === 0) {
    const hours = Math.round((then - Date.now()) / 3_600_000)
    if (hours === 0) return "à l’instant"
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
  { key: '1h', label: 'Dans 1 heure', short: 'dans 1 heure' },
  { key: 'today', label: 'Fin de journée', short: 'fin de journée' },
  { key: '7d', label: 'Dans 7 jours', short: 'dans 7 jours' },
  { key: '30d', label: 'Dans 30 jours', short: 'dans 30 jours' },
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
