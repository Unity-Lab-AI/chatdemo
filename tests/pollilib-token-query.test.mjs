import assert from 'node:assert/strict';
import { PolliClient, chat } from '../Libs/pollilib/index.js';

export const name = 'PolliLib seed chat payloads include query tokens';

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
    if (method === 'POST') {
      return createResponse(
        JSON.stringify({
          id: 'chatcmpl-token',
          object: 'chat.completion',
          created: Date.now(),
          model: 'unity',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Unity says hi!' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
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
  assert.equal(request.init.method, 'POST');
  const requestUrl = new URL(request.url);
  assert.ok(requestUrl.pathname.endsWith('/openai'));
  assert.equal(requestUrl.searchParams.get('token'), 'example-token');
  const authHeader = request.init.headers?.Authorization ?? request.init.headers?.authorization;
  assert.equal(authHeader, 'Bearer example-token');
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.endpoint, 'seed');
  assert.deepEqual(payload.messages, messages);
}
