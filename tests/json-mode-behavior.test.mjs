import assert from 'node:assert/strict';
import { PolliClient, chat } from '../Libs/pollilib/index.js';

export const name = 'JSON mode attempt with fallback for a few known models';

async function tryChat(model, opts = {}) {
  const client = new PolliClient();
  const messages = [
    { role: 'user', content: 'Reply with a tiny JSON object: {"text":"OK"}' },
  ];
  const payload = { endpoint: 'openai', model, messages, ...(opts || {}) };
  return await chat(payload, client);
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export async function run() {
  const models = ['openai', 'qwen-coder'];
  for (const m of models) {
    // First try with JSON response_format
    let got = null;
    try {
      const resp = await tryChat(m, { response_format: { type: 'json_object' } });
      assert.ok(Array.isArray(resp?.choices), `choices missing for ${m} (json mode)`);
      const content = resp.choices[0]?.message?.content ?? '';
      const obj = safeParse(content);
      if (obj && typeof obj === 'object') {
        got = 'json';
      }
    } catch (e) {
      // ignore, will retry without JSON
    }

    if (!got) {
      const resp = await tryChat(m);
      assert.ok(Array.isArray(resp?.choices), `choices missing for ${m} (fallback)`);
      got = 'text';
    }
  }
}

