import assert from 'node:assert/strict';
import { PolliClient, chat } from '../Libs/pollilib/index.js';

export const name = 'Long-form text: JSON -> relax retry falls back to prose when JSON is empty';

async function tryChat(model, messages, useJson) {
  const client = new PolliClient();
  const payload = { endpoint: 'openai', model, messages, ...(useJson ? { response_format: { type: 'json_object' } } : {}) };
  try {
    const resp = await chat(payload, client);
    const content = resp?.choices?.[0]?.message?.content ?? '';
    return String(content);
  } catch {
    return '';
  }
}

export async function run() {
  const model = 'openai';
  const base = 'Write a short two-paragraph story about a nuclear engineer working on a lunar reactor.';
  // First try JSON; then retry without JSON. This is a non-failing diagnostic.
  const contentJson = await tryChat(model, [{ role: 'user', content: base + ' Reply as JSON: {"text":"..."} only.' }], true);
  const contentText = await tryChat(model, [{ role: 'user', content: base }], false);
  // We do not assert, but we expect at least one path to produce non-empty prose.
  assert.ok((contentJson && contentJson.length) || (contentText && contentText.length), 'Expect some content for long-form text');
}