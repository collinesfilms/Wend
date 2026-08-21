// Turning the QR on screen into a file someone can keep. The one on screen is
// sized for the layout; this redraws it large so what gets saved is worth
// printing, and hands it over the way each platform expects.
import { draw } from './qr'

const EXPORT_PX = 1024

export type SaveOutcome = 'shared' | 'downloaded' | 'failed'

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/**
 * A phone has nowhere useful to put a downloaded file, but it does have a share
 * sheet with "Save to Photos" in it. A desktop has the opposite problem, and a
 * share dialog there would be a worse answer than a file in Downloads.
 */
function preferShare(file: File): boolean {
  try {
    return (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] }) &&
      window.matchMedia('(hover: none)').matches
    )
  } catch {
    return false
  }
}

export async function saveQr(url: string, slug: string): Promise<SaveOutcome> {
  try {
    const canvas = document.createElement('canvas')
    draw(canvas, url, EXPORT_PX)
    const blob = await toBlob(canvas)
    if (!blob) return 'failed'

    const name = `qr-${slug || 'link'}.png`
    const file = new File([blob], name, { type: 'image/png' })

    if (preferShare(file)) {
      try {
        await navigator.share({ files: [file] })
        return 'shared'
      } catch (err) {
        // Dismissing the share sheet is a choice, not a failure, and must not
        // fall through to a download the person did not ask for.
        if (err instanceof DOMException && err.name === 'AbortError') return 'shared'
      }
    }

    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoked on the next turn of the loop: Safari needs the URL to outlive the
    // click that started the download.
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}
