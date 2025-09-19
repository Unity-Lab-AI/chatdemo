import assert from 'node:assert/strict';
import { createPollinationsClient } from '../src/pollinations-client.js';
import { chat } from '../Libs/pollilib/index.js';

export const name = 'Chat wrapper includes referrer in payload';

export async function run() {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  try {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return { ok: true, status: 200, async json() { return { choices: [ { message: { content: 'ok' } } ] }; }, async text() { return ''; }, headers: { get() { return 'application/json'; } } };
    };

    const url = new URL('https://demo.example.com/chat/?foo=bar#pane');
    const location = { href: url.toString(), origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash };
    globalThis.window = { location };
    globalThis.document = { location: { origin: url.origin } };

    const { client } = await createPollinationsClient();
    const messages = [ { role: 'user', content: 'hi' } ];
    const tools = [ { type: 'function', function: { name: 'noop', parameters: { type: 'object' } } } ];
    await chat({ endpoint: 'openai', messages, tools }, client);

    assert.ok(calls.length >= 1, 'expected a network call');
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(typeof body.referrer, 'string');
    assert.equal(body.referrer, 'https://demo.example.com');
  } finally {
    if (originalFetch) globalThis.fetch = originalFetch; else delete globalThis.fetch;
    if (typeof originalWindow === 'undefined') delete globalThis.window; else globalThis.window = originalWindow;
    if (typeof originalDocument === 'undefined') delete globalThis.document; else globalThis.document = originalDocument;
  }
}
