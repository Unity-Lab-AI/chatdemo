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
    const method = entry.init.method ?? 'GET';
    if (method === 'POST') {
      const body = entry.init.body ? JSON.parse(entry.init.body) : {};
      const model = body.model ?? 'unknown';
      return new Response(createResponseBody(model), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Hello from Pollinations!', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  };

  const client = new PolliClient({ fetch: fakeFetch, textBase: 'https://text.pollinations.ai' });
  const messages = [{ role: 'user', content: 'Hi there!' }];

  const defaultResponse = await chat(
    {
      model: 'openai',
      messages,
      metadata: { session: 'abc123' },
      user: 'tester-1',
      parallel_tool_calls: false,
      logit_bias: { 42: -1 },
      jsonMode: true,
    },
    client,
  );
  assert.equal(defaultResponse.model, 'openai');
  assert.equal(requests[0].init.method, 'POST');
  const defaultUrl = new URL(requests[0].url);
  assert.ok(defaultUrl.pathname.endsWith('/openai'));
  assert.equal(defaultUrl.searchParams.get('model'), 'openai');
  assert.equal(defaultUrl.searchParams.get('seed'), '12345678');
  assert.equal(defaultUrl.searchParams.get('referer'), 'https://www.unityailab.com');
  const defaultPayload = JSON.parse(requests[0].init.body);
  assert.equal(defaultPayload.model, 'openai');
  assert.equal(defaultPayload.seed, '12345678');
  assert.equal(defaultPayload.endpoint, undefined);
  assert.deepEqual(defaultPayload.metadata, { session: 'abc123' });
  assert.equal(defaultPayload.user, 'tester-1');
  assert.equal(defaultPayload.parallel_tool_calls, false);
  assert.deepEqual(defaultPayload.logit_bias, { 42: -1 });
  assert.deepEqual(defaultPayload.response_format, { type: 'json_object' });
  assert.equal(defaultPayload.json, undefined);

  const seedResponse = await chat(
    {
      model: 'unity',
      endpoint: 'seed',
      messages,
      json: 'json_object',
      reasoning: { effort: 'medium' },
    },
    client,
  );
  assert.equal(seedResponse.model, 'unity');
  assert.equal(seedResponse.choices[0].message.content, 'Hello from Pollinations!');
  assert.equal(requests[1].init.method, 'POST');
  const seedUrl = new URL(requests[1].url);
  assert.ok(seedUrl.pathname.endsWith('/openai'));
  assert.equal(seedUrl.searchParams.get('model'), 'unity');
  assert.equal(seedUrl.searchParams.get('seed'), '12345678');
  assert.equal(seedUrl.searchParams.get('referer'), 'https://www.unityailab.com');
  const parsedSeedBody = JSON.parse(requests[1].init.body);
  assert.equal(parsedSeedBody.model, 'unity');
  assert.equal(parsedSeedBody.seed, '12345678');
  assert.equal(parsedSeedBody.endpoint, 'seed');
  assert.deepEqual(parsedSeedBody.response_format, { type: 'json_object' });
  assert.equal(parsedSeedBody.json, undefined);
  assert.deepEqual(parsedSeedBody.reasoning, { effort: 'medium' });
  assert.deepEqual(parsedSeedBody.messages, messages);
}
