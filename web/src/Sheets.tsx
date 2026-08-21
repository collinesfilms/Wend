import { useEffect, useState } from 'react'
import { api, ApiError, type Domain, type Link, type Settings, type User } from './api'
import { copyText, suggestPassword } from './clipboard'
import { age, destLabel, EXPIRY_PRESETS, expiryToDate, relative, shortDate, type ExpiryKey } from './format'
import * as I from './icons'

/** Seven days as an area: enough to read the shape, no more. */
function Spark({ series }: { series: number[] }) {
  const max = Math.max(1, ...series)
  const w = 100
  const h = 20
  const step = w / (series.length - 1)
  const pts = series.map((v, i) => [i * step, h - (v / max) * (h - 3) - 1.5] as const)
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `M0,${h} L${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} L${w},${h} Z`
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: h }}
      fill="none"
      aria-hidden="true"
    >
      <path d={area} fill="currentColor" opacity=".14" />
      <polyline
        points={line}
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity=".8"
      />
    </svg>
  )
}

// ---------------------------------------------------------------- list

type LinksSheetProps = {
  open: boolean
  links: Link[]
  onOpenDetail: (id: number) => void
  onClose: () => void
  onQrFull: (link: Link) => void
  onToast: (message: string, bad?: boolean) => void
}

export function LinksSheet({ open, links, onOpenDetail, onClose, onQrFull, onToast }: LinksSheetProps) {
  const [filter, setFilter] = useState<'all' | 'live' | 'expired'>('all')
  const [query, setQuery] = useState('')
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const visible = links.filter((l) => {
    const dead = l.expired || l.disabled
    if (filter === 'live' && dead) return false
    if (filter === 'expired' && !dead) return false
    if (query && !`${l.slug} ${l.dest}`.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  const copyRow = async (link: Link) => {
    const ok = await copyText(link.short_url)
    if (!ok) return onToast('Your browser blocked the clipboard', true)
    setCopiedId(link.id)
    window.setTimeout(() => setCopiedId(null), 900)
  }

  return (
    <div className={`sheet${open ? ' on' : ''}`} role="dialog" aria-label="Links">
      <div className="grip" />
      <div className="sheet-head">
        <h2>Links</h2>
        <span className="n tnum">{links.length}</span>
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <I.X size={16} width={1.9} />
        </button>
      </div>
      <div className="sheet-tools">
        <label className="search">
          <I.Search size={15} width={1.8} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search links"
            autoComplete="off"
          />
        </label>
        <div className="filters">
          {([['all', 'All'], ['live', 'Live'], ['expired', 'Expired']] as const).map(([key, label]) => (
            <button key={key} className={filter === key ? 'sel' : ''} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="rows">
        {visible.length === 0 && (
          <div className="empty-note">
            {links.length === 0 ? 'No links yet.' : 'No links match that.'}
          </div>
        )}
        {visible.map((l) => {
          const dead = l.expired || l.disabled
          return (
            <div
              key={l.id}
              className={`row${dead ? ' expired' : ''}`}
              onClick={() => onOpenDetail(l.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onOpenDetail(l.id)}
            >
              <span className="r-slug">
                <span className="pin" />/{l.slug}
                {l.has_password && <I.Lock size={11} width={2.2} className="pw" />}
              </span>
              <span className="r-dest">{destLabel(l.dest)}</span>
              <span className="r-meta">
                <span className="r-when">{l.disabled ? 'disabled' : relative(l.expires_at)}</span>
                <span className="r-opens">
                  <I.Out size={12} />
                  {l.clicks}
                </span>
              </span>
              <span className="row-acts" onClick={(e) => e.stopPropagation()}>
                <button
                  aria-label="Copy"
                  style={copiedId === l.id ? { color: 'var(--ok)' } : undefined}
                  onClick={() => void copyRow(l)}
                >
                  {copiedId === l.id ? <I.Check size={14} width={2.2} /> : <I.Copy size={14} width={1.8} />}
                </button>
                <button aria-label="QR code" onClick={() => onQrFull(l)}>
                  <I.Qr size={14} width={1.7} />
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One row that turns into a field in place. Browser prompts were a shortcut;
 * this keeps editing inside the sheet, in the app's own shapes.
 */
function InlineEdit({
  label,
  value,
  placeholder,
  mono,
  password,
  hint,
  check,
  onCancel,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  mono?: boolean
  password?: boolean
  hint?: string
  check?: (value: string) => Promise<{ tone: '' | 'ok' | 'bad'; text: string; ok: boolean }>
  onCancel: () => void
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [note, setNote] = useState<{ tone: '' | 'ok' | 'bad'; text: string }>({
    tone: '',
    text: hint ?? '',
  })
  const [ok, setOk] = useState(!check)

  useEffect(() => {
    if (!check) return
    const value = draft.trim()
    if (!value) {
      setOk(false)
      setNote({ tone: '', text: hint ?? '' })
      return
    }
    setOk(false)
    setNote({ tone: '', text: 'Checking' })
    const timer = window.setTimeout(async () => {
      const result = await check(value)
      setNote({ tone: result.tone, text: result.text })
      setOk(result.ok)
    }, 380)
    return () => window.clearTimeout(timer)
  }, [draft, check, hint])

  const disabled = !ok
  return (
    <div className="sec-row" style={{ display: 'grid', gap: 6 }}>
      <span className="k" style={{ gridColumn: '1 / -1' }}>{label}</span>
      <span className="row-edit">
        <input
          autoFocus
          value={draft}
          type={password ? 'text' : 'text'}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          style={mono ? undefined : { fontFamily: 'var(--font)' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !disabled && draft.trim()) onSave(draft.trim())
            if (e.key === 'Escape') onCancel()
          }}
        />
        <button className="mini" style={{ minWidth: 0 }} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="mini accent"
          style={{ minWidth: 0 }}
          disabled={disabled || !draft.trim()}
          onClick={() => onSave(draft.trim())}
        >
          Save
        </button>
      </span>
      {note?.text && <span className={`note ${note.tone}`}>{note.text}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- detail

type DetailSheetProps = {
  open: boolean
  link: Link | null
  from: 'list' | 'direct'
  onBack: () => void
  onChanged: (link: Link | null) => void
  onToast: (message: string, bad?: boolean) => void
}

export function DetailSheet({ open, link, from, onBack, onChanged, onToast }: DetailSheetProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [editing, setEditing] = useState<null | 'dest' | 'pass' | 'alias'>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setConfirmDelete(false)
    setEditing(null)
  }, [link?.id])

  if (!link) return <div className="sheet auto" aria-hidden="true" />

  const act = async (key: string, run: () => Promise<Link | null>) => {
    setPending(key)
    try {
      onChanged(await run())
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'That did not work', true)
    } finally {
      setPending(null)
    }
  }

  const dead = link.expired || link.disabled

  return (
    <div className={`sheet auto${open ? ' on' : ''}`} role="dialog" aria-label="Link detail">
      <div className="grip" />
      <div className="detail-head">
        <button className="back" onClick={onBack} aria-label={from === 'list' ? 'Back to links' : 'Close'}>
          {from === 'list' ? <I.Back size={17} width={1.9} /> : <I.X size={17} width={1.9} />}
        </button>
        <span className="t">
          <span className="s mono">/{link.slug}</span>
          <span className="d">{destLabel(link.dest)}</span>
        </span>
      </div>
      <div className={`detail-body${pending ? ' busy' : ''}`}>
        <div className="stats-strip">
          <div className="stat-tile">
            <div className="k">Opens</div>
            <div className="v">{link.clicks}</div>
            {link.clicks ? <Spark series={link.series} /> : <span className="sub">nothing yet</span>}
          </div>
          <div className="stat-tile">
            <div className="k">People</div>
            <div className="v">{link.uniques}</div>
            <span className="sub">
              {link.clicks ? `${Math.round((link.uniques / link.clicks) * 100)}% of opens` : 'nothing yet'}
            </span>
          </div>
          <div className="stat-tile">
            <div className="k">Created</div>
            <div className="v sm">{shortDate(link.created_at)}</div>
            <span className="sub">{age(link.created_at)}</span>
          </div>
        </div>

        <div className="sec-title">Link</div>
        <div className="sec">
          <div className="sec-row">
            <span className="k">Short link</span>
            <span className="v mono">{link.short_url.replace(/^https:\/\//, '')}</span>
            <button
              className="mini"
              onClick={async () => {
                const ok = await copyText(link.short_url)
                onToast(ok ? 'Link copied' : 'Your browser blocked the clipboard', !ok)
              }}
            >
              Copy
            </button>
          </div>
          {editing === 'dest' ? (
            <InlineEdit
              label="Points to"
              value={link.dest}
              placeholder="https://…"
              onCancel={() => setEditing(null)}
              onSave={(next) => {
                setEditing(null)
                if (next !== link.dest) void act('dest', () => api.updateLink(link.id, { dest: next }))
              }}
            />
          ) : (
            <div className="sec-row">
              <span className="k">Points to</span>
              <span className="v">{destLabel(link.dest)}</span>
              <button className="mini" onClick={() => setEditing('dest')}>Change</button>
            </div>
          )}

          {/* Aliases are chips, not a line of slashes: each one is its own
              thing that can be removed, and adding one is the same field the
              create flow uses. */}
          <div className="sec-row" style={{ display: 'grid', gap: 8 }}>
            <span className="k" style={{ gridColumn: '1 / -1' }}>Extra slugs</span>
            <span className="row-edit" style={{ gridColumn: '1 / -1' }}>
              {link.aliases.length ? (
                <span className="alias-chips" style={{ flex: 1 }}>
                  {link.aliases.map((a) => (
                    <span className="alias-chip" key={a.slug}>
                      /{a.slug}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="v" style={{ flex: 1, color: 'var(--ink-3)' }}>
                  None. Another slug can open the same link.
                </span>
              )}
              <button className="mini accent" style={{ minWidth: 0 }} onClick={() => setEditing('alias')}>
                Add
              </button>
            </span>
          </div>
          {editing === 'alias' && (
            <InlineEdit
              label="New slug for this link"
              value=""
              placeholder="another-slug"
              mono
              hint="Another slug that opens the same link, sharing its stats."
              check={async (value) => {
                try {
                  const res = await api.checkSlug(value, link.domain_id)
                  if (res.available) return { tone: 'ok', text: `/${value} is free.`, ok: true }
                  if (res.reason === 'reserved') return { tone: 'bad', text: 'That slug is reserved.', ok: false }
                  if (res.reason === 'invalid') return { tone: 'bad', text: 'Lowercase letters, numbers and dashes only.', ok: false }
                  return { tone: 'bad', text: 'That one is already in use.', ok: false }
                } catch {
                  return { tone: '', text: 'Could not check that slug.', ok: false }
                }
              }}
              onCancel={() => setEditing(null)}
              onSave={(next) =>
                void act('alias', async () => {
                  const updated = await api.addAlias(link.id, next.toLowerCase())
                  setEditing(null)
                  return updated
                })
              }
            />
          )}
        </div>

        <div className="sec-title">Access</div>
        <div className="sec">
          <div className="sec-row">
            <span className="k">Password</span>
            <span className="v">{link.has_password ? 'On' : 'Off'}</span>
            <button
              className="mini"
              onClick={() => {
                if (link.has_password) {
                  void act('pass', () => api.updateLink(link.id, { password: '' }))
                  return
                }
                setEditing('pass')
              }}
            >
              {link.has_password ? 'Remove' : 'Set'}
            </button>
          </div>
          <div className="sec-row">
            <span className="k">Expires</span>
            <span className="v" style={dead ? { color: 'var(--danger)' } : undefined}>
              {link.disabled ? 'disabled' : relative(link.expires_at)}
            </span>
            <ExpiryButton link={link} dead={dead} onAct={act} />
          </div>
        </div>

        {editing === 'pass' && (
          <div className="sec">
            <InlineEdit
              label="Password for this link"
              value={suggestPassword()}
              placeholder="Choose a password"
              mono
              onCancel={() => setEditing(null)}
              onSave={(next) => {
                setEditing(null)
                void act('pass', () => api.updateLink(link.id, { password: next }))
              }}
            />
          </div>
        )}

        <div className="sec-title">Deletion</div>
        <div className="sec">
          <div className="sec-row wide">
            <span className="v">
              {confirmDelete
                ? 'Confirm: the link stops working immediately.'
                : 'The link stops working and its slug is never handed out again.'}
            </span>
            <button
              className={`mini warn${confirmDelete ? ' armed' : ''}`}
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true)
                void act('delete', async () => {
                  await api.deleteLink(link.id)
                  return null
                })
              }}
            >
              {confirmDelete ? 'Confirm' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExpiryButton({
  link,
  dead,
  onAct,
}: {
  link: Link
  dead: boolean
  onAct: (key: string, run: () => Promise<Link | null>) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button className={`mini${dead ? ' accent' : ''}`} onClick={() => setOpen(true)}>
        {dead ? 'Revive' : 'Change'}
      </button>
    )
  }
  const set = (key: ExpiryKey | 'never') => {
    setOpen(false)
    void onAct('exp', () =>
      api.updateLink(link.id, {
        expires_at: key === 'never' ? '' : expiryToDate(key).toISOString(),
        disabled: false,
      }),
    )
  }
  return (
    <span className="acts" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {EXPIRY_PRESETS.map((p) => (
        <button key={p.key} className="mini" style={{ minWidth: 0 }} onClick={() => set(p.key)}>
          {p.label.replace('In ', '+').replace('End of today', 'tonight')}
        </button>
      ))}
      <button className="mini" style={{ minWidth: 0 }} onClick={() => set('never')}>
        never
      </button>
    </span>
  )
}

// ---------------------------------------------------------------- settings

type SettingsSheetProps = {
  open: boolean
  user: User
  domains: Domain[]
  settings: Settings
  onClose: () => void
  onDomains: (domains: Domain[]) => void
  onSettings: (settings: Settings) => void
  onSignOut: () => void
  onToast: (message: string, bad?: boolean) => void
}

export function SettingsSheet({
  open,
  user,
  domains,
  settings,
  onClose,
  onDomains,
  onSettings,
  onSignOut,
  onToast,
}: SettingsSheetProps) {
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshDomains = async () => {
    const me = await api.me()
    onDomains(me.domains)
  }

  const guard = async (run: () => Promise<void>) => {
    setBusy(true)
    try {
      await run()
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'That did not work', true)
    } finally {
      setBusy(false)
    }
  }

  const save = (next: Settings) =>
    guard(async () => {
      onSettings(await api.saveSettings(next))
    })

  return (
    <div className={`sheet auto${open ? ' on' : ''}`} role="dialog" aria-label="Settings">
      <div className="grip" />
      <div className="detail-head">
        <button className="back" onClick={onClose} aria-label="Close">
          <I.X size={17} width={1.9} />
        </button>
        <span className="t">
          <span className="s">Settings</span>
          <span className="d">{user.email || user.name}</span>
        </span>
      </div>
      <div className={`detail-body${busy ? ' busy' : ''}`}>
        <div className="sec-title">Domains</div>
        <div className="sec set-domains">
          {domains.map((d) => (
            <div className="domain-row" key={d.id}>
              <span className="host">{d.host}</span>
              <span className="tagline">
                {d.is_default ? 'used for new links' : 'available'}
              </span>
              <span className="acts">
                {d.is_default ? (
                  <span className="badge">default</span>
                ) : (
                  <>
                    <button
                      className="mini accent"
                      onClick={() => guard(async () => {
                        await api.setDefaultDomain(d.id)
                        await refreshDomains()
                      })}
                    >
                      Make default
                    </button>
                    <button
                      className="mini warn"
                      style={{ minWidth: 0 }}
                      aria-label={`Remove ${d.host}`}
                      onClick={() => guard(async () => {
                        await api.deleteDomain(d.id)
                        await refreshDomains()
                      })}
                    >
                      <I.Trash size={14} width={1.8} />
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
          <div className="add-domain">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="clns.li"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="mini accent"
              disabled={!host.trim()}
              onClick={() => guard(async () => {
                await api.addDomain(host.trim())
                setHost('')
                await refreshDomains()
                onToast('Domain added. Point it at this server too.')
              })}
            >
              Add
            </button>
          </div>
        </div>
        <p className="empty-note" style={{ padding: '0 2px', textAlign: 'left', fontSize: 11.5 }}>
          A domain added here also has to point at this server and have a certificate.
          Links already made keep the domain they were created on.
        </p>

        <div className="sec-title">New links</div>
        <div className="sec">
          <div className="sec-row">
            <span className="k">Code length</span>
            <span className="v mono">{settings.slug_length} characters</span>
            <span className="acts" style={{ display: 'flex', gap: 6 }}>
              <button
                className="mini"
                style={{ minWidth: 0 }}
                disabled={settings.slug_length <= 4}
                onClick={() => save({ ...settings, slug_length: settings.slug_length - 1 })}
              >
                −
              </button>
              <button
                className="mini"
                style={{ minWidth: 0 }}
                disabled={settings.slug_length >= 12}
                onClick={() => save({ ...settings, slug_length: settings.slug_length + 1 })}
              >
                +
              </button>
            </span>
          </div>
          <div className="sec-row wide" style={{ display: 'block' }}>
            <div className="k" style={{ marginBottom: 8 }}>Default expiry</div>
            <div className="seg">
              {([['never', 'Never'], ['today', 'Tonight'], ['7d', '7 days'], ['30d', '30 days']] as const).map(
                ([key, label]) => (
                  <button
                    key={key}
                    className={settings.default_expiry === key ? 'sel' : ''}
                    onClick={() => save({ ...settings, default_expiry: key })}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className="sec-row">
            <span className="k">Copy after creating</span>
            <span className="v" style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
              The link goes straight to your clipboard.
            </span>
            <button
              className={`switch${settings.auto_copy ? ' on' : ''}`}
              role="switch"
              aria-checked={settings.auto_copy}
              aria-label="Copy after creating"
              onClick={() => save({ ...settings, auto_copy: !settings.auto_copy })}
            />
          </div>
          <div className="sec-row">
            <span className="k">Paste on open</span>
            <span className="v" style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
              Where the browser allows it.
            </span>
            <button
              className={`switch${settings.auto_paste ? ' on' : ''}`}
              role="switch"
              aria-checked={settings.auto_paste}
              aria-label="Paste on open"
              onClick={() => save({ ...settings, auto_paste: !settings.auto_paste })}
            />
          </div>
        </div>

        <div className="sec-title">Account</div>
        <div className="sec">
          <div className="sec-row">
            <span className="k">Signed in</span>
            <span className="v">{user.name || user.email}</span>
            <button className="mini warn" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  )
}
