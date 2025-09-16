const DEFAULT_IMAGE_BASE = 'https://image.pollinations.ai';
const DEFAULT_TEXT_BASE = 'https://text.pollinations.ai';

export class PolliClient {
  constructor({
    fetch: fetchImpl,
    imageBase = DEFAULT_IMAGE_BASE,
    textBase = DEFAULT_TEXT_BASE,
    timeoutMs = 60_000,
    auth,
    referrer,
    token,
    tokenProvider,
    defaultHeaders = {},
  } = {}) {
    const impl = fetchImpl ?? globalThis.fetch;
    if (typeof impl !== 'function') {
      throw new Error('PolliClient requires a fetch implementation');
    }
    this.fetch = (...args) => impl(...args);
    this.imageBase = stripTrailingSlash(imageBase);
    this.textBase = stripTrailingSlash(textBase);
    this.timeoutMs = timeoutMs;
    this.defaultHeaders = { ...defaultHeaders };
    this._auth = resolveAuth({ auth, referrer, token, tokenProvider });
  }

  get authMode() {
    return this._auth.mode;
  }

  get referrer() {
    return this._auth.referrer ?? null;
  }

  get tokenPlacement() {
    return this._auth.mode === 'token' ? this._auth.placement : null;
  }

  async get(url, { params = {}, headers = {}, includeReferrer = true, timeoutMs } = {}) {
    const finalHeaders = { ...this.defaultHeaders, ...(headers || {}) };
    const u = new URL(url);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value == null) continue;
      u.searchParams.set(key, String(value));
    }
    await applyAuthToGet(this, u, finalHeaders, includeReferrer !== false);
    const { signal, cancel } = this._createAbort(timeoutMs);
    try {
      const init = { method: 'GET', headers: finalHeaders };
      if (signal) init.signal = signal;
      return await this.fetch(u.toString(), init);
    } finally {
      cancel();
    }
  }

  async postJson(url, body, { headers = {}, params = {}, includeReferrer = true, timeoutMs } = {}) {
    const finalHeaders = { 'Content-Type': 'application/json', ...this.defaultHeaders, ...(headers || {}) };
    const u = new URL(url);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value == null) continue;
      u.searchParams.set(key, String(value));
    }
    const payload = body ? { ...body } : {};
    await applyAuthToPost(this, u, finalHeaders, payload, includeReferrer !== false);
    const json = JSON.stringify(payload);
    const { signal, cancel } = this._createAbort(timeoutMs);
    try {
      const init = { method: 'POST', headers: finalHeaders, body: json };
      if (signal) init.signal = signal;
      return await this.fetch(u.toString(), init);
    } finally {
      cancel();
    }
  }

  async getSignedUrl(url, { params = {}, includeReferrer = true, includeToken = false, tokenPlacement } = {}) {
    const u = new URL(url);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value == null) continue;
      u.searchParams.set(key, String(value));
    }
    const auth = this._auth;
    if (includeReferrer !== false && auth.referrer && !u.searchParams.has('referrer')) {
      u.searchParams.set('referrer', auth.referrer);
    }
    if (includeToken && auth.mode === 'token') {
      const placement = normalizePlacement(tokenPlacement ?? auth.placement);
      if (placement !== 'query') {
        throw new Error('Token can only be embedded into a URL when placement is "query"');
      }
      const token = await auth.getToken();
      if (token) u.searchParams.set('token', token);
    }
    return u.toString();
  }

  _createAbort(timeoutOverride) {
    const timeout = timeoutOverride ?? this.timeoutMs;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      return { signal: undefined, cancel: () => {} };
    }
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return {
      signal: controller.signal,
      cancel: () => clearTimeout(id),
    };
  }
}

let defaultClient = null;

export function getDefaultClient() {
  return (defaultClient ??= new PolliClient());
}

export function setDefaultClient(client) {
  defaultClient = client;
  return client;
}

function stripTrailingSlash(value) {
  if (!value) return value;
  let out = value;
  while (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

function inferReferrer() {
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    if (typeof document !== 'undefined' && document.location?.origin) {
      return document.location.origin;
    }
  } catch {
    // ignore access errors
  }
  return null;
}

function resolveAuth({ auth, referrer, token, tokenProvider } = {}) {
  const fallbackReferrer = referrer ?? inferReferrer();
  if (auth) {
    if (auth.mode === 'none') {
      return { mode: 'none', referrer: null };
    }
    if (auth.mode === 'referrer') {
      const ref = auth.referrer ?? fallbackReferrer;
      if (!ref) throw new Error('Referrer authentication requires a referrer string');
      return { mode: 'referrer', referrer: String(ref) };
    }
    if (auth.mode === 'token') {
      const provider = normalizeTokenProvider(auth.getToken ?? auth.token ?? tokenProvider ?? token);
      if (!provider) throw new Error('Token authentication requires a token or provider');
      return {
        mode: 'token',
        getToken: provider,
        placement: normalizePlacement(auth.placement),
        referrer: auth.referrer ?? fallbackReferrer ?? null,
      };
    }
    throw new Error(`Unsupported auth.mode: ${auth.mode}`);
  }

  if (tokenProvider || token) {
    const provider = normalizeTokenProvider(tokenProvider ?? token);
    if (!provider) throw new Error('Token authentication requires a token or provider');
    return {
      mode: 'token',
      getToken: provider,
      placement: 'header',
      referrer: fallbackReferrer ?? null,
    };
  }

  if (fallbackReferrer) {
    return { mode: 'referrer', referrer: String(fallbackReferrer) };
  }

  return { mode: 'none', referrer: null };
}

function normalizeTokenProvider(source) {
  if (!source) return null;
  if (typeof source === 'function') {
    return async () => extractToken(await source());
  }
  return async () => extractToken(source);
}

function extractToken(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && 'token' in value) {
    return extractToken(value.token);
  }
  return String(value);
}

function normalizePlacement(value) {
  if (!value) return 'header';
  const normalized = String(value).toLowerCase();
  if (normalized === 'header' || normalized === 'query' || normalized === 'body') {
    return normalized;
  }
  throw new Error(`Unsupported token placement: ${value}`);
}

function hasAuthHeader(headers) {
  if (!headers) return false;
  return Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
}

async function applyAuthToGet(client, url, headers, includeReferrer) {
  const auth = client._auth;
  if (includeReferrer && auth.referrer && !url.searchParams.has('referrer')) {
    url.searchParams.set('referrer', auth.referrer);
  }
  if (auth.mode === 'token') {
    const token = await auth.getToken();
    if (!token) return;
    const placement = normalizePlacement(auth.placement);
    if (placement === 'header') {
      if (!hasAuthHeader(headers)) headers['Authorization'] = `Bearer ${token}`;
    } else {
      if (!url.searchParams.has('token')) url.searchParams.set('token', token);
    }
  }
}

async function applyAuthToPost(client, url, headers, payload, includeReferrer) {
  const auth = client._auth;
  if (includeReferrer && auth.referrer && payload.referrer == null) {
    payload.referrer = auth.referrer;
  }
  if (auth.mode === 'token') {
    const token = await auth.getToken();
    if (!token) return;
    const placement = normalizePlacement(auth.placement);
    if (placement === 'header') {
      if (!hasAuthHeader(headers)) headers['Authorization'] = `Bearer ${token}`;
    } else if (placement === 'query') {
      if (!url.searchParams.has('token')) url.searchParams.set('token', token);
    } else {
      if (payload.token == null) payload.token = token;
    }
  }
}
