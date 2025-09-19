import assert from 'node:assert/strict';
import { PolliClient } from '../Libs/pollilib/index.js';

export const name = 'PolliLib generate_text() generates a response';

function createMockResponse(body) {
  if (typeof Response === 'function') {
    return new Response(body, { status: 200 });
  }
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async text() {
      return body;
    },
    headers: new Map(),
  };
}

export async function run() {
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url: String(url), init: { ...(init ?? {}) } });
    return createMockResponse('Hello from Pollinations!');
  };

  const client = new PolliClient({ fetch: fakeFetch, timeoutMs: 5_000 });

  const prompt = 'Say hello to Pollinations';
  const response = await client.generate_text(prompt, { model: 'webgpt', referrer: 'https://github.com/Unity-Lab-AI/chatdemo' });

  assert.equal(response, 'Hello from Pollinations!');
  assert.equal(requests.length, 1, 'Expected the mock fetch to be invoked once');
  assert.equal(requests[0].init.method, 'GET');
  const url = new URL(requests[0].url);
  assert.ok(url.href.startsWith('https://text.pollinations.ai/'), 'Text requests should use text base');
  assert.ok(url.pathname.length > 1, 'Prompt is encoded in the path');
  assert.equal(url.searchParams.get('model'), 'webgpt');
  assert.equal(url.searchParams.get('referrer'), 'https://github.com/Unity-Lab-AI/chatdemo');

  requests.length = 0;
  const defaultClient = new PolliClient({ fetch: fakeFetch });
  const defaultPrompt = 'Hello Unity';
  await defaultClient.generate_text(defaultPrompt);

  assert.equal(requests.length, 1, 'Default client should issue a single request');
  const defaultRequest = requests[0];
  assert.equal(defaultRequest.init.method, 'GET');
  const defaultUrl = new URL(defaultRequest.url);
  assert.ok(defaultUrl.href.startsWith('https://text.pollinations.ai/'));
  assert.ok(defaultUrl.pathname.length > 1);
  // model defaults to 'openai' in PolliLib generate_text
  assert.equal(defaultUrl.searchParams.get('model'), 'openai');
}
