import assert from 'node:assert/strict';
import { PolliClient, chat } from '../Libs/pollilib/index.js';

export const name = 'PolliLib chat() flattens conversations for the seed endpoint';

export async function run() {
  const requests = [];
  const fakeFetch = async (url, init) => {
    const entry = { url: String(url), init: { ...(init ?? {}) } };
    requests.push(entry);
    return new Response('Unity says hi!', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  };

  const client = new PolliClient({ fetch: fakeFetch, textBase: 'https://text.pollinations.ai' });

  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello there!' },
  ];

  const result = await chat({ model: 'unity', endpoint: 'seed', messages, temperature: 0.2 }, client);

  assert.equal(result.model, 'unity');
  assert.equal(result.choices[0].message.role, 'assistant');
  assert.equal(result.choices[0].message.content, 'Unity says hi!');

  assert.equal(requests.length, 1, 'Expected exactly one seed request');
  const request = requests[0];
  assert.equal(request.init.method, 'GET');

  const url = new URL(request.url);
  assert.equal(url.searchParams.get('model'), 'unity');
  assert.equal(url.searchParams.get('temperature'), '0.2');

  const prompt = decodeURIComponent(url.pathname.slice(1));
  assert(prompt.includes('System: You are a helpful assistant.'), 'Prompt should include the system message');
  assert(prompt.includes('User: Hello there!'), 'Prompt should include the user content');
  assert(prompt.trim().endsWith('Assistant:'), 'Prompt should end with an assistant cue');
}
