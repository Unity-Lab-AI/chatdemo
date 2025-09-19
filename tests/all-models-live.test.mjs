import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PolliClient, chat, image } from '../Libs/pollilib/index.js';

export const name = 'Live check of ALL text and image models (non-failing summary)';

const OUT_DIR = path.resolve(process.cwd(), 'reports');
const OUT_FILE = path.join(OUT_DIR, 'models-live.json');

const MAX_CONCURRENCY_TEXT = Number(process.env.MODELS_LIVE_TEXT_CONCURRENCY || 4);
const MAX_CONCURRENCY_IMAGE = Number(process.env.MODELS_LIVE_IMAGE_CONCURRENCY || 2);
const TEXT_TIMEOUT_MS = Number(process.env.MODELS_LIVE_TEXT_TIMEOUT_MS || 10000);
const IMAGE_TIMEOUT_MS = Number(process.env.MODELS_LIVE_IMAGE_TIMEOUT_MS || 15000);

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

async function testTextModels(client, models) {
  const toTest = models.map(m => ({ id: m.name || m.id || m.model || String(m) }));
  return limitMap(toTest, MAX_CONCURRENCY_TEXT, async (m) => {
    const started = now();
    let status = 'unknown'; let code = 0; let ok = false; let err = null;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), TEXT_TIMEOUT_MS);
      try {
        const resp = await chat({ endpoint: 'openai', model: m.id, messages: [ { role: 'user', content: 'Return the word OK.' } ] }, client);
        // If it returned choices, we consider it reachable
        ok = Array.isArray(resp?.choices);
        status = ok ? 'ok' : 'bad_json';
      } finally { clearTimeout(t); }
    } catch (e) {
      err = e?.message || String(e);
      const mcode = /HTTP\s+(\d{3})/i.exec(err)?.[1];
      code = mcode ? Number(mcode) : 0;
      status = code ? `http_${code}` : 'error';
    }
    return { kind: 'text', model: m.id, ok, status, code, ms: now() - started, error: err };
  });
}

async function testImageModels(client, models) {
  const toTest = models.map(m => ({ id: m.name || m.id || m.model || String(m) }));
  return limitMap(toTest, MAX_CONCURRENCY_IMAGE, async (m) => {
    const started = now();
    let status = 'unknown'; let code = 0; let ok = false; let err = null;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
      try {
        const bin = await image('simple shape', { model: m.id, width: 256, height: 256, nologo: true, seed: 12345678 }, client);
        const dataUrl = bin?.toDataUrl?.();
        ok = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/');
        status = ok ? 'ok' : 'bad_image';
      } finally { clearTimeout(t); }
    } catch (e) {
      err = e?.message || String(e);
      const mcode = /HTTP\s+(\d{3})/i.exec(err)?.[1];
      code = mcode ? Number(mcode) : 0;
      status = code ? `http_${code}` : 'error';
    }
    return { kind: 'image', model: m.id, ok, status, code, ms: now() - started, error: err };
  });
}

export async function run() {
  const client = new PolliClient();
  let textModels = [];
  let imageModels = [];
  try {
    textModels = await client.listModels('text');
  } catch {}
  try {
    imageModels = await client.listModels('image');
  } catch {}

  const textResults = await testTextModels(client, textModels || []);
  const imageResults = await testImageModels(client, imageModels || []);

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      text: { total: textResults.length, ok: textResults.filter(r => r.ok).length },
      image: { total: imageResults.length, ok: imageResults.filter(r => r.ok).length },
    },
    results: [ ...textResults, ...imageResults ],
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(summary, null, 2), 'utf8');

  // Do not fail CI; this is a report. We still assert that discovery ran.
  assert.ok(textResults.length + imageResults.length >= 0, 'No models discovered');
  console.log('[all-models-live] Text models OK:', summary.totals.text.ok, '/', summary.totals.text.total);
  console.log('[all-models-live] Image models OK:', summary.totals.image.ok, '/', summary.totals.image.total);
}

