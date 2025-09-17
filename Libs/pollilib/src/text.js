import { getDefaultClient } from './client.js';
import { DEFAULT_MODEL, DEFAULT_SEED } from './defaults.js';
import { sseEvents } from './sse.js';
import { raiseForStatus } from './errors.js';

export async function text(prompt, options = {}, client = getDefaultClient()) {
  const normalizedPrompt = normalizePrompt(prompt);
  const { stream = false, timeoutMs, ...rest } = options ?? {};

  const params = buildTextParams(rest);
  if (!('input' in params)) {
    params.input = normalizedPrompt;
  }
  const url = `${client.textBase}/openai`;

  if (stream) {
    const response = await client.get(url, {
      params: { ...params, stream: 'true' },
      headers: { Accept: 'text/event-stream' },
      timeoutMs: timeoutMs ?? 0,
    });
    if (!response.ok) {
      await raiseForStatus(response, 'text (stream)', { consumeBody: false });
    }
    return (async function* () {
      for await (const chunk of sseEvents(response)) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;
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
  const { body, stream, timeoutMs, query } = buildChatPayload(options);
  const url = `${client.textBase}/openai`;

  if (stream) {
    body.stream = true;
    const response = await client.postJson(url, body, {
      headers: { Accept: 'text/event-stream' },
      timeoutMs: timeoutMs ?? 0,
      params: query,
    });
    if (!response.ok) {
      await raiseForStatus(response, 'chat (stream)', { consumeBody: false });
    }
    return (async function* () {
      for await (const chunk of sseEvents(response)) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;
        if (trimmed === '[DONE]') break;
        yield JSON.parse(chunk);
      }
    })();
  }

  const response = await client.postJson(url, body, { timeoutMs, params: query });
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

export function createChatSession(initialMessages = [], options = {}, client = getDefaultClient()) {
  const state = {
    history: normalizeMessages(initialMessages),
    options: { ...options },
  };

  function snapshot() {
    return state.history.map(message => ({ ...message }));
  }

  function reset(messages = initialMessages) {
    state.history = normalizeMessages(messages);
    return snapshot();
  }

  function updateOptions(nextOptions = {}) {
    state.options = { ...state.options, ...nextOptions };
    return { ...state.options };
  }

  function setOptions(nextOptions = {}) {
    state.options = { ...nextOptions };
    return { ...state.options };
  }

  function append(message, defaultRole) {
    state.history = [...state.history, normalizeMessage(message, defaultRole)];
    return snapshot();
  }

  async function sendUserMessage(message, overrides = {}) {
    append(message, 'user');
    const payload = { ...state.options, ...overrides, messages: state.history };
    const response = await chat(payload, client);
    const assistantMessage = extractAssistantMessage(response);
    if (assistantMessage) {
      state.history = [...state.history, assistantMessage];
    }
    return { response, messages: snapshot() };
  }

  return {
    get messages() {
      return snapshot();
    },
    reset,
    updateOptions,
    setOptions,
    append,
    sendUserMessage,
  };
}

function normalizePrompt(prompt) {
  if (typeof prompt !== 'string') {
    throw new Error('text() expects the prompt to be a string');
  }
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error('text() requires a non-empty prompt string');
  }
  return trimmed;
}

function buildTextParams(options) {
  const params = {};
  const extras = { ...options };

  const model = extras.model ?? DEFAULT_MODEL;
  if (model) {
    params.model = model;
  }
  delete extras.model;

  const seed = extras.seed ?? DEFAULT_SEED;
  if (seed != null) {
    params.seed = seed;
  }
  delete extras.seed;

  assignIfPresent(params, 'temperature', pickFirst(extras, ['temperature']));
  delete extras.temperature;

  const topP = pickFirst(extras, ['top_p', 'topP']);
  assignIfPresent(params, 'top_p', topP);
  delete extras.top_p;
  delete extras.topP;

  const presencePenalty = pickFirst(extras, ['presence_penalty', 'presencePenalty']);
  assignIfPresent(params, 'presence_penalty', presencePenalty);
  delete extras.presence_penalty;
  delete extras.presencePenalty;

  const frequencyPenalty = pickFirst(extras, ['frequency_penalty', 'frequencyPenalty']);
  assignIfPresent(params, 'frequency_penalty', frequencyPenalty);
  delete extras.frequency_penalty;
  delete extras.frequencyPenalty;

  const system = pickFirst(extras, ['system', 'systemPrompt']);
  assignIfPresent(params, 'system', system);
  delete extras.system;
  delete extras.systemPrompt;

  const jsonMode = pickFirst(extras, ['jsonMode', 'json']);
  if (jsonMode !== undefined) {
    params.json = normalizeJsonFlag(jsonMode);
  }
  delete extras.jsonMode;
  delete extras.json;

  if ('private' in extras) {
    params.private = boolToString(extras.private);
    delete extras.private;
  }

  if ('referer' in extras && extras.referer) {
    params.referer = extras.referer;
    delete extras.referer;
  }

  if ('referrer' in extras && extras.referrer) {
    params.referer = params.referer ?? extras.referrer;
    delete extras.referrer;
  }

  for (const [key, value] of Object.entries(extras)) {
    if (value === undefined || value === null) continue;
    params[key] = value;
  }

  return params;
}

function buildChatPayload(options = {}) {
  const extras = { ...options };
  const model = extras.model ?? DEFAULT_MODEL;
  delete extras.model;

  if (!model) {
    throw new Error('chat() requires a model');
  }

  const seed = extras.seed ?? DEFAULT_SEED;
  delete extras.seed;

  const messages = normalizeMessages(extras.messages ?? [], extras.system ?? extras.systemPrompt);
  if (!messages.length) {
    throw new Error('chat() requires at least one message');
  }

  delete extras.messages;
  delete extras.system;
  delete extras.systemPrompt;

  const body = { model, messages };

  if (seed != null) {
    body.seed = seed;
  }

  if ('private' in extras) {
    body.private = !!extras.private;
    delete extras.private;
  }

  const endpoint = extras.endpoint ?? extras.baseEndpoint;
  if (endpoint != null) {
    const normalizedEndpoint = normalizeChatEndpoint(endpoint);
    if (normalizedEndpoint && normalizedEndpoint !== 'openai') {
      body.endpoint = normalizedEndpoint;
    }
  }
  delete extras.endpoint;
  delete extras.baseEndpoint;

  const format = resolveResponseFormat({
    response_format: extras.response_format,
    responseFormat: extras.responseFormat,
    jsonMode: extras.jsonMode,
    json: extras.json,
  });
  if (format.responseFormat !== undefined) {
    body.response_format = format.responseFormat;
  }
  if (format.legacyJson !== undefined) {
    body.json = format.legacyJson;
  }
  delete extras.response_format;
  delete extras.responseFormat;
  delete extras.jsonMode;
  delete extras.json;

  const stream = !!extras.stream;
  delete extras.stream;

  const timeoutMs = extras.timeoutMs;
  delete extras.timeoutMs;

  for (const [key, value] of Object.entries(extras)) {
    if (value === undefined) continue;
    body[key] = value;
  }

  const query = {};
  if (model) {
    query.model = model;
  }
  if (seed != null) {
    query.seed = seed;
  }

  return { body, stream, timeoutMs, query };
}

function normalizeMessages(messages, systemPrompt) {
  const arr = Array.isArray(messages) ? messages.map(message => normalizeMessage(message)) : [];
  if (systemPrompt && !arr.some(message => message.role === 'system')) {
    arr.unshift({ role: 'system', content: systemPrompt });
  }
  return arr;
}

function normalizeMessage(message, defaultRole = 'user') {
  if (typeof message === 'string') {
    return { role: defaultRole, content: message };
  }
  if (typeof message === 'object' && message) {
    const role = message.role ?? defaultRole;
    if (!role) {
      throw new Error('Chat messages require a role');
    }
    if (message.content == null) {
      throw new Error('Chat messages require content');
    }
    return { role, content: message.content };
  }
  throw new Error('Chat messages must be strings or objects with role/content');
}

function extractAssistantMessage(response) {
  const choices = response?.choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  for (const choice of choices) {
    const message = choice?.message;
    if (message?.role === 'assistant' && message.content != null) {
      return { role: 'assistant', content: message.content };
    }
  }
  return null;
}

function normalizeChatEndpoint(endpoint) {
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
  return value.replace(/^\/+/u, '').replace(/\/+$/u, '').toLowerCase() || 'openai';
}

function resolveResponseFormat({ response_format, responseFormat, jsonMode, json }) {
  const direct = normalizeResponseFormat(response_format ?? responseFormat);
  if (direct !== undefined) {
    return { responseFormat: direct, legacyJson: jsonForLegacy(json, direct) };
  }
  if (jsonMode === true) {
    return { responseFormat: { type: 'json_object' }, legacyJson: undefined };
  }
  const alias = normalizeJsonAlias(json);
  if (alias.responseFormat !== undefined) {
    return alias;
  }
  return { responseFormat: undefined, legacyJson: alias.legacyJson };
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

function jsonForLegacy(json, responseFormat) {
  if (!responseFormat || typeof responseFormat !== 'object') return normalizeJsonFlag(json);
  if (responseFormat.type === 'json_object') {
    return undefined;
  }
  return normalizeJsonFlag(json);
}

function normalizeJsonAlias(value) {
  if (value == null) {
    return { responseFormat: undefined, legacyJson: undefined };
  }
  if (value === true || value === 'true') {
    return { responseFormat: { type: 'json_object' }, legacyJson: undefined };
  }
  if (value === false || value === 'false') {
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

function normalizeJsonFlag(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value == null) return undefined;
  return String(value);
}

function boolToString(value) {
  return value == null ? undefined : value ? 'true' : 'false';
}

function assignIfPresent(target, key, value) {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}

function pickFirst(source, keys) {
  for (const key of keys) {
    if (key in source && source[key] !== undefined) {
      return source[key];
    }
  }
  return undefined;
}
