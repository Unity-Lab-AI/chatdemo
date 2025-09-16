const DEFAULT_USER_AGENT = `polliLib-web/0.1.0 (+https://pollinations.ai)`;

export class PolliClientWeb {
  constructor({
    referrer = inferReferrer(),
    imageBase = 'https://image.pollinations.ai',
    textBase = 'https://text.pollinations.ai',
    timeoutMs = 60_000,
  } = {}) {
    this.referrer = referrer;
    this.imageBase = stripTrail(imageBase);
    this.textBase = stripTrail(textBase);
    this.timeoutMs = timeoutMs;
  }

  _addReferrer(u, params) {
    // If explicit param provided, prefer it; else fall back to client referrer.
    const hasRefParam = params && Object.prototype.hasOwnProperty.call(params, 'referrer');
    if (!hasRefParam && this.referrer) {
      u.searchParams.set('referrer', this.referrer);
    } else if (hasRefParam && params.referrer) {
      u.searchParams.set('referrer', params.referrer);
    }
  }

  async get(url, { params = {}, headers = {}, stream = false } = {}) {
    const u = new URL(url);
    // Attach query params (excluding referrer first)
    for (const [k, v] of Object.entries(params)) {
      if (v != null && k !== 'referrer') u.searchParams.set(k, String(v));
    }
    // Add referrer last so explicit wins
    this._addReferrer(u, params);
    const final = u.toString();
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(final, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } finally { clearTimeout(id); }
  }

  async postJson(url, body, { headers = {}, stream = false } = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    const hdrs = { 'Content-Type': 'application/json' };
    Object.assign(hdrs, headers);
    // Include referrer in body if configured and not already present
    const payload = { ...(body || {}) };
    if (this.referrer && payload.referrer == null) payload.referrer = this.referrer;
    try {
      return await fetch(url, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally { clearTimeout(id); }
  }
}

function inferReferrer() {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.origin) return window.location.origin;
  } catch {}
  return null;
}

function stripTrail(s) { return s.endsWith('/') ? s.slice(0, -1) : s; }

export let defaultClient = null;
export function getDefaultClient() { return defaultClient ??= new PolliClientWeb(); }
export function setDefaultClient(c) { defaultClient = c; }

