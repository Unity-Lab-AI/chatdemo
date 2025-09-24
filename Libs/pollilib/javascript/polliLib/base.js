// Base utilities and model listing

const DEFAULTS = {
  textUrl: "https://text.pollinations.ai/models",
  imageUrl: "https://image.pollinations.ai/models",
  imagePromptBase: "https://image.pollinations.ai/prompt",
  textPromptBase: "https://text.pollinations.ai",
  timeoutMs: 60000,
  minRequestIntervalMs: 3000,
  retryInitialDelayMs: 500,
  retryDelayStepMs: 100,
  retryMaxDelayMs: 4000,
};
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export class BaseClient {
  constructor(opts = {}) {
    this.textUrl = opts.textUrl || DEFAULTS.textUrl;
    this.imageUrl = opts.imageUrl || DEFAULTS.imageUrl;
    this.imagePromptBase = opts.imagePromptBase || DEFAULTS.imagePromptBase;
    this.textPromptBase = opts.textPromptBase || DEFAULTS.textPromptBase;
    this.timeoutMs = opts.timeoutMs || DEFAULTS.timeoutMs;
    this.fetch = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    if (!this.fetch) throw new Error("fetch is not available; provide opts.fetch");
    this._modelsCache = new Map(); // kind -> list
    this.minRequestIntervalMs = Number.isFinite(opts.minRequestIntervalMs)
      ? Math.max(0, opts.minRequestIntervalMs)
      : DEFAULTS.minRequestIntervalMs;
    this.retryInitialDelayMs = Number.isFinite(opts.retryInitialDelayMs)
      ? Math.max(0, opts.retryInitialDelayMs)
      : DEFAULTS.retryInitialDelayMs;
    this.retryDelayStepMs = Number.isFinite(opts.retryDelayStepMs)
      ? Math.max(0, opts.retryDelayStepMs)
      : DEFAULTS.retryDelayStepMs;
    this.retryMaxDelayMs = Number.isFinite(opts.retryMaxDelayMs)
      ? Math.max(this.retryInitialDelayMs, opts.retryMaxDelayMs)
      : DEFAULTS.retryMaxDelayMs;
    const steps = this.retryDelayStepMs > 0
      ? Math.floor(Math.max(0, this.retryMaxDelayMs - this.retryInitialDelayMs) / this.retryDelayStepMs)
      : 0;
    this._maxRetryAttempts = this.retryMaxDelayMs > 0 ? steps + 1 : 0;
    this._sleepFn = typeof opts.sleep === "function"
      ? opts.sleep
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    this._lastSuccessAt = 0;
    this._requestQueue = Promise.resolve();
  }

  async listModels(kind /* 'text' | 'image' */) {
    const cached = this._modelsCache.get(kind);
    if (cached) return cached;
    const url = this._url(kind);
    const resp = await this.fetch(url, { method: "GET" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const models = this._normalizeModels(json);
    this._modelsCache.set(kind, models);
    return models;
  }

  async getModelByName(name, { kind = null, includeAliases = true, caseInsensitive = true } = {}) {
    const needle = caseInsensitive ? String(name).toLowerCase() : String(name);
    const kinds = kind ? [kind] : ["text", "image"];
    for (const k of kinds) {
      const models = await this.listModels(k);
      for (const m of models) {
        let names = [m.name || ""];
        if (includeAliases && Array.isArray(m.aliases)) names = names.concat(m.aliases);
        if (caseInsensitive) names = names.map((n) => String(n).toLowerCase());
        if (names.includes(needle)) return m;
      }
    }
    return null;
  }

  static get(model, field, def = null) {
    return model && Object.prototype.hasOwnProperty.call(model, field) ? model[field] : def;
  }

  refreshCache() {
    this._modelsCache.clear();
  }

  _url(kind) {
    return kind === "text" ? this.textUrl : this.imageUrl;
  }

  _normalizeModels(raw) {
    if (raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray(raw.models)) {
      raw = raw.models;
    }
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      if (typeof item === "string") {
        out.push({
          name: item,
          aliases: [],
          input_modalities: [],
          output_modalities: [],
          tools: false,
          vision: false,
          audio: false,
          community: false,
          supportsSystemMessages: true,
        });
      } else if (item && typeof item === "object") {
        const m = { ...item };
        if ("teir" in m && !("tier" in m)) m.tier = m.teir, delete m.teir;
        m.aliases ||= [];
        m.input_modalities ||= [];
        m.output_modalities ||= [];
        m.tools ||= false;
        m.vision ||= false;
        m.audio ||= false;
        m.community ||= false;
        m.supportsSystemMessages = m.supportsSystemMessages ?? true;
        out.push(m);
      }
    }
    return out;
  }

  _randomSeed() {
    const digits = Math.floor(Math.random() * 4) + 5; // 5..8
    const low = 10 ** (digits - 1);
    const high = 10 ** digits - 1;
    return Math.floor(Math.random() * (high - low + 1)) + low;
  }

  _imagePromptUrl(prompt) {
    return `${this.imagePromptBase}/${encodeURIComponent(prompt)}`;
  }

  _textPromptUrl(prompt) {
    return `${this.textPromptBase}/${encodeURIComponent(prompt)}`;
  }

  _retryDelayMs(attempt) {
    if (attempt <= 0) return 0;
    if (this.retryInitialDelayMs <= 0) return 0;
    if (attempt === 1) return this.retryInitialDelayMs;
    if (this.retryDelayStepMs <= 0) return Math.min(this.retryInitialDelayMs, this.retryMaxDelayMs);
    const delay = this.retryInitialDelayMs + (attempt - 1) * this.retryDelayStepMs;
    return Math.min(delay, this.retryMaxDelayMs);
  }

  async _sleep(ms) {
    if (!(ms > 0)) return;
    await this._sleepFn(ms);
  }

  _shouldRetryResponse(resp) {
    return resp && RETRYABLE_STATUS.has(resp.status);
  }

  _isRetryableError(error) {
    if (!error) return false;
    if (error.retryable === true) return true;
    if (typeof error.status === "number" && RETRYABLE_STATUS.has(error.status)) return true;
    return false;
  }

  _resolveTimeout(timeoutMs, fallbackMs = null) {
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) return timeoutMs;
    const base = Number.isFinite(this.timeoutMs) && this.timeoutMs > 0 ? this.timeoutMs : null;
    if (base != null) return base;
    const fallback = Number.isFinite(fallbackMs) && fallbackMs > 0 ? fallbackMs : null;
    if (fallback != null) return fallback;
    return 60_000;
  }

  async _rateLimitedRequest(executor) {
    const run = async () => {
      let attempt = 0;
      let lastError = null;
      for (;;) {
        if (attempt === 0) {
          const waitMs = Math.max(0, this._lastSuccessAt + this.minRequestIntervalMs - Date.now());
          if (waitMs > 0) await this._sleep(waitMs);
        } else {
          const delay = this._retryDelayMs(attempt);
          if (delay > 0) await this._sleep(delay);
        }
        try {
          const response = await executor(attempt);
          if (this._shouldRetryResponse(response)) {
            lastError = new Error(`HTTP ${response.status}`);
            lastError.status = response.status;
            try { response.body?.cancel?.(); } catch {}
            attempt += 1;
            if (attempt > this._maxRetryAttempts) throw lastError;
            continue;
          }
          if (!response.ok) {
            const err = new Error(`HTTP ${response.status}`);
            err.status = response.status;
            throw err;
          }
          this._lastSuccessAt = Date.now();
          return response;
        } catch (error) {
          lastError = error;
          if (!this._isRetryableError(error)) throw error;
          attempt += 1;
          if (attempt > this._maxRetryAttempts) throw lastError;
        }
      }
    };
    const next = this._requestQueue.then(run, run);
    this._requestQueue = next.catch(() => {});
    return next;
  }
}

