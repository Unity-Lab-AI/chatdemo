import assert from 'node:assert/strict';
import { PolliClient, text } from '../Libs/pollilib/index.js';

export const name = 'PolliLib text() generates a response';

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

  const client = new PolliClient({
    fetch: fakeFetch,
    auth: { mode: 'referrer', referrer: 'https://github.com/Unity-Lab-AI/chatdemo' },
    timeoutMs: 5_000,
  });

  const prompt = 'Say hello to Pollinations';
  const response = await text(prompt, { model: 'webgpt', temperature: 0.7 }, client);

  assert.equal(response, 'Hello from Pollinations!');
  assert.equal(requests.length, 1, 'Expected the mock fetch to be invoked once');
  assert.equal(requests[0].init.method, 'GET');
  const url = new URL(requests[0].url);
  assert.ok(url.pathname.endsWith('/openai'), 'Text requests should use the /openai endpoint');
  assert.equal(url.searchParams.get('input'), prompt);
  assert.equal(url.searchParams.get('model'), 'webgpt');
  assert.equal(url.searchParams.get('seed'), '12345678');
  assert.equal(url.searchParams.get('referer'), 'https://github.com/Unity-Lab-AI/chatdemo');

  requests.length = 0;
  const defaultClient = new PolliClient({ fetch: fakeFetch });
  const defaultPrompt = 'Hello Unity';
  await text(defaultPrompt, undefined, defaultClient);

  assert.equal(requests.length, 1, 'Default client should issue a single request');
  const defaultRequest = requests[0];
  assert.equal(defaultRequest.init.method, 'GET');
  const defaultUrl = new URL(defaultRequest.url);
  assert.ok(defaultUrl.pathname.endsWith('/openai'), 'Default client should target /openai');
  assert.equal(defaultUrl.searchParams.get('input'), defaultPrompt);
  assert.equal(defaultUrl.searchParams.get('model'), 'unity');
  assert.equal(defaultUrl.searchParams.get('seed'), '12345678');
  assert.equal(defaultUrl.searchParams.get('referer'), 'https://www.unityailab.com');
  assert.equal(defaultUrl.searchParams.get('token'), 'POLLI_TOKEN');
}
