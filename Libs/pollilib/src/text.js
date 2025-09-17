import { getDefaultClient } from './client.js';
import { sseEvents } from './sse.js';
import { raiseForStatus } from './errors.js';

const boolString = value => (value == null ? undefined : value ? 'true' : 'false');

export async function text(prompt, options = {}, client = getDefaultClient()) {
  if (typeof prompt !== 'string' || !prompt.length) {
    throw new Error('text() expects a non-empty prompt string');
  }
  const {
    model,
    seed,
    temperature,
    top_p,
    presence_penalty,
    frequency_penalty,
    json,
    system,
    stream,
    private: priv,
    referrer,
    timeoutMs,
  } = options;
  const url = `${client.textBase}/${encodeURIComponent(prompt)}`;
  const params = {};
  if (model) params.model = model;
  if (seed != null) params.seed = seed;
  if (temperature != null) params.temperature = temperature;
  if (top_p != null) params.top_p = top_p;
  if (presence_penalty != null) params.presence_penalty = presence_penalty;
  if (frequency_penalty != null) params.frequency_penalty = frequency_penalty;
  if (json) params.json = json === true ? 'true' : json;
  if (system) params.system = system;
  if (priv != null) params.private = boolString(priv);
  if (referrer) params.referrer = referrer;

  if (stream) {
    params.stream = 'true';
    const response = await client.get(url, {
      params,
      headers: { Accept: 'text/event-stream' },
      timeoutMs: timeoutMs ?? 0,
    });
    if (!response.ok) {
      await raiseForStatus(response, 'text (stream)', { consumeBody: false });
    }
    return (async function* () {
      for await (const chunk of sseEvents(response)) {
        const trimmed = String(chunk).trim();
        if (trimmed === '[DONE]') break;
        yield chunk;
      }
    })();
  }

  const response = await client.get(url, { params, timeoutMs });
  await raiseForStatus(response, 'text');
  return await response.text();
}

export async function chat(options = {}, client = getDefaultClient()) {
  const {
    model,
    messages,
    stream,
    endpoint,
    timeoutMs,
    private: priv,
    jsonMode,
    json,
    response_format,
    ...rest
  } = options ?? {};
  if (!model) throw new Error('chat() requires a model');
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error('chat() requires a non-empty messages array');
  }
  const targetEndpoint = resolveChatEndpoint(endpoint);
  const url = `${client.textBase}/openai`;
  const body = { model, messages };
  if (priv != null) body.private = !!priv;
  const { responseFormat, legacyJson } = resolveResponseFormat({ response_format, jsonMode, json });
  if (responseFormat !== undefined) {
    body.response_format = responseFormat;
  }
  if (legacyJson !== undefined) {
    body.json = legacyJson;
  }
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    body[key] = value;
  }
  if (targetEndpoint && targetEndpoint !== 'openai') {
    body.endpoint = targetEndpoint;
  }

  if (stream) {
    body.stream = true;
    const response = await client.postJson(url, body, {
      headers: { Accept: 'text/event-stream' },
      timeoutMs: timeoutMs ?? 0,
    });
    if (!response.ok) {
      await raiseForStatus(response, 'chat (stream)', { consumeBody: false });
    }
    return (async function* () {
      for await (const chunk of sseEvents(response)) {
        const trimmed = String(chunk).trim();
        if (trimmed === '[DONE]') break;
        yield JSON.parse(chunk);
      }
    })();
  }

  const response = await client.postJson(url, body, { timeoutMs });
  await raiseForStatus(response, 'chat');
  return await response.json();
}

export async function textModels(client = getDefaultClient()) {
  const response = await client.get(`${client.textBase}/models`);
  await raiseForStatus(response, 'textModels');
  return await response.json();
}

export async function search(query, model = 'searchgpt', client = getDefaultClient()) {
  return await text(query, { model }, client);
}

function resolveChatEndpoint(endpoint) {
  if (endpoint == null) return 'openai';
  let value = String(endpoint).trim();
  if (!value) return 'openai';
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const url = new URL(value);
      value = url.pathname;
    } catch {
      return 'openai';
    }
  }
  value = value.replace(/^\/+/u, '').replace(/\/+$/u, '').toLowerCase();
  return value || 'openai';
}

function resolveResponseFormat({ response_format, jsonMode, json }) {
  const normalized = normalizeResponseFormat(response_format);
  if (normalized !== undefined) {
    return { responseFormat: normalized, legacyJson: jsonForLegacy(json, normalized) };
  }
  if (jsonMode === true) {
    return { responseFormat: { type: 'json_object' }, legacyJson: undefined };
  }
  const jsonAlias = normalizeJsonAlias(json);
  if (jsonAlias.responseFormat !== undefined) {
    return jsonAlias;
  }
  return { responseFormat: undefined, legacyJson: jsonAlias.legacyJson };
}

function normalizeResponseFormat(value) {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed === 'json_object') {
      return { type: 'json_object' };
    }
    return { type: trimmed };
  }
  if (typeof value === 'object') {
    return value;
  }
  return undefined;
}

function normalizeJsonAlias(value) {
  if (value == null) {
    return { responseFormat: undefined, legacyJson: undefined };
  }
  if (value === true || value === 'true') {
    return { responseFormat: { type: 'json_object' }, legacyJson: undefined };
  }
  if (value === false) {
    return { responseFormat: undefined, legacyJson: undefined };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return { responseFormat: undefined, legacyJson: undefined };
    }
    return { responseFormat: { type: trimmed }, legacyJson: undefined };
  }
  if (typeof value === 'object') {
    return { responseFormat: value, legacyJson: undefined };
  }
  return { responseFormat: undefined, legacyJson: value };
}

function jsonForLegacy(value, responseFormat) {
  if (value == null) return undefined;
  if (value === true || value === 'true') return undefined;
  if (!responseFormat) return value;
  const responseType = typeof responseFormat === 'object' && responseFormat?.type ? String(responseFormat.type) : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (responseType && trimmed.toLowerCase() === responseType.toLowerCase()) return undefined;
    return value;
  }
  if (typeof value === 'object') {
    if (value === responseFormat) return undefined;
    if (value?.type && responseType && String(value.type).toLowerCase() === responseType.toLowerCase()) {
      return undefined;
    }
  }
  return value;
}
