// What separates an application from a page on a phone: no double-tap zoom, no
// rubber-band behind the sheets, no long-press selection on the chrome. The
// stylesheet does nearly all of it — touch-action, overscroll-behavior and
// user-select. This is the one part CSS cannot express.
export function makeItFeelLikeAnApp() {
  // Pinch is left alone in a normal browser tab: it is the only way back for
  // someone who needs to magnify something, and Safari ignores the viewport's
  // user-scalable=no there anyway. Installed to the home screen, where the app
  // owns the whole screen and there is no browser chrome to escape to, the
  // viewport lock applies and these gestures are locked out with it.
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (!standalone) return

  const swallow = (e: Event) => e.preventDefault()
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, swallow, { passive: false })
  }
}
