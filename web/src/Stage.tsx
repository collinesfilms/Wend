import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, ApiError, type Domain, type Link, type Settings } from './api'
import { copyText, isUrl, readClipboard, suggestPassword } from './clipboard'
import { dayMonth, expiryPresets, expiryToDate, type ExpiryKey } from './format'
import { t } from './i18n'
import * as I from './icons'
import { draw as drawQr } from './qr'
import { saveQr } from './qrfile'

type Step = 'empty' | 'captured' | 'options' | 'result' | 'qr'
type Division = 'pill' | 'spread'
type PanelKey = 'slug' | 'pass' | 'exp'

const EMPTY_H = 132
const PAD = 32 // stage padding, top + bottom

// A cell is tall enough for a two-line label in every language, not just for
// the one-line English. "Password" fits on a line; "Mot de passe" does not, and
// on a phone the cell is only a third of a narrow screen. Sizing every cell for
// two lines keeps the three of them identical whatever they are called, which
// shrinking the type to fit would not.
const CELL_TOP = 50 // clear of the captured-URL header
const CELL_H = 98
const COMPOSE_H = CELL_TOP + CELL_H

// Shorten is not one of these: it is the bar under the card. What divides is
// the set of things you can change about the link before you make it.
const CELL_ORDER = ['slug', 'pass', 'exp'] as const

/** Where a cell sits at each stage of the division. */
function cellPos(i: number, division: Division, offset = 0): React.CSSProperties {
  if (division === 'pill') {
    return { top: 0, left: 0, width: '100%', height: EMPTY_H }
  }
  const width = 'calc((100% - 20px) / 3)'
  const left =
    i === 0 ? 0 : i === 1 ? 'calc((100% - 20px) / 3 + 10px)' : 'calc((100% - 20px) / 3 * 2 + 20px)'
  return { top: CELL_TOP + offset, left, width, height: CELL_H }
}

const DUPE_H = 48 // the note plus its gap

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

type Props = {
  domains: Domain[]
  settings: Settings
  onCreated: (link: Link) => void
  onOpenDetail: (id: number) => void
  onToast: (message: string, bad?: boolean) => void
  onShowQrFull: (link: Link) => void
}

export function Stage({ domains, settings, onCreated, onOpenDetail, onToast, onShowQrFull }: Props) {
  const [step, setStep] = useState<Step>('empty')
  const [division, setDivision] = useState<Division>('pill')
  const [divided, setDivided] = useState(false)
  const [labelled, setLabelled] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const [password, setPassword] = useState<string | null>(null)
  const [expiry, setExpiry] = useState<{ key: string; label: string; at: Date } | null>(null)
  const [panel, setPanel] = useState<PanelKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Link | null>(null)
  const [copied, setCopied] = useState<{ ok: boolean; text: string } | null>(null)
  const [stageH, setStageH] = useState(EMPTY_H)
  const [dupe, setDupe] = useState<Link | null>(null)

  const alive = useRef(true)
  const dupeRef = useRef<Link | null>(null)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => { dupeRef.current = dupe }, [dupe])

  const panelRefs = {
    slug: useRef<HTMLDivElement>(null),
    pass: useRef<HTMLDivElement>(null),
    exp: useRef<HTMLDivElement>(null),
  }
  const resultRef = useRef<HTMLDivElement>(null)
  const qrRef = useRef<HTMLDivElement>(null)
  const qrCanvas = useRef<HTMLCanvasElement>(null)
  const slugInput = useRef<HTMLInputElement>(null)

  const domain = domains.find((d) => d.is_default) ?? domains[0]
  const host = domain?.host ?? ''

  // ------------------------------------------------------------ capture

  const divide = useCallback(async () => {
    setDivision('pill')
    await nextFrame()
    if (!alive.current) return
    setStageH(COMPOSE_H + (dupeRef.current ? DUPE_H : 0))
    setDivided(true)
    setDivision('spread')
    await wait(230)
    if (!alive.current) return
    setLabelled(true)
    setStep('options')
  }, [])

  const capture = useCallback(
    (raw: string) => {
      if (!isUrl(raw)) return
      const clean = raw.trim()
      setUrl(clean)
      setStep('captured')
      // Making a second link to the same place is rarely what anyone wants, so
      // say it already exists and offer the one that does.
      void api
        .findByDest(clean)
        .then((found) => { if (alive.current) setDupe(found) })
        .catch(() => {})
      window.setTimeout(() => { if (alive.current) void divide() }, 430)
    },
    [divide],
  )

  // Auto-paste works where the browser grants clipboard reads without a gesture.
  // Everywhere else nothing happens and the button takes over, so the failure is
  // invisible.
  useEffect(() => {
    if (!settings.auto_paste) return
    let cancelled = false
    void readClipboard().then((text) => {
      if (!cancelled && isUrl(text)) capture(text)
    })
    return () => { cancelled = true }
  }, [capture, settings.auto_paste])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (step !== 'empty') return
      const text = e.clipboardData?.getData('text')
      if (isUrl(text)) {
        e.preventDefault()
        capture(text)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [capture, step])

  const onPasteClick = async () => {
    const text = await readClipboard(600)
    if (isUrl(text)) capture(text)
    else onToast(t('toast.nothing_to_paste'), true)
  }

  // Reusing lands on exactly the same result screen a fresh link would.
  const useExisting = async (link: Link) => {
    setDupe(null)
    setCreated(link)
    setStep('result')
    setSlug(link.slug)
    const ok = settings.auto_copy ? await copyText(link.short_url) : false
    if (!alive.current) return
    setCopied({
      ok,
      text: ok ? t('result.copied') : t('result.copy_prompt'),
    })
  }

  const reset = () => {
    setStep('empty')
    setDivision('pill')
    setDivided(false)
    setLabelled(false)
    setUrl(null)
    setSlug(null)
    setPassword(null)
    setExpiry(null)
    setPanel(null)
    setCreated(null)
    setCopied(null)
    setDupe(null)
    setStageH(EMPTY_H)
  }

  // ------------------------------------------------------------ panels

  const openPanel = (key: PanelKey) => {
    if (step !== 'options') return
    if (key === 'pass' && !passDraft) setPassDraft(suggestPassword())
    setPanel(key)
  }
  const closePanel = () => {
    setPanel(null)
    setStageH(COMPOSE_H + (dupe ? DUPE_H : 0))
  }

  // The expiry panel grows when the custom date appears. Watching the panel
  // keeps the card and the expanded cell exactly as tall as their content
  // instead of clipping it.
  useLayoutEffect(() => {
    if (!panel) return
    const el = panelRefs[panel].current
    if (!el) return
    const sync = () => setStageH(el.offsetHeight)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [panel])

  useEffect(() => {
    if (panel === 'slug') window.setTimeout(() => slugInput.current?.focus(), 320)
  }, [panel])

  // ------------------------------------------------------------ creation

  const shorten = async () => {
    if (!url || busy || !domain) return
    setBusy(true)
    setPanel(null)
    try {
      // Auto-copy is handed a promise, so on Safari the gesture that triggered
      // Shorten survives the server round trip.
      const request = api.createLink({
        dest: url,
        slug: slug ?? undefined,
        domain_id: domain.id,
        password: password ?? undefined,
        expires_at: expiry ? expiry.at.toISOString() : null,
      })
      let copyOk: Promise<boolean> | null = null
      if (settings.auto_copy) {
        copyOk = copyText(request.then((l) => l.short_url))
      }
      const link = await request
      if (!alive.current) return
      setCreated(link)
      setStep('result')
      onCreated(link)
      const ok = copyOk ? await copyOk : false
      if (!alive.current) return
      setCopied({
        ok,
        text: ok ? t('result.copied') : t('result.copy_prompt'),
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('toast.create_failed')
      onToast(message, true)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  useLayoutEffect(() => {
    if (step === 'result' && resultRef.current) setStageH(resultRef.current.offsetHeight)
    if (step === 'qr' && qrRef.current) setStageH(qrRef.current.offsetHeight)
  }, [step, copied])

  const copyAgain = async () => {
    if (!created) return
    const ok = await copyText(created.short_url)
    setCopied(null)
    window.setTimeout(() => {
      if (!alive.current) return
      setCopied({
        ok,
        text: ok ? t('result.copied') : t('toast.clipboard_blocked'),
      })
    }, 140)
  }

  const downloadQr = async () => {
    if (!created) return
    const outcome = await saveQr(created.short_url, created.slug)
    // A share sheet says its own piece; only the silent paths need a word.
    if (outcome === 'downloaded') onToast(t('toast.qr_saved'))
    if (outcome === 'failed') onToast(t('toast.qr_failed'), true)
  }

  const showQr = () => {
    setStep('qr')
    window.requestAnimationFrame(() => {
      if (qrCanvas.current && created) drawQr(qrCanvas.current, created.short_url, 176)
      if (qrRef.current) setStageH(qrRef.current.offsetHeight)
    })
  }

  // ------------------------------------------------------------ drafts

  const [slugDraft, setSlugDraft] = useState('')
  const [slugState, setSlugState] = useState<{ tone: '' | 'ok' | 'bad'; text: string; busy: boolean }>(
    { tone: '', text: t('slugcheck.hint_charset'), busy: false },
  )
  const [passDraft, setPassDraft] = useState('')
  const [passVisible, setPassVisible] = useState(true)
  const [expDraft, setExpDraft] = useState<ExpiryKey | 'custom' | null>(null)
  const [expCustom, setExpCustom] = useState('')

  // Availability is checked while typing, so a collision never surfaces only at
  // the moment of submitting.
  useEffect(() => {
    const value = slugDraft.trim().toLowerCase()
    if (!value) {
      setSlugState({ tone: '', text: t('slugcheck.hint_empty'), busy: false })
      return
    }
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
      setSlugState({ tone: 'bad', text: t('slugcheck.invalid'), busy: false })
      return
    }
    setSlugState({ tone: '', text: t('slugcheck.checking'), busy: true })
    const timer = window.setTimeout(async () => {
      if (!domain) return
      try {
        const res = await api.checkSlug(value, domain.id)
        if (!alive.current) return
        if (res.available)
          setSlugState({ tone: 'ok', text: t('slugcheck.free', { url: `${host}/${value}` }), busy: false })
        else if (res.reason === 'reserved')
          setSlugState({ tone: 'bad', text: t('slugcheck.reserved'), busy: false })
        else setSlugState({ tone: 'bad', text: t('slugcheck.taken'), busy: false })
      } catch {
        if (alive.current) setSlugState({ tone: '', text: t('slugcheck.failed'), busy: false })
      }
    }, 380)
    return () => window.clearTimeout(timer)
  }, [slugDraft, domain, host])

  const cellValue = (key: (typeof CELL_ORDER)[number]) => {
    switch (key) {
      case 'slug':
        return slug ? `/${slug}` : t('cell.slug.auto')
      case 'pass':
        return password ? '•'.repeat(Math.min(9, password.length)) : t('cell.password.off')
      case 'exp':
        return expiry ? expiry.label : t('cell.expires.never')
    }
  }

  const cellActive = (key: (typeof CELL_ORDER)[number]) =>
    (key === 'slug' && !!slug) || (key === 'pass' && !!password) || (key === 'exp' && !!expiry)

  const cellsHidden = step === 'result' || step === 'qr'
  const showHead = (step === 'options' || step === 'captured') && division !== 'pill' && !panel

  return (
    <div className="stage-wrap">
    <div className="stage" style={{ height: stageH + PAD }}>
      <div className="stage-body">
        <button
          className={`bigbtn${step !== 'empty' && step !== 'captured' ? ' gone' : ''}${
            step === 'captured' ? '' : ''
          }`}
          style={step === 'captured' && division !== 'pill' ? { opacity: 0, pointerEvents: 'none' } : undefined}
          onClick={onPasteClick}
        >
          <span className="glyph">
            <I.Paste size={20} />
          </span>
          <span className="lbl">{step === 'captured' && url ? hostOf(url) : t('stage.paste')}</span>
          <span className="hint">
            {step === 'captured' ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{t('stage.ready')}</span>
            ) : (
              <>
                {t('stage.paste.hint_prefix')} <kbd>{isMac() ? '⌘V' : 'Ctrl V'}</kbd>
              </>
            )}
          </span>
        </button>

        <div className={`urlhead${showHead ? ' on' : ''}`}>
          <span className="fav" />
          <span className="txt">{url ? <UrlLabel url={url} /> : null}</span>
          <button className="x" onClick={reset} aria-label={t('stage.clear')}>
            <I.X size={14} width={2} />
          </button>
        </div>

        <div className={`dupe-note${showHead && dupe ? ' on' : ''}`} style={{ top: 48 }}>
          <span className="txt">{t('stage.dupe', { slug: dupe?.slug ?? '' })}</span>
          <button className="use" onClick={() => dupe && useExisting(dupe)}>
            {t('stage.dupe.use')}
          </button>
        </div>

        {CELL_ORDER.map((key, i) => (
          <button
            key={key}
            className={[
              'cell',
              `c-${key}`,
              division !== 'pill' || step === 'options' ? 'live' : '',
              divided ? 'divided' : '',
              labelled ? 'labelled' : '',
              cellActive(key) ? 'active' : '',
              panel === key ? 'expanded' : '',
            ].filter(Boolean).join(' ')}
            style={{
              ...(panel === key
                ? { top: 0, left: 0, width: '100%', height: stageH }
                : cellPos(i, division, dupe ? DUPE_H : 0)),
              ...(cellsHidden || (panel && panel !== key)
                ? { opacity: 0, pointerEvents: 'none' as const }
                : null),
              ...(step === 'empty' ? { opacity: 0, pointerEvents: 'none' as const } : null),
            }}
            onClick={() => openPanel(key)}
          >
            <span className="cell-face">
              <span className="top">
                <span className="ico">
                  {key === 'slug' ? <I.Pencil size={19} /> : null}
                  {key === 'pass' ? <I.Lock size={19} /> : null}
                  {key === 'exp' ? <I.Clock size={19} /> : null}
                </span>
              </span>
              <span className="bot">
                <span className="name">
                  {key === 'slug' && t('cell.slug')}
                  {key === 'pass' && t('cell.password')}
                  {key === 'exp' && t('cell.expires')}
                </span>
                <span className="val">{cellValue(key)}</span>
              </span>
            </span>
          </button>
        ))}

        {/* ---------------- slug ---------------- */}
        <div
          ref={panelRefs.slug}
          className={`panel${panel === 'slug' ? ' on' : ''}`}
          style={{ ['--accent' as string]: 'var(--moss)', ['--accent-glow' as string]: 'var(--moss-glow)' }}
        >
          <div className="panel-head">
            <span className="ico" style={{ color: 'var(--moss)' }}><I.Pencil size={17} width={1.8} /></span>
            <h3>{t('panel.slug.title')}</h3>
          </div>
          <div className="panel-body">
            <div className="field">
              <span className="prefix">{host}/</span>
              <input
                ref={slugInput}
                value={slugDraft}
                onChange={(e) => setSlugDraft(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                placeholder="x7kq2"
                maxLength={24}
              />
              <button
                className="act"
                aria-label={t('panel.slug.regenerate')}
                onClick={() => setSlugDraft(randomCode(settings.slug_length))}
              >
                <I.Cycle size={15} width={1.8} />
              </button>
            </div>
            <div className={`field-note${slugState.tone ? ` ${slugState.tone}` : ''}`}>
              {slugState.busy && <span className="spin" />}
              {slugState.text}
            </div>
          </div>
          <div className="panel-acts">
            <button className="pa-ghost" onClick={closePanel}>{t('panel.cancel')}</button>
            <button
              className="pa-main"
              style={{ background: 'var(--moss)' }}
              disabled={slugState.tone === 'bad' || slugState.busy}
              onClick={() => {
                setSlug(slugDraft.trim().toLowerCase() || null)
                closePanel()
              }}
            >
              {slugDraft.trim() ? t('panel.slug.use') : t('panel.slug.use_random')}
            </button>
          </div>
        </div>

        {/* ---------------- password ---------------- */}
        <div
          ref={panelRefs.pass}
          className={`panel${panel === 'pass' ? ' on' : ''}`}
          style={{ ['--accent' as string]: 'var(--slate)', ['--accent-glow' as string]: 'var(--slate-glow)' }}
        >
          <div className="panel-head">
            <span className="ico" style={{ color: 'var(--slate)' }}><I.Lock size={17} width={1.8} /></span>
            <h3>{t('panel.password.title')}</h3>
          </div>
          <div className="panel-body">
            <div className="field">
              <input
                type={passVisible ? 'text' : 'password'}
                value={passDraft}
                onChange={(e) => setPassDraft(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                placeholder={t('panel.password.placeholder')}
              />
              <button
                className="act"
                aria-label={passVisible ? t('panel.password.hide') : t('panel.password.show')}
                onClick={() => setPassVisible((v) => !v)}
              >
                {passVisible ? <I.EyeOff size={15} width={1.8} /> : <I.Eye size={15} width={1.8} />}
              </button>
              <button
                className="act"
                aria-label={t('panel.password.suggest')}
                onClick={() => { setPassDraft(suggestPassword()); setPassVisible(true) }}
              >
                <I.Cycle size={15} width={1.8} />
              </button>
            </div>
            <div className="field-note">{t('panel.password.note')}</div>
          </div>
          <div className="panel-acts">
            <button className="pa-ghost" onClick={closePanel}>{t('panel.cancel')}</button>
            {password && (
              <button
                className="pa-clear"
                onClick={() => { setPassword(null); setPassDraft(''); closePanel() }}
              >
                {t('panel.password.remove')}
              </button>
            )}
            <button
              className="pa-main"
              style={{ background: 'var(--slate)' }}
              disabled={!passDraft.trim()}
              onClick={() => { setPassword(passDraft.trim() || null); closePanel() }}
            >
              {t('panel.password.protect')}
            </button>
          </div>
        </div>

        {/* ---------------- expiry ---------------- */}
        <div
          ref={panelRefs.exp}
          className={`panel${panel === 'exp' ? ' on' : ''}`}
          style={{ ['--accent' as string]: 'var(--ochre)', ['--accent-glow' as string]: 'var(--ochre-glow)' }}
        >
          <div className="panel-head">
            <span className="ico" style={{ color: 'var(--ochre)' }}><I.Clock size={17} width={1.8} /></span>
            <h3>{t('panel.expiry.title')}</h3>
          </div>
          <div className="panel-body">
            <div className="chips">
              {expiryPresets().map((p) => (
                <button
                  key={p.key}
                  className={expDraft === p.key ? 'sel' : ''}
                  onClick={() => setExpDraft(p.key)}
                >
                  {p.label}
                </button>
              ))}
              <button className={expDraft === 'custom' ? 'sel' : ''} onClick={() => setExpDraft('custom')}>
                {t('panel.expiry.pick_date')}
              </button>
            </div>
            <div className={`custom-date${expDraft === 'custom' ? ' on' : ''}`}>
              <input
                type="datetime-local"
                value={expCustom}
                onChange={(e) => setExpCustom(e.target.value)}
              />
            </div>
            <div className="field-note">{t('panel.expiry.note')}</div>
          </div>
          <div className="panel-acts">
            <button className="pa-ghost" onClick={closePanel}>{t('panel.cancel')}</button>
            {expiry && (
              <button className="pa-clear" onClick={() => { setExpiry(null); setExpDraft(null); closePanel() }}>
                {t('panel.expiry.never')}
              </button>
            )}
            <button
              className="pa-main"
              style={{ background: 'var(--ochre)' }}
              disabled={!expDraft || (expDraft === 'custom' && !expCustom)}
              onClick={() => {
                if (expDraft === 'custom') {
                  const at = new Date(expCustom)
                  if (Number.isNaN(at.getTime())) return
                  setExpiry({ key: 'custom', label: t('panel.expiry.on_date', { date: dayMonth(at) }), at })
                } else if (expDraft) {
                  const preset = expiryPresets().find((p) => p.key === expDraft)!
                  setExpiry({ key: expDraft, label: preset.short, at: expiryToDate(expDraft) })
                }
                closePanel()
              }}
            >
              {t('panel.expiry.set')}
            </button>
          </div>
        </div>

        {/* ---------------- result ---------------- */}
        <div ref={resultRef} className={`result${step === 'result' ? ' on' : ''}`}>
          <div className="link-plate">
            <span className="notch l" aria-hidden="true" />
            <span className="notch r" aria-hidden="true" />
            <i className="perf" aria-hidden="true" />
            <span className="top">
              <span className="short">
                {created ? `${created.host}/` : ''}
                <b>{created ? mintChars(created.slug) : null}</b>
              </span>
            </span>
            <span className="foot">
              <span
                className={`copied${copied ? ' on' : ''}${copied?.ok ? ' ok' : ''}`}
                style={copied && !copied.ok ? { color: 'var(--ink-3)' } : undefined}
              >
                {copied?.ok && <I.Check size={12} width={2.4} />}
                <span className="txt">{copied?.text}</span>
              </span>
            </span>
          </div>
          <div className="result-acts">
            <button className="ra-copy" onClick={() => void copyAgain()}>
              <I.Copy size={16} width={1.8} />
              {t('result.copy')}
            </button>
            <button className="ra-side" aria-label={t('result.qr')} onClick={showQr}>
              <I.Qr size={17} width={1.7} />
            </button>
            <button
              className="ra-side"
              aria-label={t('result.edit')}
              onClick={() => created && onOpenDetail(created.id)}
            >
              <I.Tune size={17} width={1.8} />
            </button>
          </div>
          <div className="result-meta">
            {slug && <span className="tag slug-t"><I.Pencil size={11} width={2} />{t('result.tag.slug')}</span>}
            {password && <span className="tag pass-t"><I.Lock size={11} width={2} />{t('result.tag.password')}</span>}
            {expiry && <span className="tag exp-t"><I.Clock size={11} width={2} />{expiry.label}</span>}
            {!slug && !password && !expiry && (
              <span className="tag">{t('result.tag.plain')}</span>
            )}
          </div>
          <div className="result-new">
            <button onClick={reset}>
              <I.Plus size={13} width={2} />
              {t('result.again')}
            </button>
          </div>
        </div>

        {/* ---------------- QR ---------------- */}
        <div ref={qrRef} className={`qr-view${step === 'qr' ? ' on' : ''}`}>
          <div className="qr-card">
            <canvas ref={qrCanvas} width={168} height={168} />
          </div>
          <div className="qr-url">
            {created ? `${created.host}/` : ''}
            <b>{created?.slug}</b>
          </div>
          <div className="qr-acts">
            <button className="ra-ghost" onClick={() => setStep('result')}>{t('qr.back')}</button>
            <button
              className="ra-side"
              aria-label={t('qr.download.aria')}
              onClick={() => void downloadQr()}
            >
              <I.Download size={17} width={1.8} />
            </button>
            <button className="ra-main" onClick={() => created && onShowQrFull(created)}>
              {t('qr.fullscreen')}
            </button>
          </div>
        </div>
      </div>
    </div>

      <button
        className={`shorten-bar${step === 'options' && !panel ? ' on' : ''}`}
        disabled={busy}
        onClick={() => void shorten()}
      >
        <I.Bolt size={18} />
        {busy ? t('shorten.busy') : t('shorten')}
      </button>
    </div>
  )
}

function mintChars(slug: string) {
  return slug.split('').map((ch, i) => (
    <i key={`${ch}-${i}`} style={{ ['--i' as string]: i }}>
      {ch}
    </i>
  ))
}

function UrlLabel({ url }: { url: string }) {
  try {
    const u = new URL(url)
    return (
      <>
        <b>{u.host.replace(/^www\./, '')}</b>
        {u.pathname === '/' ? '' : u.pathname}
        {u.search}
      </>
    )
  } catch {
    return <b>{url}</b>
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return t('stage.link_ready')
  }
}

function isMac() {
  return /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)
}

function randomCode(length: number) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}
