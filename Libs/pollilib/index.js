// Compatibility wrapper for browser + Node usage without requiring tokens.
// Exposes: PolliClient (lite), textModels, chat, image, DEFAULT_REFERRER

export const DEFAULT_REFERRER = 'https://unityailab.com';

function getFetch(fn) {
  if (typeof fn === 'function') return fn;
  if (typeof fetch === 'function') return fetch.bind(globalThis);
  throw new Error('fetch is not available; provide opts.fetch');
}

function normalizeModels(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.models)) raw = raw.models;
  if (!Array.isArray(raw)) return [];
  return raw.map(item => (typeof item === 'string' ? { name: item } : { ...item }));
}

export class PolliClient {
  constructor(opts = {}) {
    this.fetch = getFetch(opts.fetch);
    this.textPromptBase = opts.textPromptBase || 'https://text.pollinations.ai';
    this.imagePromptBase = opts.imagePromptBase || 'https://image.pollinations.ai/prompt';
    this.timeoutMs = opts.timeoutMs || 60_000;
  }

  async listModels(kind = 'text') {
    const url = kind === 'image' ? 'https://image.pollinations.ai/models' : 'https://text.pollinations.ai/models';
    const r = await this.fetch(url, { method: 'GET' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    return normalizeModels(json);
  }

  async generate_text(prompt, { model = 'openai', system = null, referrer = null, asJson = false, timeoutMs = this.timeoutMs } = {}) {
    const u = new URL(`${this.textPromptBase}/${encodeURIComponent(String(prompt))}`);
    u.searchParams.set('model', model);
    if (system) u.searchParams.set('system', system);
    if (referrer) u.searchParams.set('referrer', referrer);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await this.fetch(u, { method: 'GET', signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (asJson) {
        const text = await r.text();
        try { return JSON.parse(text); } catch { return text; }
      }
      return await r.text();
    } finally { clearTimeout(t); }
  }

  async chat_completion(messages, { model = 'openai', referrer = null, asJson = true, timeoutMs = this.timeoutMs, ...rest } = {}) {
    const url = `${this.textPromptBase}/${model}`;
    const payload = { model, messages, ...(referrer ? { referrer } : {}), ...rest };
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return asJson ? data : (data?.choices?.[0]?.message?.content ?? '');
    } finally { clearTimeout(t); }
  }

  async chat_completion_tools(messages, { tools, tool_choice = 'auto', model = 'openai', referrer = null, asJson = true, timeoutMs = this.timeoutMs, ...rest } = {}) {
    const url = `${this.textPromptBase}/${model}`;
    const payload = { model, messages, tools, tool_choice, ...(referrer ? { referrer } : {}), ...rest };
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return asJson ? data : (data?.choices?.[0]?.message?.content ?? '');
    } finally { clearTimeout(t); }
  }

  async generate_image(prompt, { width = 1024, height = 1024, model = 'flux', nologo = true, seed = null, referrer = null, timeoutMs = 120_000 } = {}) {
    const params = new URLSearchParams({ width: String(width), height: String(height), model: String(model) });
    if (nologo) params.set('nologo', 'true');
    if (seed != null) params.set('seed', String(seed));
    if (referrer) params.set('referrer', referrer);
    const url = `${this.imagePromptBase}/${encodeURIComponent(String(prompt))}?${params}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await this.fetch(url, { method: 'GET', signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.arrayBuffer();
    } finally { clearTimeout(t); }
  }
}

function resolveReferrer() {
  try {
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
    if (typeof document !== 'undefined' && document.location?.origin) return document.location.origin;
  } catch {}
  return DEFAULT_REFERRER;
}

export async function textModels(client) {
  const c = client instanceof PolliClient ? client : new PolliClient();
  return c.listModels('text');
}

export async function chat(payload, client) {
  const c = client instanceof PolliClient ? client : new PolliClient();
  const referrer = resolveReferrer();
  const { endpoint = 'openai', model: selectedModel = 'openai', messages = [], tools = null, tool_choice = 'auto', ...extra } = payload || {};
  // Use the OpenAI-compatible route; actual model is passed in the payload.
  const url = `${c.textPromptBase}/openai`;
  const body = { model: selectedModel, messages, ...(Array.isArray(tools) && tools.length ? { tools, tool_choice } : {}), referrer, ...extra };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), c.timeoutMs);
  try {
    const r = await c.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    // Augment metadata to help UI match requested vs served model
    try {
      if (data && typeof data === 'object') {
        const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : (data.metadata = {});
        meta.requested_model = selectedModel;
        meta.requestedModel = selectedModel;
        meta.endpoint = endpoint || 'openai';
        if (!Array.isArray(data.modelAliases)) data.modelAliases = [];
        if (!data.modelAliases.includes(selectedModel)) data.modelAliases.push(selectedModel);
      }
    } catch {}
    return data;
  } finally {
    clearTimeout(t);
  }
}

export async function image(prompt, options, client) {
  const c = client instanceof PolliClient ? client : new PolliClient();
  const referrer = resolveReferrer();
  const { width = 1024, height = 1024, model = 'flux', nologo = true, seed = null } = options || {};
  const arr = await c.generate_image(String(prompt || '').trim(), { width, height, model, nologo, seed: seed == null ? undefined : seed, referrer });
  const contentType = 'image/jpeg';
  function toBase64FromArrayBuffer(buf) {
    if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');
    let binary = '';
    const bytes = new Uint8Array(buf);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 1) binary += String.fromCharCode(bytes[i]);
    if (typeof btoa === 'function') return btoa(binary);
    return '';
  }
  return { toDataUrl() { return `data:${contentType};base64,${toBase64FromArrayBuffer(arr)}`; } };
}


