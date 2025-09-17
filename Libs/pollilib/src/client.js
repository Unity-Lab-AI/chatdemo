const DEFAULT_ENDPOINTS = {
  image: 'https://image.pollinations.ai',
  text: 'https://text.pollinations.ai',
};

export class PolliClient {
  constructor(options = {}) {
    const {
      fetch: fetchImpl,
      imageBase,
      textBase,
      endpoints = {},
      timeoutMs = 60_000,
      auth,
      referrer,
      token,
      tokenProvider,
      defaultHeaders = {},
    } = options ?? {};

    const impl = fetchImpl ?? globalThis.fetch;
    if (typeof impl !== 'function') {
      throw new Error('PolliClient requires a fetch implementation');
    }

    this.fetch = bindFetch(impl);

    const resolvedBases = resolveBases({
      imageBase: imageBase ?? endpoints.image,
      textBase: textBase ?? endpoints.text,
    });

    this.imageBase = resolvedBases.image;
    this.textBase = resolvedBases.text;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000;
    this.defaultHeaders = normalizeHeaderBag(defaultHeaders);
    this._auth = createAuthManager({ auth, referrer, token, tokenProvider });
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

  async get(url, options = {}) {
    return await this._request('GET', url, options);
  }

  async post(url, body, options = {}) {
    return await this._request('POST', url, { ...options, body });
  }

  async postJson(url, body, options = {}) {
    return await this._request('POST', url, { ...options, body, json: true });
  }

  async request(method, url, options = {}) {
    return await this._request(method, url, options);
  }

  async getSignedUrl(
    url,
    { params = {}, includeReferrer = true, includeToken = false, tokenPlacement } = {},
  ) {
    const target = buildUrl(url, params);
    await this._auth.decorateUrl(target, { includeReferrer, includeToken, tokenPlacement });
    return target.toString();
  }

  async _request(
    method,
    url,
    {
      params = {},
      headers = {},
      body,
      json,
      includeReferrer = true,
      includeToken = true,
      tokenPlacement,
      timeoutMs,
    } = {},
  ) {
    const target = buildUrl(url, params);
    const headerBag = mergeHeaders(this.defaultHeaders, headers);

    const payload = cloneBody(body);
    const context = {
      method,
      url: target,
      headers: headerBag,
      body: payload,
      includeReferrer,
      includeToken,
      tokenPlacement,
    };
    await this._auth.apply(context);

    const init = { method, headers: headerBag };
    if (method !== 'GET' && method !== 'HEAD') {
      const preparedBody = prepareBody(payload, headerBag, json);
      if (preparedBody !== undefined) {
        init.body = preparedBody;
      }
    }

    const { signal, cancel } = this._createAbort(timeoutMs);
    if (signal) {
      init.signal = signal;
    }

    try {
      return await this.fetch(target.toString(), init);
    } finally {
      cancel();
    }
  }

  _createAbort(timeoutOverride) {
    const timeout = resolveTimeout(timeoutOverride, this.timeoutMs);
    if (!timeout) {
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

function bindFetch(fn) {
  if (fn === globalThis.fetch) {
    return (...args) => fn(...args);
  }
  if (typeof fn.bind === 'function') {
    return fn.bind(globalThis);
  }
  return (...args) => fn(...args);
}

function resolveBases({ imageBase, textBase }) {
  return {
    image: stripTrailingSlash(imageBase ?? DEFAULT_ENDPOINTS.image),
    text: stripTrailingSlash(textBase ?? DEFAULT_ENDPOINTS.text),
  };
}

function stripTrailingSlash(value) {
  if (!value) return value;
  let out = String(value);
  while (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

function resolveTimeout(override, fallback) {
  const timeout = override ?? fallback;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return 0;
  }
  return timeout;
}

function mergeHeaders(base, extra) {
  const bag = { ...base };
  const additions = normalizeHeaderBag(extra);
  for (const [key, value] of Object.entries(additions)) {
    bag[key] = value;
  }
  return bag;
}

function normalizeHeaderBag(input) {
  if (!input) return {};
  if (input instanceof Headers) {
    const bag = {};
    input.forEach((value, key) => {
      bag[key] = value;
    });
    return bag;
  }
  if (Array.isArray(input)) {
    const bag = {};
    for (const entry of input) {
      if (!entry) continue;
      const [key, value] = entry;
      if (key == null || value == null) continue;
      bag[String(key)] = String(value);
    }
    return bag;
  }
  const bag = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    bag[String(key)] = String(value);
  }
  return bag;
}

function buildUrl(input, params) {
  const url = input instanceof URL ? new URL(input.toString()) : createUrl(String(input));
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function createUrl(value) {
  if (/^https?:\/\//iu.test(value)) {
    return new URL(value);
  }
  throw new Error(`PolliClient requires absolute URLs. Received: ${value}`);
}

function cloneBody(body) {
  if (body == null) return body;
  if (Array.isArray(body)) {
    return [...body];
  }
  if (isBodyObject(body)) {
    return { ...body };
  }
  return body;
}

function prepareBody(payload, headers, jsonFlag) {
  if (payload == null) {
    return payload === null ? null : undefined;
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
    return payload;
  }

  if (typeof Blob !== 'undefined' && payload instanceof Blob) {
    return payload;
  }

  if (typeof FormData !== 'undefined' && payload instanceof FormData) {
    return payload;
  }

  if (typeof URLSearchParams !== 'undefined' && payload instanceof URLSearchParams) {
    return payload;
  }

  if (typeof ReadableStream !== 'undefined' && payload instanceof ReadableStream) {
    return payload;
  }

  if (shouldSerializeAsJson(payload, jsonFlag)) {
    if (!hasContentType(headers)) {
      headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(payload);
  }

  return payload;
}

function shouldSerializeAsJson(value, flag) {
  if (flag === true) return true;
  if (flag === false) return false;
  return Array.isArray(value) || isBodyObject(value);
}

function hasContentType(headers) {
  return Object.keys(headers).some(key => key.toLowerCase() === 'content-type');
}

function isBodyObject(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return false;
  if (typeof FormData !== 'undefined' && value instanceof FormData) return false;
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return false;
  if (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function createAuthManager({ auth, referrer, token, tokenProvider } = {}) {
  const fallbackReferrer = referrer ?? inferReferrer();
  if (auth) {
    if (auth.mode === 'none') {
      return new AuthManager({ mode: 'none', referrer: null, placement: 'header', getToken: async () => null });
    }
    if (auth.mode === 'referrer') {
      const resolvedReferrer = auth.referrer ?? fallbackReferrer;
      if (!resolvedReferrer) {
        throw new Error('Referrer authentication requires a referrer string');
      }
      return new AuthManager({ mode: 'referrer', referrer: String(resolvedReferrer), placement: 'header', getToken: async () => null });
    }
    if (auth.mode === 'token') {
      const provider = normalizeTokenProvider(auth.getToken ?? auth.token ?? tokenProvider ?? token);
      if (!provider) {
        throw new Error('Token authentication requires a token or provider');
      }
      return new AuthManager({
        mode: 'token',
        referrer: auth.referrer ?? fallbackReferrer ?? null,
        placement: normalizePlacement(auth.placement),
        getToken: provider,
      });
    }
    throw new Error(`Unsupported auth.mode: ${auth.mode}`);
  }

  if (tokenProvider || token) {
    const provider = normalizeTokenProvider(tokenProvider ?? token);
    if (!provider) {
      throw new Error('Token authentication requires a token or provider');
    }
    return new AuthManager({
      mode: 'token',
      referrer: fallbackReferrer ?? null,
      placement: 'header',
      getToken: provider,
    });
  }

  if (fallbackReferrer) {
    return new AuthManager({
      mode: 'referrer',
      referrer: String(fallbackReferrer),
      placement: 'header',
      getToken: async () => null,
    });
  }

  return new AuthManager({ mode: 'none', referrer: null, placement: 'header', getToken: async () => null });
}

class AuthManager {
  constructor({ mode, referrer, placement, getToken }) {
    this.mode = mode;
    this.referrer = referrer ?? null;
    this.placement = normalizePlacement(placement ?? 'header');
    this._getToken = getToken;
  }

  async getToken() {
    if (this.mode !== 'token') return null;
    return await this._getToken();
  }

  async apply({ method, url, headers, body, includeReferrer, includeToken, tokenPlacement }) {
    if (includeReferrer !== false && this.referrer) {
      if ((method === 'GET' || method === 'HEAD') && !url.searchParams.has('referrer')) {
        url.searchParams.set('referrer', this.referrer);
      } else if (isBodyObject(body) && body.referrer == null) {
        body.referrer = this.referrer;
      } else if (!url.searchParams.has('referrer')) {
        url.searchParams.set('referrer', this.referrer);
      }
    }

    if (this.mode !== 'token' || includeToken === false) {
      return;
    }

    const token = await this.getToken();
    if (!token) {
      return;
    }

    const placement = normalizePlacement(tokenPlacement ?? this.placement);
    embedTokenIntoQuery(url, token);

    if (placement === 'header') {
      if (!hasAuthHeader(headers)) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } else if (placement === 'body') {
      if (isBodyObject(body) && body.token == null) {
        body.token = token;
      }
    }
  }

  async decorateUrl(url, { includeReferrer = true, includeToken = false, tokenPlacement } = {}) {
    if (includeReferrer && this.referrer && !url.searchParams.has('referrer')) {
      url.searchParams.set('referrer', this.referrer);
    }
    if (includeToken && this.mode === 'token') {
      const token = await this.getToken();
      if (!token) {
        return;
      }
      embedTokenIntoQuery(url, token);
      normalizePlacement(tokenPlacement ?? this.placement);
    }
  }
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
  if (typeof value === 'string') {
    return value.trim();
  }
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
  return Object.keys(headers ?? {}).some(key => key.toLowerCase() === 'authorization');
}

function embedTokenIntoQuery(url, token) {
  if (!url?.searchParams || token == null) return;
  if (!url.searchParams.has('token')) {
    url.searchParams.set('token', token);
  }
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
    // Ignore DOM access errors in non-browser environments.
  }
  return null;
}
