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

export async function chat({
  model,
  messages,
  seed,
  temperature,
  top_p,
  presence_penalty,
  frequency_penalty,
  max_tokens,
  stream,
  private: priv,
  tools,
  tool_choice,
  response_format,
  timeoutMs,
  endpoint,
} = {}, client = getDefaultClient()) {
  if (!model) throw new Error('chat() requires a model');
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error('chat() requires a non-empty messages array');
  }
  const targetEndpoint = resolveChatEndpoint(endpoint);
  if (targetEndpoint === 'seed') {
    return await performSeedChat(
      {
        model,
        messages,
        seed,
        temperature,
        top_p,
        presence_penalty,
        frequency_penalty,
        max_tokens,
        private: priv,
        response_format,
        timeoutMs,
        stream,
      },
      client,
    );
  }
  const url = `${client.textBase}/${encodeURIComponent(targetEndpoint)}`;
  const body = { model, messages };
  if (seed != null) body.seed = seed;
  if (temperature != null) body.temperature = temperature;
  if (top_p != null) body.top_p = top_p;
  if (presence_penalty != null) body.presence_penalty = presence_penalty;
  if (frequency_penalty != null) body.frequency_penalty = frequency_penalty;
  if (max_tokens != null) body.max_tokens = max_tokens;
  if (priv != null) body.private = !!priv;
  if (tools) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;
  if (response_format) body.response_format = response_format;

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

async function performSeedChat(
  {
    model,
    messages,
    seed,
    temperature,
    top_p,
    presence_penalty,
    frequency_penalty,
    max_tokens,
    private: priv,
    response_format,
    timeoutMs,
    stream,
  },
  client,
) {
  if (stream) {
    throw new Error('Seed endpoint currently does not support streaming responses.');
  }
  const prompt = buildSeedPrompt(messages);
  const url = `${client.textBase}/${encodeURIComponent(prompt)}`;
  const params = {};
  if (model) params.model = model;
  if (seed != null) params.seed = seed;
  if (temperature != null) params.temperature = temperature;
  if (top_p != null) params.top_p = top_p;
  if (presence_penalty != null) params.presence_penalty = presence_penalty;
  if (frequency_penalty != null) params.frequency_penalty = frequency_penalty;
  if (max_tokens != null) params.max_tokens = max_tokens;
  if (priv != null) params.private = boolString(priv);

  let expectJson = false;
  if (response_format) {
    if (response_format === 'json_object') {
      expectJson = true;
    } else if (
      typeof response_format === 'object' &&
      response_format !== null &&
      response_format.type === 'json_object'
    ) {
      expectJson = true;
    }
  }
  if (expectJson) params.json = 'true';

  const response = await client.get(url, { params, timeoutMs });
  await raiseForStatus(response, 'chat(seed)');
  let bodyText = await response.text();
  if (!expectJson) {
    bodyText = bodyText ?? '';
  }

  const created = Math.floor(Date.now() / 1000);
  const completionId = `pllns_${created.toString(36)}${Math.random().toString(36).slice(2)}`;
  return {
    id: completionId,
    object: 'chat.completion',
    created,
    model: model ?? 'seed',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: expectJson ? bodyText : String(bodyText ?? ''),
        },
      },
    ],
  };
}

function buildSeedPrompt(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  if (!safeMessages.length) {
    throw new Error('chat(seed) requires at least one message.');
  }
  const lines = [];
  for (const message of safeMessages) {
    const roleLabel = describeRole(message?.role, message?.name);
    const parts = [];
    const content = extractChatContent(message?.content);
    if (content) parts.push(content);
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
      for (const call of message.tool_calls) {
        const description = formatToolCall(call);
        if (description) parts.push(description);
      }
    }
    lines.push(parts.length ? `${roleLabel}: ${parts.join('\n')}` : `${roleLabel}:`);
  }
  lines.push('Assistant:');
  return lines.join('\n\n');
}

function describeRole(role, name) {
  if (!role) return 'Message';
  const normalized = String(role).trim().toLowerCase();
  switch (normalized) {
    case 'system':
      return 'System';
    case 'user':
      return name ? `User (${name})` : 'User';
    case 'assistant':
      return 'Assistant';
    case 'tool':
      return name ? `Tool (${name})` : 'Tool';
    default:
      return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Message';
  }
}

function extractChatContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(entry => {
        if (!entry) return '';
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object') {
          if (entry.text != null) return String(entry.text);
          if (entry.content != null) return String(entry.content);
          if (entry.type === 'text' && entry.value != null) return String(entry.value);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content === 'object') {
    if (content.text != null) return String(content.text);
    if (content.content != null) return String(content.content);
  }
  return String(content);
}

function formatToolCall(call) {
  if (!call) return '';
  try {
    return `Tool call: ${JSON.stringify(call)}`;
  } catch {
    return 'Tool call: [unserializable]';
  }
}
