const DEFAULT_USER_AGENT = `polliLib/0.1.0 (+https://pollinations.ai)`;

export class PolliClient {
  constructor({
    token = process.env.POLLINATIONS_TOKEN ?? null,
    referrer = null,
    imageBase = 'https://image.pollinations.ai',
    textBase = 'https://text.pollinations.ai',
    timeoutMs = 60_000,
  } = {}) {
    this.token = token;
    this.referrer = referrer;
    this.imageBase = stripTrail(imageBase);
    this.textBase = stripTrail(textBase);
    this.timeoutMs = timeoutMs;
  }

  _withToken(url) {
    if (!this.token) return url;
    const u = new URL(url);
    if (!u.searchParams.has('token')) u.searchParams.set('token', this.token);
    return u.toString();
  }

  async get(url, { params = {}, headers = {}, stream = false } = {}) {
    const u = new URL(url);
    if (this.referrer && !('referrer' in params)) params.referrer = this.referrer;
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    const final = this._withToken(u.toString());
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(final, { method: 'GET', headers, signal: controller.signal });
    } finally { clearTimeout(id); }
  }

  async postJson(url, body, { headers = {}, stream = false } = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    const hdrs = { 'Content-Type': 'application/json' };
    if (this.token) hdrs['Authorization'] = `Bearer ${this.token}`;
    Object.assign(hdrs, headers);
    try {
      return await fetch(url, { method: 'POST', headers: hdrs, body: JSON.stringify(body), signal: controller.signal });
    } finally { clearTimeout(id); }
  }
}

function stripTrail(s) { return s.endsWith('/') ? s.slice(0, -1) : s; }

export let defaultClient = null;
export function getDefaultClient() { return defaultClient ??= new PolliClient(); }
export function setDefaultClient(c) { defaultClient = c; }

