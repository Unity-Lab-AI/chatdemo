import test from 'node:test';
import assert from 'node:assert/strict';

import { PolliClient } from '../polliLib/index.js';
import { FakeResponse, SeqFetch } from './helpers.js';

test('random seed range + variety', async () => {
  const seq = new SeqFetch();
  const c = new PolliClient({ fetch: seq.fetch.bind(seq) });
  const seeds = Array.from({ length: 20 }, () => c._randomSeed());
  assert.ok(seeds.every(s => s >= 10000 && s <= 99999999));
  assert.ok(seeds.some(s => s < 1_000_000));
  assert.ok(seeds.some(s => s >= 10_000_000));
});

test('generate_text JSON and query params', async () => {
  const seq = new SeqFetch([ new FakeResponse({ text: '{"answer":1}' }) ]);
  const c = new PolliClient({ fetch: seq.fetch.bind(seq) });
  const out = await c.generate_text('hi', { asJson: true, referrer: 'app', token: 'tok' });
  assert.deepEqual(out, { answer: 1 });
  const call = seq.calls[0];
  assert.match(call.url, /referrer=app/);
  assert.match(call.url, /token=tok/);
  const parsedUrl = new URL(call.url);
  assert.equal(parsedUrl.searchParams.get('safe'), 'false');
});

test('chat_completion payload + content extraction', async () => {
  const seq = new SeqFetch([ new FakeResponse({ jsonData: { choices: [ { message: { content: 'ok' } } ] } }) ]);
  const c = new PolliClient({ fetch: seq.fetch.bind(seq) });
  const resp = await c.chat_completion([ { role: 'user', content: 'hi' } ], { referrer: 'r', token: 't' });
  assert.equal(resp, 'ok');
  const call = seq.calls[0];
  const body = JSON.parse(call.opts.body);
  assert.equal(body.referrer, 'r');
  assert.equal(body.token, 't');
  assert.equal(body.safe, false);
});

test('chat_completion_stream SSE yields content chunks', async () => {
  const lines = [
    'event: message',
    'data: {"choices":[{"delta":{"content":"Hel"}}]}',
    'data: {"choices":[{"delta":{"content":"lo"}}]}',
    'data: [DONE]'
  ];
  const seq = new SeqFetch([ new FakeResponse({ streamLines: lines }) ]);
  const c = new PolliClient({ fetch: seq.fetch.bind(seq) });
  let s = '';
  for await (const part of c.chat_completion_stream([ { role:'user', content: 'hi' } ])) s += part;
  assert.equal(s, 'Hello');
  const streamBody = JSON.parse(seq.calls[0].opts.body);
  assert.equal(streamBody.safe, false);
});

test('chat_completion_tools two-step', async () => {
  const first = new FakeResponse({ jsonData: { choices: [ { message: { tool_calls: [ { id: 'tc1', function: { name: 'get_current_weather', arguments: JSON.stringify({ location: 'Tokyo', unit: 'celsius' }) } } ] } } ] } });
  const second = new FakeResponse({ jsonData: { choices: [ { message: { content: 'Weather is Cloudy' } } ] } });
  const seq = new SeqFetch([ first, second ]);
  const c = new PolliClient({ fetch: seq.fetch.bind(seq) });
  const out = await c.chat_completion_tools([ { role: 'user', content: 'Weather?' } ], { tools: [ { type: 'function', function: { name: 'get_current_weather', parameters: { type:'object' } } } ], functions: { get_current_weather: ({location, unit}) => ({ location, unit, temperature: '15', description: 'Cloudy' }) } });
  assert.equal(out, 'Weather is Cloudy');
  const firstBody = JSON.parse(seq.calls[0].opts.body);
  const secondBody = JSON.parse(seq.calls[1].opts.body);
  assert.equal(firstBody.safe, false);
  assert.equal(secondBody.safe, false);
});

test('generate_text enforces minimum 3s spacing between successes', async () => {
  const seq = new SeqFetch([
    new FakeResponse({ text: 'first' }),
    new FakeResponse({ text: 'second' }),
  ]);
  const sleeps = [];
  const c = new PolliClient({
    fetch: seq.fetch.bind(seq),
    sleep: async (ms) => { sleeps.push(ms); },
  });
  const first = await c.generate_text('hello');
  assert.equal(first, 'first');
  const second = await c.generate_text('world');
  assert.equal(second, 'second');
  assert.ok(sleeps.some((ms) => ms >= 2990), `expected >=2990ms wait, saw ${sleeps}`);
});

test('generate_text retries quickly when hitting rate limits', async () => {
  const seq = new SeqFetch([
    new FakeResponse({ status: 429, text: 'limit' }),
    new FakeResponse({ status: 503, text: 'busy' }),
    new FakeResponse({ text: 'ok' }),
  ]);
  const sleeps = [];
  const c = new PolliClient({
    fetch: seq.fetch.bind(seq),
    sleep: async (ms) => { sleeps.push(ms); },
  });
  const result = await c.generate_text('retry please');
  assert.equal(result, 'ok');
  const rounded = sleeps.map((ms) => Math.round(ms));
  assert.deepEqual(rounded.slice(0, 2), [500, 600]);
});

test('generate_text uses client timeout when not specified per-call', async () => {
  let aborts = 0;
  const fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout exceeded')), 500);
    const onAbort = () => {
      clearTimeout(timer);
      aborts += 1;
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (opts.signal) {
      if (opts.signal.aborted) { onAbort(); return; }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  const c = new PolliClient({
    fetch,
    timeoutMs: 25,
    minRequestIntervalMs: 0,
    retryInitialDelayMs: 0,
    retryDelayStepMs: 0,
    retryMaxDelayMs: 0,
    sleep: async () => {},
  });
  const start = Date.now();
  await assert.rejects(() => c.generate_text('hi'), (err) => /abort/i.test(err.name) || /abort/i.test(err.message));
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 20 && elapsed < 200, `expected abort near 25ms, observed ${elapsed}`);
  assert.equal(aborts, 1);
});

test('generate_text allows explicit timeout override per request', async () => {
  let aborts = 0;
  const fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout exceeded')), 500);
    const onAbort = () => {
      clearTimeout(timer);
      aborts += 1;
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (opts.signal) {
      if (opts.signal.aborted) { onAbort(); return; }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  const c = new PolliClient({
    fetch,
    timeoutMs: 250,
    minRequestIntervalMs: 0,
    retryInitialDelayMs: 0,
    retryDelayStepMs: 0,
    retryMaxDelayMs: 0,
    sleep: async () => {},
  });
  const start = Date.now();
  await assert.rejects(() => c.generate_text('hi', { timeoutMs: 40 }), (err) => /abort/i.test(err.name) || /abort/i.test(err.message));
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 30 && elapsed < 200, `expected abort near 40ms, observed ${elapsed}`);
  assert.equal(aborts, 1);
});

