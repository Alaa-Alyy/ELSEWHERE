// Single API adapter for the whole UI. Switching fixtures <-> real backend is a
// config change only: VITE_USE_FIXTURES=true|false (see .env.example).
import { ApiError } from './errors.js';

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === 'true';
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);

async function request(path, { method = 'GET', query, body, signal, timeoutMs = TIMEOUT_MS } = {}) {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) ctrl.abort();

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (timedOut) throw new ApiError({ code: 'timeout', message: 'Request timed out', retryable: true });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new ApiError({ code: 'network_error', message: 'Network error', retryable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError({
      status: res.status,
      code: e?.code || `http_${res.status}`,
      message: e?.message || res.statusText || 'Request failed',
      retryable: e?.retryable ?? res.status >= 500,
    });
  }
  if (data === null) throw new ApiError({ status: res.status, code: 'invalid_response', message: 'Server returned no JSON' });
  return data;
}

// Send IDs and settings only, never client-side scores.
export const realApi = {
  isMock: false,
  getHealth: (o = {}) => request('/api/health', o),
  getReferences: (o = {}) => request('/api/references', o),
  getParents: (o = {}) => request('/api/parents', o),
  getSources: (o = {}) => request('/api/sources', o),
  getCandidate: (id, o = {}) => request(`/api/candidates/${encodeURIComponent(id)}`, o),
  getRankings: ({ reference_id, profile, slope_weight = null, top_k = 3 }, o = {}) =>
    request('/api/rankings', { ...o, query: { reference_id, profile, slope_weight, top_k } }),
  postDecision: ({ reference_id, profile, slope_weight = null, selected_candidate_id, alternative_candidate_id = null, ...disc }, o = {}) =>
    request('/api/decision', { ...o, method: 'POST', body: { reference_id, profile, slope_weight, selected_candidate_id, alternative_candidate_id, ...discoveryFields(disc) } }),
  postChat: ({ message, reference_id, profile, slope_weight = null, selected_candidate_id = null, alternative_candidate_id = null, history = [], ...disc }, o = {}) =>
    request('/api/chat', {
      ...o,
      method: 'POST',
      timeoutMs: 30000,
      body: { message, reference_id, profile, slope_weight, selected_candidate_id, alternative_candidate_id, history, ...discoveryFields(disc) },
    }),
  // ---- discovery mode (additive endpoints)
  createPin: ({ body, lat, lon }, o = {}) =>
    request('/api/pins', { ...o, method: 'POST', timeoutMs: 60000, body: { body, lat, lon } }),
  getDiscover: ({ reference_id, profile, slope_weight = null, top_k = 5, min_center_distance_km = 100, exclude_known = false }, o = {}) =>
    request('/api/discover', { ...o, timeoutMs: 60000, query: { reference_id, profile, slope_weight, top_k, min_center_distance_km, exclude_known } }),
  getGlobalCandidate: (id, o = {}) => request(`/api/global-candidates/${encodeURIComponent(id)}`, o),
};

// Only send discovery fields in global mode; curated requests keep the original v2 body.
function discoveryFields({ mode, top_k, min_center_distance_km, exclude_known } = {}) {
  if (mode !== 'global') return {};
  return { mode, top_k, min_center_distance_km, exclude_known };
}

let implPromise = null;
function impl() {
  if (!implPromise) {
    implPromise = USE_FIXTURES
      ? import('./mockClient.js').then((m) => m.mockApi)
      : Promise.resolve(realApi);
  }
  return implPromise;
}

const METHODS = ['getHealth', 'getReferences', 'getParents', 'getSources', 'getCandidate', 'getRankings', 'postDecision',
  'postChat', 'createPin', 'getDiscover', 'getGlobalCandidate'];
export const api = Object.fromEntries(
  METHODS.map((m) => [m, (...args) => impl().then((i) => i[m](...args))]),
);

// Previews must be approved backend asset paths (/assets/previews/...) or null.
export function assetUrl(path) {
  if (typeof path !== 'string' || !/^\/assets\/previews\/[\w.-]+\.png$/.test(path)) return null;
  return BASE_URL + path;
}
