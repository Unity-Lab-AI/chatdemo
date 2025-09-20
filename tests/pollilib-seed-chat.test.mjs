import assert from 'node:assert/strict';
import { PolliClient, chat } from '../Libs/pollilib/index.js';

export const name = 'PolliLib chat() posts payloads to /seed for the seed endpoint';

export async function run() {
  const requests = [];
  const fakeFetch = async (url, init) => {
    const entry = { url: String(url), init: { ...(init ?? {}) } };
    requests.push(entry);
    const body = entry.init.body ? JSON.parse(entry.init.body) : {};
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-seed',
        object: 'chat.completion',
        created: Date.now(),
        model: body.model ?? 'unknown',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Unity says hi!' },
            finish_reason: 'stop',
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  const client = new PolliClient({ fetch: fakeFetch });

  const messages = [
    { role: 'user', content: 'Hello there!' },
  ];

  const tools = [ { type: 'function', function: { name: 'noop', parameters: { type:'object' } } } ];
  const result = await chat({ endpoint: 'seed', model: 'unity', messages, tools, temperature: 0.2 }, client);

  assert.equal(result.model, 'unity');
  assert.equal(result.choices[0].message.role, 'assistant');
  assert.equal(result.choices[0].message.content, 'Unity says hi!');

  assert.equal(requests.length, 1, 'Expected exactly one seed request');
  const request = requests[0];
  assert.equal(request.init.method, 'POST');

  const url = new URL(request.url);
  assert.ok(url.pathname.endsWith('/openai'), 'Seed requests should hit the /openai endpoint');
  // seed is randomized by the client; we do not assert it
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.referrer, 'https://www.unityailab.com');
  assert.equal(payload.model, 'unity');
  assert.deepEqual(payload.messages, messages);
}



