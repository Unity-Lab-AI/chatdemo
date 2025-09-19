import assert from 'node:assert/strict';
import { PolliClient, chat } from '../Libs/pollilib/index.js';

export const name = 'PolliLib chat() targets correct endpoints and payload';

function createResponseBody(model) {
  return JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion', created: Date.now(), model, choices: [ { index: 0, message: { role: 'assistant', content: 'Hello from Pollinations!' }, finish_reason: 'stop' } ] });
}

export async function run() {
  const requests = [];
  const fakeFetch = async (url, init) => {
    const entry = { url: String(url), init: { ...(init ?? {}) } };
    requests.push(entry);
    const method = entry.init.method ?? 'GET';
    if (method === 'POST') {
      const body = entry.init.body ? JSON.parse(entry.init.body) : {};
      const model = body.model ?? 'unknown';
      return new Response(createResponseBody(model), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  };

  const client = new PolliClient({ fetch: fakeFetch });
  const messages = [{ role: 'user', content: 'Hi there!' }];
  const tools = [ { type: 'function', function: { name: 'noop', parameters: { type:'object' } } } ];

  const defaultResponse = await chat({ endpoint: 'openai', messages, tools }, client);
  assert.equal(defaultResponse.model, 'openai');
  assert.equal(requests[0].init.method, 'POST');
  const defaultUrl = new URL(requests[0].url);
  assert.ok(defaultUrl.pathname.endsWith('/openai'));
  const defaultPayload = JSON.parse(requests[0].init.body);
  const defaultQs = new URL(requests[0].url).searchParams;
  assert.equal(defaultQs.get('model'), 'openai');
  assert.deepEqual(defaultPayload.messages, messages);

  const seedResponse = await chat({ endpoint: 'seed', model: 'unity', messages, tools }, client);
  assert.equal(seedResponse.model, 'unity');
  assert.equal(seedResponse.choices[0].message.content, 'Hello from Pollinations!');
  assert.equal(requests[1].init.method, 'POST');
  const seedUrl = new URL(requests[1].url);
  assert.ok(seedUrl.pathname.endsWith('/openai'));
  const parsedSeedBody = JSON.parse(requests[1].init.body);
  const seedQs = new URL(requests[1].url).searchParams;
  assert.equal(seedQs.get('model'), 'unity');
  assert.deepEqual(parsedSeedBody.messages, messages);
}
