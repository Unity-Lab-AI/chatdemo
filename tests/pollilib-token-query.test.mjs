import assert from 'node:assert/strict';
import { PolliClient, chat } from '../Libs/pollilib/index.js';

export const name = 'PolliLib seed chat requests include query tokens';

function createResponse(body) {
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
  const fakeFetch = async (url, init = {}) => {
    requests.push({ url: String(url), init: { ...init } });
    const method = init.method ?? 'GET';
    if (method === 'GET') {
      return createResponse('Unity says hi!');
    }
    return createResponse('');
  };

  const client = new PolliClient({
    fetch: fakeFetch,
    auth: { mode: 'token', token: 'example-token' },
    timeoutMs: 1_000,
  });

  const messages = [{ role: 'user', content: 'Say hello' }];
  const result = await chat({ model: 'unity', endpoint: 'seed', messages }, client);

  assert.equal(result.model, 'unity');
  assert.equal(result.choices?.[0]?.message?.content, 'Unity says hi!');
  assert.equal(requests.length, 1, 'Expected a single request to be issued.');
  const [request] = requests;
  assert.equal(request.init.method, 'GET');
  const requestUrl = new URL(request.url);
  assert.equal(requestUrl.searchParams.get('token'), 'example-token');
  const authHeader = request.init.headers?.Authorization ?? request.init.headers?.authorization;
  assert.equal(authHeader, 'Bearer example-token');
}
