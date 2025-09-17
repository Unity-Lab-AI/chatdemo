import { PolliClient, DEFAULT_REFERRER, DEFAULT_TOKEN } from '../Libs/pollilib/index.js';

let tokenPromise = null;
let cachedResult = null;

export async function createPollinationsClient({ referrer } = {}) {
  const tokenResult = await ensureToken();
  const { token, source, messages = [], errors = [] } = tokenResult;
  const inferredReferrer = referrer ?? inferReferrer() ?? DEFAULT_REFERRER;

  const clientOptions = {};
  if (inferredReferrer) {
    clientOptions.referrer = inferredReferrer;
  }

  if (token) {
    clientOptions.auth = {
      mode: 'token',
      placement: 'query',
      getToken: async () => token,
      referrer: inferredReferrer ?? undefined,
    };
  }

  const client = new PolliClient(clientOptions);
  return {
    client,
    tokenSource: token ? source ?? null : null,
    tokenMessages: messages,
    tokenErrors: errors,
  };
}

async function ensureToken() {
  if (cachedResult) {
    return cachedResult;
  }
  if (!tokenPromise) {
    tokenPromise = resolveToken()
      .then(result => {
        cachedResult = result;
        return result;
      })
      .finally(() => {
        tokenPromise = null;
      });
  }
  return tokenPromise;
}

async function resolveToken() {
  const attempts = [
    readTokenFromUrl,
    readTokenFromMeta,
    readTokenFromWindow,
    readTokenFromEnv,
    fetchTokenFromApi,
  ];
  const errors = [];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result?.token) {
        const messages = errors
          .map(entry => formatError(entry.source, entry.error))
          .filter(Boolean);
        return {
          token: result.token,
          source: result.source ?? attempt.name ?? 'unknown',
          errors,
          messages,
        };
      }
      if (result?.error) {
        errors.push({ source: result.source ?? attempt.name ?? 'unknown', error: result.error });
      }
    } catch (error) {
      errors.push({ source: attempt.name ?? 'unknown', error });
    }
  }

  const messages = errors
    .map(entry => formatError(entry.source, entry.error))
    .filter(Boolean);
  if (DEFAULT_TOKEN) {
    return {
      token: DEFAULT_TOKEN,
      source: 'default',
      errors,
      messages,
    };
  }
  return {
    token: null,
    source: null,
    errors,
    messages,
  };
}

async function fetchTokenFromApi() {
  const endpoint = resolveTokenEndpoint();
  if (!endpoint) {
    return { token: null, source: 'api' };
  }
  if (typeof fetch !== 'function') {
    return { token: null, source: 'api', error: new Error('Fetch is unavailable in this environment.') };
  }
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (response.status === 404) {
      return { token: null, source: 'api', error: new Error('Token endpoint not found (404).') };
    }
    if (!response.ok) {
      return {
        token: null,
        source: 'api',
        error: new Error(`Token endpoint responded with HTTP ${response.status}`),
      };
    }
    const contentType = response.headers?.get?.('content-type') ?? '';
    let body;
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }
    const token = extractTokenValue(body);
    if (token) {
      return { token, source: 'api' };
    }
    return { token: null, source: 'api', error: new Error('Token endpoint returned no token.') };
  } catch (error) {
    return { token: null, source: 'api', error };
  }
}

function readTokenFromUrl() {
  const location = getCurrentLocation();
  if (!location) {
    return { token: null, source: 'url' };
  }

  const { url, searchParams, hashParams, rawFragments } = parseLocation(location);
  const tokenKeys = new Set();
  const candidates = [];

  collectTokenCandidates(searchParams, tokenKeys, candidates);
  collectTokenCandidates(hashParams, tokenKeys, candidates);

  if (candidates.length === 0 && rawFragments.length > 0) {
    const regex = /(token[^=:#/?&]*)([:=])([^#&/?]+)/gi;
    for (const fragment of rawFragments) {
      let match;
      while ((match = regex.exec(fragment))) {
        tokenKeys.add(match[1]);
        candidates.push(match[3]);
      }
    }
  }

  const token = extractTokenValue(candidates);
  if (!token) {
    return { token: null, source: 'url' };
  }

  sanitizeUrlToken(location, url, tokenKeys);

  return { token, source: 'url' };
}

function readTokenFromMeta() {
  if (typeof document === 'undefined') {
    return { token: null, source: 'meta' };
  }
  const meta = document.querySelector('meta[name="pollinations-token"]');
  if (!meta) {
    return { token: null, source: 'meta' };
  }
  const content = meta.getAttribute('content');
  const token = extractTokenValue(content);
  if (!token) {
    return { token: null, source: 'meta' };
  }
  try {
    meta.setAttribute('content', '');
  } catch {
    // ignore inability to reset the meta tag
  }
  return { token, source: 'meta' };
}

function readTokenFromWindow() {
  if (typeof window === 'undefined') {
    return { token: null, source: 'window' };
  }
  const candidate = window.__POLLINATIONS_TOKEN__ ?? window.POLLI_TOKEN ?? null;
  const token = extractTokenValue(candidate);
  if (!token) {
    return { token: null, source: 'window' };
  }
  try {
    delete window.__POLLINATIONS_TOKEN__;
  } catch {
    // ignore cleanup errors
  }
  try {
    delete window.POLLI_TOKEN;
  } catch {
    // ignore cleanup errors
  }
  return { token, source: 'window' };
}

function readTokenFromEnv() {
  const importMetaEnv = typeof import.meta !== 'undefined' ? import.meta.env ?? undefined : undefined;
  const processEnv = typeof process !== 'undefined' && process?.env ? process.env : undefined;

  const sources = [];
  if (importMetaEnv) {
    sources.push([
      importMetaEnv.VITE_POLLI_TOKEN,
      importMetaEnv.POLLI_TOKEN,
      importMetaEnv.VITE_POLLINATIONS_TOKEN,
      importMetaEnv.POLLINATIONS_TOKEN,
    ]);
  }
  if (processEnv) {
    sources.push([
      processEnv.VITE_POLLI_TOKEN,
      processEnv.POLLI_TOKEN,
      processEnv.VITE_POLLINATIONS_TOKEN,
      processEnv.POLLINATIONS_TOKEN,
    ]);
  }

  for (const group of sources) {
    const token = extractTokenValue(group);
    if (token) {
      return { token, source: 'env' };
    }
  }

  return { token: null, source: 'env' };
}

function getCurrentLocation() {
  if (typeof window !== 'undefined' && window?.location) {
    return window.location;
  }
  if (typeof globalThis !== 'undefined' && globalThis?.location) {
    return globalThis.location;
  }
  return null;
}

function parseLocation(location) {
  const result = {
    url: null,
    searchParams: new URLSearchParams(),
    hashParams: new URLSearchParams(),
    rawFragments: [],
  };

  let baseHref = '';
  if (typeof location.href === 'string' && location.href) {
    baseHref = location.href;
  } else {
    const origin = typeof location.origin === 'string' ? location.origin : 'http://localhost';
    const path = typeof location.pathname === 'string' ? location.pathname : '/';
    const search = typeof location.search === 'string' ? location.search : '';
    const hash = typeof location.hash === 'string' ? location.hash : '';
    baseHref = `${origin.replace(/\/?$/, '')}${path.startsWith('/') ? path : `/${path}`}${search}${hash}`;
  }

  try {
    const base = typeof location.origin === 'string' && location.origin ? location.origin : undefined;
    result.url = base ? new URL(baseHref, base) : new URL(baseHref);
  } catch {
    try {
      result.url = new URL(baseHref, 'http://localhost');
    } catch {
      result.url = null;
    }
  }

  if (result.url) {
    result.searchParams = new URLSearchParams(result.url.searchParams);
    const hash = typeof result.url.hash === 'string' ? result.url.hash.replace(/^#/, '') : '';
    if (hash) {
      result.hashParams = new URLSearchParams(hash);
      result.rawFragments.push(hash);
    }
  } else {
    const search = typeof location.search === 'string' ? location.search.replace(/^\?/, '') : '';
    const hash = typeof location.hash === 'string' ? location.hash.replace(/^#/, '') : '';
    result.searchParams = new URLSearchParams(search);
    result.hashParams = new URLSearchParams(hash);
    if (hash) {
      result.rawFragments.push(hash);
    }
  }

  const hrefFragment = typeof location.href === 'string' ? location.href : '';
  if (hrefFragment) {
    result.rawFragments.push(hrefFragment);
  }

  return result;
}

function collectTokenCandidates(params, tokenKeys, candidates) {
  if (!params) return;
  for (const key of params.keys()) {
    if (typeof key !== 'string') continue;
    if (!key.toLowerCase().includes('token')) continue;
    tokenKeys.add(key);
    const values = params.getAll(key);
    for (const value of values) {
      candidates.push(value);
    }
  }
}

function sanitizeUrlToken(location, url, tokenKeys) {
  if (!location || !tokenKeys || tokenKeys.size === 0) {
    return;
  }

  const effectiveUrl = url ?? parseLocation(location).url;
  if (!effectiveUrl) {
    return;
  }

  let modified = false;
  for (const key of tokenKeys) {
    if (effectiveUrl.searchParams.has(key)) {
      effectiveUrl.searchParams.delete(key);
      modified = true;
    }
  }

  const originalHash = effectiveUrl.hash;
  if (typeof originalHash === 'string' && originalHash.length > 1) {
    const hashParams = new URLSearchParams(originalHash.slice(1));
    let hashModified = false;
    for (const key of tokenKeys) {
      if (hashParams.has(key)) {
        hashParams.delete(key);
        hashModified = true;
      }
    }
    if (hashModified) {
      const nextHash = hashParams.toString();
      effectiveUrl.hash = nextHash ? `#${nextHash}` : '';
      modified = true;
    }
  }

  if (!modified) {
    return;
  }

  const history =
    (typeof window !== 'undefined' && window?.history) ||
    (typeof globalThis !== 'undefined' && globalThis?.history) ||
    null;
  const nextUrl = effectiveUrl.toString();

  if (history?.replaceState) {
    try {
      history.replaceState(history.state ?? null, '', nextUrl);
      return;
    } catch {
      // ignore history errors
    }
  }

  if (typeof location.assign === 'function') {
    try {
      location.assign(nextUrl);
      return;
    } catch {
      // ignore assignment errors
    }
  }

  if ('href' in location) {
    try {
      location.href = nextUrl;
    } catch {
      // ignore inability to mutate href
    }
  }
}

function resolveTokenEndpoint() {
  const importMetaEnv = typeof import.meta !== 'undefined' ? import.meta.env ?? undefined : undefined;
  const processEnv = typeof process !== 'undefined' && process?.env ? process.env : undefined;
  const envCandidates = [
    importMetaEnv?.VITE_POLLI_TOKEN_ENDPOINT,
    importMetaEnv?.POLLI_TOKEN_ENDPOINT,
    importMetaEnv?.VITE_POLLINATIONS_TOKEN_ENDPOINT,
    importMetaEnv?.POLLINATIONS_TOKEN_ENDPOINT,
    processEnv?.VITE_POLLI_TOKEN_ENDPOINT,
    processEnv?.POLLI_TOKEN_ENDPOINT,
    processEnv?.VITE_POLLINATIONS_TOKEN_ENDPOINT,
    processEnv?.POLLINATIONS_TOKEN_ENDPOINT,
  ];

  const windowCandidates = [];
  if (typeof window !== 'undefined') {
    windowCandidates.push(
      window.__POLLINATIONS_TOKEN_ENDPOINT__,
      window.POLLI_TOKEN_ENDPOINT,
      window.POLLINATIONS_TOKEN_ENDPOINT,
    );
  }

  const metaCandidates = [];
  if (typeof document !== 'undefined' && document?.querySelector) {
    const names = ['pollinations-token-endpoint', 'polli-token-endpoint'];
    for (const name of names) {
      const meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) continue;
      const content = meta.getAttribute('content');
      if (typeof content === 'string') {
        metaCandidates.push(content);
      }
    }
  }

  const candidates = [...envCandidates, ...windowCandidates, ...metaCandidates];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function extractTokenValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower === 'undefined' || lower === 'null') {
      return null;
    }
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return extractTokenValue(JSON.parse(trimmed));
      } catch {
        // ignore JSON parse errors and fall back to the raw string
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const extracted = extractTokenValue(entry);
      if (extracted) return extracted;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['token', 'value', 'secret', 'apiKey', 'key']) {
      if (key in value) {
        const extracted = extractTokenValue(value[key]);
        if (extracted) return extracted;
      }
    }
  }
  return null;
}

function formatError(source, error) {
  if (!error) return null;
  const reason = error?.message ?? String(error);
  return source ? `${source}: ${reason}` : reason;
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
    // ignore errors when attempting to access location
  }
  return null;
}

function resetTokenCache() {
  tokenPromise = null;
  cachedResult = null;
}

export const __testing = {
  resetTokenCache,
};
