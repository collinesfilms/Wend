import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type Domain, type Link, type Settings, type User } from './api'
import { DetailSheet, LinksSheet, SettingsSheet } from './Sheets'
import { Stage } from './Stage'
import { applyTheme, storedTheme, type Theme } from './theme'
import * as I from './icons'
import { draw as drawQr } from './qr'

type Sheet = 'none' | 'links' | 'detail' | 'settings'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [domains, setDomains] = useState<Domain[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [links, setLinks] = useState<Link[]>([])
  const [theme, setTheme] = useState<Theme>(storedTheme)
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
        showToast('Could not load your links', true)
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

  const signOut = async () => {
    try {
      await api.logout()
    } catch {
      /* the session is gone client-side either way */
    }
    window.location.href = '/'
  }

  if (loading) {
    return <div className="spinner-page">Loading…</div>
  }

  if (!user || !settings) {
    return <SignIn error={authError} />
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
            aria-label="Open the link list"
          >
            <I.Rows size={14} width={1.8} />
            Links <span className="count tnum">{links.length}</span>
          </button>
        </div>

        <div className="chrome-right">
          {/* the sign-out pill opens leftwards over these two, so they step aside */}
          <button
            className={`icon-btn theme${signOutOpen ? ' hidden' : ''}`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          >
            {theme === 'dark' ? <I.Sun size={16} /> : <I.Moon size={16} />}
          </button>
          <button
            className={`icon-btn${signOutOpen ? ' hidden' : ''}`}
            onClick={() => openSheet('settings')}
            aria-label="Settings"
          >
            <I.Gear size={16} />
          </button>
          <div className="avatar-wrap">
            <button
              className={`avatar${signOutOpen ? ' hidden' : ''}`}
              aria-label="Account"
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
              <span>Sign out</span>
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
            showToast('Link deleted')
            backFromDetail()
          }
        }}
      />

      <SettingsSheet
        open={sheet === 'settings'}
        user={user}
        domains={domains}
        settings={settings}
        onClose={closeSheets}
        onDomains={setDomains}
        onSettings={setSettings}
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
        <div className="qr-full-hint">Tap anywhere to close</div>
      </div>

      <div className={`toast${toast ? ' on' : ''}${toast?.bad ? ' bad' : ''}`} role="status">
        {toast?.text}
      </div>
    </>
  )
}

function SignIn({ error }: { error: string | null }) {
  return (
    <div id="app">
      <div className="view on">
        <div className="plate">
          <span className="mark">
            <I.Key size={24} />
          </span>
          <h1>Collines Go</h1>
          <p>Sign in with the account that has been granted access.</p>
          <button className="big-act" onClick={() => { window.location.href = '/auth/login' }}>
            <I.Key size={18} />
            Continue with PocketID
          </button>
          {error && <div className="fine" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="fine">
            There is nothing to sign up for. Access is granted in your identity provider,
            and revoked there too.
          </div>
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
