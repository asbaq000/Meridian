const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'meridian.token';

export const tokenStore = {
  get() {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode: the session simply does not persist across reloads */
    }
  },
};

/**
 * One error shape for the whole client.
 * `code` is the server's machine-readable code (SLOT_TAKEN,
 * CANCELLATION_CUTOFF_PASSED, ...) so screens can react to *what* went wrong
 * rather than pattern-matching prose.
 */
export class ApiError extends Error {
  constructor(message, { code = 'UNKNOWN', status = 0, details } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, query, auth = true } = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? tokenStore.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Cannot reach the API. Is the server running on ' + BASE + '?', {
      code: 'NETWORK',
    });
  }

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = payload.error ?? {};
    throw new ApiError(e.message ?? `Request failed (${res.status})`, {
      code: e.code,
      status: res.status,
      details: e.details,
    });
  }
  return payload;
}

// ------------------------------------------------------------- endpoints ---
export const auth = {
  login: (email, password) => api('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  register: (data) => api('/api/auth/register', { method: 'POST', body: data, auth: false }),
  me: () => api('/api/auth/me'),
  updateMe: (data) => api('/api/auth/me', { method: 'PATCH', body: data }),
};

export const providers = {
  list: () => api('/api/providers', { auth: false }),
  get: (idOrSlug) => api(`/api/providers/${idOrSlug}`, { auth: false }),
  availability: (idOrSlug) => api(`/api/providers/${idOrSlug}/availability`, { auth: false }),
  slots: (idOrSlug, query) => api(`/api/providers/${idOrSlug}/slots`, { query, auth: false }),
  update: (idOrSlug, body) => api(`/api/providers/${idOrSlug}`, { method: 'PATCH', body }),
  create: (body) => api('/api/providers', { method: 'POST', body }),
  setRules: (idOrSlug, rules) =>
    api(`/api/providers/${idOrSlug}/availability/rules`, { method: 'PUT', body: { rules } }),
  addException: (idOrSlug, body) =>
    api(`/api/providers/${idOrSlug}/availability/exceptions`, { method: 'POST', body }),
  removeException: (idOrSlug, id) =>
    api(`/api/providers/${idOrSlug}/availability/exceptions/${id}`, { method: 'DELETE' }),
};

export const bookings = {
  list: (query) => api('/api/bookings', { query }),
  create: (body) => api('/api/bookings', { method: 'POST', body }),
  cancel: (id, body) => api(`/api/bookings/${id}/cancel`, { method: 'POST', body }),
  reschedule: (id, body) => api(`/api/bookings/${id}/reschedule`, { method: 'POST', body }),
};

export const admin = {
  calendar: (query) => api('/api/admin/calendar', { query }),
  block: (body) => api('/api/admin/blocks', { method: 'POST', body }),
  unblock: (id) => api(`/api/admin/blocks/${id}`, { method: 'DELETE' }),
  overrideCancel: (id, body) => api(`/api/admin/bookings/${id}/override-cancel`, { method: 'POST', body }),
  users: () => api('/api/admin/users'),
  setRole: (id, role) => api(`/api/admin/users/${id}/role`, { method: 'PATCH', body: { role } }),
  emails: () => api('/api/admin/emails'),
  runReminders: () => api('/api/admin/reminders/run', { method: 'POST' }),
};
