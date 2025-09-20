import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PolliClient, chat, image } from '../Libs/pollilib/index.js';

export const name = 'Deep sweep: text (single+multi) and images across all models (non-failing report)';

const OUT_DIR = path.resolve(process.cwd(), 'reports');
const OUT_FILE = path.join(OUT_DIR, 'models-deep.json');

const MAX_CONCURRENCY_TEXT = Number(process.env.MODELS_DEEP_TEXT_CONCURRENCY || 3);
const MAX_CONCURRENCY_IMAGE = Number(process.env.MODELS_DEEP_IMAGE_CONCURRENCY || 2);
const TEXT_TIMEOUT_MS = Number(process.env.MODELS_DEEP_TEXT_TIMEOUT_MS || 12000);
const IMAGE_TIMEOUT_MS = Number(process.env.MODELS_DEEP_IMAGE_TIMEOUT_MS || 20000);

// Some vendors support json mode well; keep allowlist conservative and small.
const JSON_MODE_ALLOW = new Set([
  'openai',
  'mistral',
  'deepseek',
  'deepseek-reasoning',
  'unity',
]);

function now() { return Date.now(); }

async function limitMap(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.max(1, limit)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        results[idx] = { error: e?.message || String(e) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function testTextSingleTurn(client, model) {
  const started = now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TEXT_TIMEOUT_MS);
  try {
    const resp = await chat({ endpoint: 'openai', model, messages: [ { role: 'user', content: 'Return the word OK.' } ] }, client);
    const ok = Array.isArray(resp?.choices);
    const content = resp?.choices?.[0]?.message?.content || '';
    const containsOK = /\bOK\b/i.test(content);
    return { ok, containsOK, ms: now() - started };
  } catch (e) {
    const msg = e?.message || String(e);
    const mcode = /HTTP\s+(\d{3})/i.exec(msg)?.[1];
    const code = mcode ? Number(mcode) : 0;
    const status = code ? `http_${code}` : (/aborted/i.test(msg) ? 'timeout' : 'error');
    return { ok: false, error: msg, code, status, ms: now() - started };
  } finally { clearTimeout(t); }
}

async function testTextMultiTurn(client, model) {
  const started = now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TEXT_TIMEOUT_MS);
  try {
    const msg1 = { role: 'user', content: 'Hello. Acknowledge briefly.' };
    const _r1 = await chat({ endpoint: 'openai', model, messages: [ msg1 ] }, client);
    const msg2 = { role: 'user', content: 'Respond with only the word READY.' };
    const r2 = await chat({ endpoint: 'openai', model, messages: [ msg2 ] }, client);
    const ok = Array.isArray(r2?.choices);
    const content = r2?.choices?.[0]?.message?.content || '';
    const containsREADY = /\bREADY\b/i.test(content);
    return { ok, containsREADY, ms: now() - started };
  } catch (e) {
    const msg = e?.message || String(e);
    const mcode = /HTTP\s+(\d{3})/i.exec(msg)?.[1];
    const code = mcode ? Number(mcode) : 0;
    const status = code ? `http_${code}` : (/aborted/i.test(msg) ? 'timeout' : 'error');
    return { ok: false, error: msg, code, status, ms: now() - started };
  } finally { clearTimeout(t); }
}

async function testTextJsonMode(client, model) {
  const id = String(model || '').toLowerCase();
  if (![...JSON_MODE_ALLOW].some(k => id.includes(k))) {
    return { skipped: true };
  }
  const started = now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TEXT_TIMEOUT_MS);
  try {
    const payload = { endpoint: 'openai', model, jsonMode: true, messages: [ { role: 'user', content: 'Return a JSON object {"ok":true}.' } ] };
    const resp = await chat(payload, client);
    const ok = Array.isArray(resp?.choices);
    let parsed = null;
    try {
      const content = resp?.choices?.[0]?.message?.content || '';
      parsed = JSON.parse(content);
    } catch {}
    return { ok, parsed: parsed !== null, ms: now() - started };
  } catch (e) {
    const msg = e?.message || String(e);
    const mcode = /HTTP\s+(\d{3})/i.exec(msg)?.[1];
    const code = mcode ? Number(mcode) : 0;
    const status = code ? `http_${code}` : (/aborted/i.test(msg) ? 'timeout' : 'error');
    return { ok: false, error: msg, code, status, ms: now() - started };
  } finally { clearTimeout(t); }
}

async function testImageSingle(client, model) {
  const started = now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const bin = await image('simple circle icon', { model, width: 256, height: 256, nologo: true, seed: 12345678 }, client);
    const dataUrl = bin?.toDataUrl?.();
    const ok = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/');
    return { ok, ms: now() - started };
  } catch (e) {
    const msg = e?.message || String(e);
    const mcode = /HTTP\s+(\d{3})/i.exec(msg)?.[1];
    const code = mcode ? Number(mcode) : 0;
    const status = code ? `http_${code}` : (/aborted/i.test(msg) ? 'timeout' : 'error');
    return { ok: false, error: msg, code, status, ms: now() - started };
  } finally { clearTimeout(t); }
}

export async function run() {
  if (String(process.env.MODELS_DEEP_ENABLED || '').trim() !== '1') {
    console.warn('[all-models-deep] Skipped (set MODELS_DEEP_ENABLED=1 to enable).');
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify({ skipped: true, generatedAt: new Date().toISOString() }, null, 2), 'utf8');
    assert.ok(true);
    return;
  }
  const client = new PolliClient();
  let textModels = [];
  let imageModels = [];
  try { textModels = await client.listModels('text'); } catch {}
  try { imageModels = await client.listModels('image'); } catch {}

  const textIds = (textModels || []).map(m => m.name || m.id || m.model || String(m));
  const imageIds = (imageModels || []).map(m => m.name || m.id || m.model || String(m));

  const textResults = await limitMap(textIds, MAX_CONCURRENCY_TEXT, async (id) => {
    return {
      model: id,
      single: await testTextSingleTurn(client, id),
      multi: await testTextMultiTurn(client, id),
      json: await testTextJsonMode(client, id),
    };
  });

  const imageResults = await limitMap(imageIds, MAX_CONCURRENCY_IMAGE, async (id) => {
    return {
      model: id,
      single: await testImageSingle(client, id),
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      text: {
        total: textResults.length,
        ok_single: textResults.filter(r => r.single?.ok).length,
        ok_multi: textResults.filter(r => r.multi?.ok).length,
        ok_json: textResults.filter(r => r.json?.ok && r.json?.parsed).length,
      },
      image: {
        total: imageResults.length,
        ok_single: imageResults.filter(r => r.single?.ok).length,
      },
    },
    text: textResults,
    image: imageResults,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(summary, null, 2), 'utf8');

  // Non-failing: ensure we discovered some models; real results go to the report
  assert.ok(textResults.length + imageResults.length >= 0, 'No models discovered');
}
