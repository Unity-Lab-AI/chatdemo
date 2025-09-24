export const TextMixin = (Base) => class extends Base {
  async generate_text(prompt, options = {}) {
    if (!prompt || !String(prompt).trim()) throw new Error('prompt must be a non-empty string');
    const {
      model = 'openai',
      system = null,
      referrer = null,
      token = null,
      asJson = false,
      timeoutMs,
    } = options;
    let seed = options.seed ?? null;
    if (seed == null) seed = this._randomSeed();
    const url = new URL(this._textPromptUrl(String(prompt)));
    url.searchParams.set('model', model);
    url.searchParams.set('seed', String(seed));
    url.searchParams.set('safe', 'false');
    if (asJson) url.searchParams.set('json', 'true');
    if (system) url.searchParams.set('system', system);
    if (referrer) url.searchParams.set('referrer', referrer);
    if (token) url.searchParams.set('token', token);
    const response = await this._rateLimitedRequest(async () => {
      const controller = new AbortController();
      const limit = this._resolveTimeout(timeoutMs, 60_000);
      const t = setTimeout(() => controller.abort(), limit);
      try {
        return await this.fetch(url, { method: 'GET', signal: controller.signal });
      } finally {
        clearTimeout(t);
      }
    });
    if (asJson) {
      const text = await response.text();
      try { return JSON.parse(text); } catch { return text; }
    }
    return await response.text();
  }
};
