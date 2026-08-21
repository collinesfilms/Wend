import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type Brand, type Domain, type Link, type Settings, type User } from './api'
import { DetailSheet, LinksSheet, SettingsSheet } from './Sheets'
import { Stage } from './Stage'
import { applyTheme, cachedTheme, isTheme, nextTheme, watchSystem, type Theme } from './theme'
import { t } from './i18n'
import * as I from './icons'
import { draw as drawQr } from './qr'
import { saveQr } from './qrfile'

type Sheet = 'none' | 'links' | 'detail' | 'settings'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [domains, setDomains] = useState<Domain[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [brand, setBrand] = useState<Brand>({ name: 'Wend', tagline: '' })
  const [links, setLinks] = useState<Link[]>([])
  const [theme, setThemeState] = useState<Theme>(cachedTheme)
  const [sheet, setSheet] = useState<Sheet>('none')
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detailFrom, setDetailFrom] = useState<'list' | 'direct'>('list')
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [qrFull, setQrFull] = useState<Link | null>(null)
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  const toastTimer = useRef<number | undefined>(undefined)
  const qrFullCanvas = useRef<HTMLCanvasElement>(null)

  const showToast = useCallback((text: string, bad = false) => {
    setToast({ text, bad })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  useEffect(() => applyTheme(theme), [theme])

  // On auto, the system can change under us — at sunset, or when someone flips
  // the switch in another window. The colours follow from the stylesheet; this
  // is only here to keep the address bar's tint honest.
  useEffect(() => watchSystem(theme, () => applyTheme(theme)), [theme])

  // The choice is the account's, so it is written back to the server. The local
  // state moves first: a preference that waits on a round trip feels broken.
  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next)
      void api.savePrefs({ theme: next }).catch(() => {
        /* the choice still holds in this browser; the next load will re-sync */
      })
    },
    [],
  )

  // Whoever runs this instance puts their own name on the tab.
  useEffect(() => {
    if (brand.name) document.title = brand.name
  }, [brand.name])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('auth_error')
    if (err) {
      setAuthError(err.replace(/\+/g, ' '))
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const loadLinks = useCallback(async () => {
    try {
      setLinks(await api.links())
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        showToast(t('toast.links_failed'), true)
      }
    }
  }, [showToast])

  useEffect(() => {
    void (async () => {
      try {
        const me = await api.me()
        setUser(me.user)
        setDomains(me.domains)
        setSettings(me.settings)
        if (me.brand) setBrand(me.brand)
        // The account's theme is the truth; the cached one only painted frame one.
        if (isTheme(me.prefs?.theme)) setThemeState(me.prefs.theme)
        await loadLinks()
      } catch {
        setUser(null)
      } finally {
        setLoading(false)
      }
    })()
  }, [loadLinks])

  // The list and the detail are two sheets: one retracts while the other rises,
  // with just enough stagger for the hand-off to read.
  const openSheet = (next: Sheet) => {
    if (sheet !== 'none' && sheet !== next) {
      setSheet('none')
      window.setTimeout(() => setSheet(next), 150)
    } else {
      setSheet(next)
    }
  }

  const openDetail = (id: number, from: 'list' | 'direct') => {
    setDetailId(id)
    setDetailFrom(from)
    openSheet('detail')
  }

  const backFromDetail = () => {
    if (detailFrom === 'list') openSheet('links')
    else setSheet('none')
  }

  const closeSheets = () => setSheet('none')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (qrFull) return setQrFull(null)
      if (sheet === 'detail') return backFromDetail()
      if (sheet !== 'none') return closeSheets()
      setSignOutOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!qrFull) return
    const canvas = qrFullCanvas.current
    if (!canvas) return
    const avail = Math.min(window.innerWidth, window.innerHeight) * 0.62
    drawQr(canvas, qrFull.short_url, Math.min(avail, 440))
  }, [qrFull])

  useEffect(() => {
    const dismiss = () => setSignOutOpen(false)
    document.addEventListener('click', dismiss)
    return () => document.removeEventListener('click', dismiss)
  }, [])

  const downloadQr = async () => {
    if (!qrFull) return
    const outcome = await saveQr(qrFull.short_url, qrFull.slug)
    if (outcome === 'downloaded') showToast(t('toast.qr_saved'))
    if (outcome === 'failed') showToast(t('toast.qr_failed'), true)
  }

  const signOut = async () => {
    try {
      await api.logout()
    } catch {
      /* the session is gone client-side either way */
    }
    window.location.href = '/'
  }

  if (loading) {
    return <div className="spinner-page">{t('loading')}</div>
  }

  if (!user || !settings) {
    return <SignIn error={authError} brand={brand} />
  }

  const detailLink = links.find((l) => l.id === detailId) ?? null
  const initials = initialsOf(user)

  return (
    <>
      <div className="chrome">
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <button
            className={`chip-btn${links.length === 0 ? ' hidden' : ''}`}
            onClick={() => openSheet('links')}
            aria-label={t('chrome.links.open')}
          >
            <I.Rows size={14} width={1.8} />
            {t('chrome.links')} <span className="count tnum">{links.length}</span>
          </button>
        </div>

        <div className="chrome-right">
          {/* the sign-out pill opens leftwards over these two, so they step aside */}
          <button
            className={`icon-btn theme${signOutOpen ? ' hidden' : ''}`}
            onClick={() => setTheme(nextTheme(theme))}
            aria-label={t(`chrome.theme.${theme}`)}
            title={t(`chrome.theme.${theme}`)}
          >
            <ThemeIcon theme={theme} />
          </button>
          <button
            className={`icon-btn${signOutOpen ? ' hidden' : ''}`}
            onClick={() => openSheet('settings')}
            aria-label={t('chrome.settings')}
          >
            <I.Gear size={16} />
          </button>
          <div className="avatar-wrap">
            <button
              className={`avatar${signOutOpen ? ' hidden' : ''}`}
              aria-label={t('chrome.account')}
              onClick={(e) => {
                e.stopPropagation()
                setSignOutOpen(true)
              }}
            >
              {initials}
            </button>
            <button
              className={`signout${signOutOpen ? ' open' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                void signOut()
              }}
            >
              <span>{t('chrome.signout')}</span>
            </button>
          </div>
        </div>
      </div>

      <div id="app">
        <div className="view on">
          <Stage
            domains={domains}
            settings={settings}
            onCreated={() => void loadLinks()}
            onOpenDetail={(id) => openDetail(id, 'direct')}
            onToast={showToast}
            onShowQrFull={setQrFull}
          />
        </div>
      </div>

      <div className={`scrim${sheet !== 'none' ? ' on' : ''}`} onClick={closeSheets} />

      <LinksSheet
        open={sheet === 'links'}
        links={links}
        onOpenDetail={(id) => openDetail(id, 'list')}
        onClose={closeSheets}
        onQrFull={setQrFull}
        onToast={showToast}
      />

      <DetailSheet
        open={sheet === 'detail'}
        link={detailLink}
        from={detailFrom}
        onBack={backFromDetail}
        onToast={showToast}
        onChanged={(updated) => {
          void loadLinks()
          if (updated === null) {
            showToast(t('toast.link_deleted'))
            backFromDetail()
          }
        }}
      />

      <SettingsSheet
        open={sheet === 'settings'}
        user={user}
        domains={domains}
        settings={settings}
        theme={theme}
        onClose={closeSheets}
        onDomains={setDomains}
        onSettings={setSettings}
        onTheme={setTheme}
        onSignOut={() => void signOut()}
        onToast={showToast}
      />

      <div className={`qr-full${qrFull ? ' on' : ''}`} onClick={() => setQrFull(null)}>
        <div className="qr-full-box">
          <canvas ref={qrFullCanvas} width={440} height={440} />
        </div>
        <div className="qr-full-url">
          {qrFull ? `${qrFull.host}/` : ''}
          <b>{qrFull?.slug}</b>
        </div>
        <button
          className="qr-full-save"
          aria-label={t('qr.download.aria')}
          onClick={(e) => {
            e.stopPropagation()
            void downloadQr()
          }}
        >
          <I.Download size={15} width={1.9} />
          {t('qr.download')}
        </button>
        <div className="qr-full-hint">{t('qr.full.hint')}</div>
      </div>

      <div className={`toast${toast ? ' on' : ''}${toast?.bad ? ' bad' : ''}`} role="status">
        {toast?.text}
      </div>
    </>
  )
}

/** Auto shows the two halves together: whichever the system picks, it is this. */
function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') return <I.Sun size={16} />
  if (theme === 'dark') return <I.Moon size={16} />
  return <I.Auto size={16} />
}

function SignIn({ error, brand }: { error: string | null; brand: Brand }) {
  return (
    <div id="app">
      <div className="view on">
        <div className="plate">
          <span className="mark">
            <I.Key size={24} />
          </span>
          <h1>{brand.name || t('signin.title')}</h1>
          <p>{brand.tagline || t('signin.body')}</p>
          <button className="big-act" onClick={() => { window.location.href = '/auth/login' }}>
            <I.Key size={18} />
            {t('signin.button')}
          </button>
          {error && <div className="fine" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="fine">{t('signin.fine')}</div>
        </div>
      </div>
    </div>
  )
}

function initialsOf(user: User): string {
  const source = user.name || user.email || '?'
  const parts = source.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}
