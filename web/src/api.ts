// API client. Every /api route needs a session; a 401 simply drops the app
// back to the sign-in screen.

export type Domain = { id: number; host: string; is_default: boolean }

export type Alias = { slug: string; domain_id: number; host: string }

export type Link = {
  id: number
  slug: string
  domain_id: number
  host: string
  short_url: string
  dest: string
  has_password: boolean
  expires_at: string | null
  disabled: boolean
  expired: boolean
  owner_id: string
  created_at: string
  updated_at: string
  last_click_at: string | null
  aliases: Alias[]
  clicks: number
  uniques: number
  series: number[]
}

export type User = { id: string; email: string; name: string }

export type Settings = {
  slug_length: number
  default_expiry: 'never' | '1h' | 'today' | '7d' | '30d'
  auto_copy: boolean
  auto_paste: boolean
}

export type Me = { user: User; domains: Domain[]; settings: Settings }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Erreur ${res.status}`
    throw new ApiError(res.status, message)
  }
  return data as T
}

export const api = {
  me: () => request<Me>('/api/me'),

  links: () => request<Link[]>('/api/links'),

  createLink: (body: {
    dest: string
    slug?: string
    domain_id?: number
    password?: string
    expires_at?: string | null
  }) => request<Link>('/api/links', { method: 'POST', body: JSON.stringify(body) }),

  updateLink: (
    id: number,
    body: { dest?: string; password?: string; expires_at?: string; disabled?: boolean },
  ) => request<Link>(`/api/links/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteLink: (id: number) => request<void>(`/api/links/${id}`, { method: 'DELETE' }),

  addAlias: (id: number, slug: string, domainId?: number) =>
    request<Link>(`/api/links/${id}/aliases`, {
      method: 'POST',
      body: JSON.stringify({ slug, domain_id: domainId ?? 0 }),
    }),

  checkSlug: (slug: string, domainId: number) =>
    request<{ available: boolean; reason: string }>(
      `/api/slug-check?slug=${encodeURIComponent(slug)}&domain_id=${domainId}`,
    ),

  settings: () => request<Settings>('/api/settings'),

  saveSettings: (body: Settings) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),

  addDomain: (host: string) =>
    request<Domain>('/api/domains', { method: 'POST', body: JSON.stringify({ host }) }),

  setDefaultDomain: (id: number) =>
    request<void>(`/api/domains/${id}/default`, { method: 'POST' }),

  deleteDomain: (id: number) => request<void>(`/api/domains/${id}`, { method: 'DELETE' }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),
}
