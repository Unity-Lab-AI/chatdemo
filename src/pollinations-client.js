import { PolliClient } from '../Libs/pollilib/index.js';

let tokenPromise = null;
let cachedToken = null;
let cachedSource = null;

export async function createPollinationsClient({ referrer } = {}) {
  const { token, source } = await ensureToken();
  const getToken = async () => token;
  const client = new PolliClient({
    auth: {
      mode: 'token',
      placement: 'query',
      getToken,
      referrer: referrer ?? inferReferrer(),
    },
  });
  return { client, tokenSource: source };
}

async function ensureToken() {
  if (cachedToken) {
    return { token: cachedToken, source: cachedSource };
  }
  if (!tokenPromise) {
    tokenPromise = resolveToken();
  }
  const result = await tokenPromise;
  cachedToken = result.token;
  cachedSource = result.source;
  return result;
}

async function resolveToken() {
  const attempts = [fetchTokenFromApi, readTokenFromMeta, readTokenFromWindow, readTokenFromEnv];
  const errors = [];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result?.token) {
        return {
          token: result.token,
          source: result.source ?? attempt.name ?? 'unknown',
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
  const message =
    messages.length > 0
      ? `Unable to load Pollinations token. Attempts: ${messages.join('; ')}`
      : 'Unable to load Pollinations token.';
  const failure = new Error(message);
  failure.causes = errors;
  throw failure;
}

async function fetchTokenFromApi() {
  if (typeof fetch !== 'function') {
    return { token: null, source: 'api', error: new Error('Fetch is unavailable in this environment.') };
  }
  try {
    const response = await fetch('/api/polli-token', {
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

function readTokenFromMeta() {
  if (typeof document === 'undefined') {
    return { token: null, source: 'meta', error: new Error('Document is unavailable.') };
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
    return { token: null, source: 'window', error: new Error('Window is unavailable.') };
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

  const isDev = determineDevelopmentEnvironment(importMetaEnv, processEnv);
  if (!isDev) {
    return { token: null, source: 'env' };
  }

  const token = extractTokenValue([
    importMetaEnv?.VITE_POLLI_TOKEN,
    importMetaEnv?.POLLI_TOKEN,
    importMetaEnv?.VITE_POLLINATIONS_TOKEN,
    importMetaEnv?.POLLINATIONS_TOKEN,
    processEnv?.VITE_POLLI_TOKEN,
    processEnv?.POLLI_TOKEN,
    processEnv?.VITE_POLLINATIONS_TOKEN,
    processEnv?.POLLINATIONS_TOKEN,
  ]);

  if (!token) {
    return { token: null, source: 'env' };
  }
  return { token, source: 'env' };
}

function determineDevelopmentEnvironment(importMetaEnv, processEnv) {
  if (importMetaEnv && typeof importMetaEnv.DEV !== 'undefined') {
    return !!importMetaEnv.DEV;
  }
  if (processEnv) {
    if (typeof processEnv.VITE_DEV_SERVER_URL !== 'undefined') {
      return true;
    }
    if (typeof processEnv.NODE_ENV !== 'undefined') {
      return processEnv.NODE_ENV !== 'production';
    }
  }
  return false;
}

function extractTokenValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
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
  cachedToken = null;
  cachedSource = null;
}

export const __testing = {
  resetTokenCache,
  determineDevelopmentEnvironment,
};
