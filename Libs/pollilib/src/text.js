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
} = {}, client = getDefaultClient()) {
  if (!model) throw new Error('chat() requires a model');
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error('chat() requires a non-empty messages array');
  }
  const url = `${client.textBase}/openai`;
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
