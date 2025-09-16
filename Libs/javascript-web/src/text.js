import { getDefaultClient } from './client.js';
import { sseEvents } from './sse.js';

export async function text(prompt, {
  model, seed, temperature, top_p, presence_penalty, frequency_penalty, json, system, stream, private: priv, referrer,
} = {}, client = getDefaultClient()) {
  const url = `${client.textBase}/${encodeURIComponent(prompt)}`;
  const params = {};
  if (model) params.model = model;
  if (seed != null) params.seed = seed;
  if (temperature != null) params.temperature = temperature;
  if (top_p != null) params.top_p = top_p;
  if (presence_penalty != null) params.presence_penalty = presence_penalty;
  if (frequency_penalty != null) params.frequency_penalty = frequency_penalty;
  if (json) params.json = 'true';
  if (system) params.system = system;
  if (priv != null) params.private = !!priv;
  if (referrer) params.referrer = referrer;

  if (stream) {
    params.stream = 'true';
    const r = await client.get(url, { params, headers: { 'Accept': 'text/event-stream' } });
    if (!r.ok) throw new Error(`text(stream) error ${r.status}`);
    return (async function* () {
      for await (const data of sseEvents(r)) {
        if (String(data).trim() === '[DONE]') break;
        yield data;
      }
    })();
  } else {
    const r = await client.get(url, { params });
    if (!r.ok) throw new Error(`text error ${r.status}`);
    return await r.text();
  }
}

export async function chat({ model, messages, seed, temperature, top_p, presence_penalty, frequency_penalty, max_tokens, stream, private: priv, tools, tool_choice, referrer }, client = getDefaultClient()) {
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
  if (referrer) body.referrer = referrer;

  if (stream) {
    body.stream = true;
    const r = await client.postJson(url, body, { headers: { 'Accept': 'text/event-stream' } });
    if (!r.ok) throw new Error(`chat(stream) error ${r.status}`);
    return (async function* () {
      for await (const data of sseEvents(r)) {
        if (String(data).trim() === '[DONE]') break;
        yield JSON.parse(data);
      }
    })();
  } else {
    const r = await client.postJson(url, body);
    if (!r.ok) throw new Error(`chat error ${r.status}`);
    return await r.json();
  }
}

export async function textModels(client = getDefaultClient()) {
  const r = await client.get(`${client.textBase}/models`);
  if (!r.ok) throw new Error(`textModels error ${r.status}`);
  return await r.json();
}

export async function search(query, model = 'searchgpt', client = getDefaultClient()) {
  return await text(query, { model }, client);
}

