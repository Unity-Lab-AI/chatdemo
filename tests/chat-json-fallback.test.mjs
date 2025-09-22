import assert from 'node:assert/strict';
import { PolliClient, chat } from '../Libs/pollilib/index.js';

export const name = 'chat() falls back to plain text when JSON response_format fails';

export async function run() {
  const requests = [];
  const responses = [
    { ok: false, status: 500, statusText: 'Server error' },
    {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'openai',
        metadata: {},
        choices: [{ message: { content: 'Paragraph one.\n\nParagraph two.' } }],
      }),
    },
  ];

  const fakeFetch = async (_url, options = {}) => {
    const index = requests.length < responses.length ? requests.length : responses.length - 1;
    const { body } = options || {};
    requests.push({
      url: _url,
      body: typeof body === 'string' ? body : null,
    });
    const template = responses[index];
    if (!template.ok) {
      return {
        ok: false,
        status: template.status,
        statusText: template.statusText,
        json: async () => {
          throw new Error('no body');
        },
      };
    }
    return {
      ok: true,
      status: template.status,
      json: template.json,
    };
  };

  globalThis.__PANEL_LOG__ = [];
  const client = new PolliClient({ fetch: fakeFetch, textPromptBase: 'https://example.com' });

  const payload = {
    model: 'openai',
    endpoint: 'openai',
    messages: [{ role: 'user', content: 'Write two short paragraphs.' }],
    response_format: { type: 'json_object' },
  };

  const resp = await chat(payload, client);
  assert.ok(Array.isArray(resp?.choices), 'choices should be returned');
  const content = resp.choices[0]?.message?.content ?? '';
  assert.equal(content, 'Paragraph one.\n\nParagraph two.');
  assert.equal(requests.length, 2, 'expected an initial JSON attempt and one fallback request');

  const firstBody = JSON.parse(requests[0].body ?? '{}');
  const secondBody = JSON.parse(requests[1].body ?? '{}');
  assert.ok(firstBody.response_format, 'first request should include response_format');
  assert.ok(!('response_format' in secondBody), 'fallback should omit response_format');

  const meta = resp?.metadata ?? {};
  assert.equal(meta.response_format_requested, true, 'metadata should record JSON attempt');
  assert.equal(meta.response_format_used, false, 'metadata should indicate fallback removed JSON constraint');
  assert.equal(meta.jsonFallbackUsed, true, 'metadata should mark fallback path');
}
