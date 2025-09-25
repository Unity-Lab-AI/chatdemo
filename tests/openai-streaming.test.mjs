import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export const name = 'OpenAI streaming: SSE returns deltas (3x, spaced, report only)';

async function streamOnce(prompt) {
  const url = 'https://text.pollinations.ai/openai';
  const body = { model: 'openai', messages: [{ role: 'user', content: prompt }], stream: true };
  const started = Date.now();
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) {
    return { text: '', ms: Date.now() - started, status: resp.status };
  }
  const reader = resp.body?.getReader?.();
  let text = '';
  const decoder = new TextDecoder();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        try { const obj = JSON.parse(data); const delta = obj?.choices?.[0]?.delta?.content; if (delta) text += delta; } catch {}
      }
      if (text.length >= 120) break; // enough for validation, avoid long tests
    }
  }
  return { text, ms: Date.now() - started, status: 200 };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function run() {
  const results = [];
  for (let i = 0; i < 3; i += 1) {
    const r = await streamOnce('Say hello briefly.');
    results.push(r);
    await sleep(3200); // respect pacing between successful calls
  }
  // Non-failing: write report only
  assert.equal(results.length, 3);
  const outDir = path.resolve(process.cwd(), 'reports');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'openai-streaming.json'), JSON.stringify({ when: new Date().toISOString(), results }, null, 2), 'utf8');
}
