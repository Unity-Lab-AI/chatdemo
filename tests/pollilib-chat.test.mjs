import assert from 'node:assert/strict';
import { PolliClient, chat } from '../Libs/pollilib/index.js';

export const name = 'PolliLib chat() uses configurable endpoints';

function createResponseBody(model) {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Date.now(),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello from Pollinations!' },
        finish_reason: 'stop',
      },
    ],
  });
}

export async function run() {
  const requests = [];
  const fakeFetch = async (url, init) => {
    const entry = { url: String(url), init: { ...(init ?? {}) } };
    requests.push(entry);
    const model = entry.url.endsWith('/seed') ? 'unity' : 'openai';
    return new Response(createResponseBody(model), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const client = new PolliClient({ fetch: fakeFetch, textBase: 'https://text.pollinations.ai' });
  const messages = [{ role: 'user', content: 'Hi there!' }];

  const defaultResponse = await chat({ model: 'openai', messages }, client);
  assert.equal(defaultResponse.model, 'openai');
  assert.equal(requests[0].init.method, 'POST');
  assert.ok(requests[0].url.endsWith('/openai'));
  assert.equal(JSON.parse(requests[0].init.body).model, 'openai');

  const seedResponse = await chat({ model: 'unity', endpoint: 'seed', messages }, client);
  assert.equal(seedResponse.model, 'unity');
  assert.equal(requests[1].init.method, 'POST');
  assert.ok(requests[1].url.endsWith('/seed'));
  assert.equal(JSON.parse(requests[1].init.body).model, 'unity');
}
