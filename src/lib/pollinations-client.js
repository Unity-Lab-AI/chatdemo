import { PolliClient, DEFAULT_REFERRER } from '../Libs/pollilib/index.js';

export async function createPollinationsClient({ referrer } = {}) {
  const inferredReferrer = referrer ?? inferReferrer() ?? DEFAULT_REFERRER;
  // Use a slightly higher timeout to accommodate longer generations
  const client = new PolliClient({ timeoutMs: 120_000 });
  try { globalThis.__POLLINATIONS_REFERRER__ = inferredReferrer; } catch {}
  return {
    client,
    tokenSource: null,
    tokenMessages: [],
    referrer: inferredReferrer,
  };
}

function inferReferrer() {
  try {
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
    if (typeof document !== 'undefined' && document.location?.origin) return document.location.origin;
  } catch {}
  return null;
}

export const __testing = {};
