// Clipboard reads and writes, with the workarounds browsers actually require.

/**
 * A pending permission prompt can leave this promise unresolved forever, so the
 * read is always bounded and the interface never waits on it.
 */
export async function readClipboard(ms = 1200): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null
    return await Promise.race([
      navigator.clipboard.readText(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ])
  } catch {
    return null
  }
}

/**
 * Safari drops the write permission as soon as an await sits between the user's
 * gesture and the call, so it gets a promise of text rather than the text. That
 * keeps the gesture alive across the server round trip.
 */
export async function copyText(text: string | Promise<string>): Promise<boolean> {
  try {
    if (navigator.clipboard && 'ClipboardItem' in window) {
      const blob =
        typeof text === 'string'
          ? new Blob([text], { type: 'text/plain' })
          : text.then((t) => new Blob([t], { type: 'text/plain' }))
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return true
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(await text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const value = await text
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, value.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export function isUrl(text: string | null | undefined): text is string {
  if (!text || text.length > 2048) return false
  try {
    const u = new URL(text.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // no i, l, o, 0, 1

export function randomSlug(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

const PASS_WORDS = [
  'chambre', 'diaphragme', 'argentique', 'gelatine', 'obturateur',
  'soufflet', 'negatif', 'emulsion', 'trepied', 'revelateur',
]

/** A password you can read out to a class without repeating it three times. */
export function suggestPassword(): string {
  const bytes = new Uint8Array(2)
  crypto.getRandomValues(bytes)
  const word = PASS_WORDS[bytes[0] % PASS_WORDS.length]
  return `${word}-${10 + (bytes[1] % 90)}`
}
