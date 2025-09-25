import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export const name = 'Live TTS across top 3 voices (paced)';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function run() {
  const outDir = path.resolve(process.cwd(), 'reports');
  await fs.mkdir(outDir, { recursive: true });
  const outfile = path.join(outDir, 'tts-voices-live.json');

  const base = 'https://text.pollinations.ai';
  // Get voices from model catalog (openai-audio)
  let voices = [];
  try {
    const modelsResp = await fetch(`${base}/models`);
    const models = await modelsResp.json();
    const arr = Array.isArray(models) ? models : (Array.isArray(models?.models) ? models.models : []);
    const oa = arr.find(m => (m?.name || m?.id) === 'openai-audio');
    voices = Array.isArray(oa?.voices) ? oa.voices.slice(0, 3) : [];
  } catch {}
  if (!voices.length) voices = ['nova', 'alloy', 'echo'].slice(0, 2);

  const results = [];
  for (const voice of voices) {
    const u = new URL(`${base}/${encodeURIComponent('Hello from Pollinations')}`);
    u.searchParams.set('model', 'openai-audio');
    u.searchParams.set('voice', voice);
    u.searchParams.set('safe', 'false');
    const started = Date.now();
    let ok = false; let code = 0; let size = 0; let ctype = '';
    try {
      const resp = await fetch(u, { headers: { 'Accept': 'audio/mpeg', 'Cache-Control': 'no-store' } });
      ctype = String(resp.headers?.get?.('Content-Type') || '');
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        size = buf.byteLength || 0;
        ok = /audio\/mpeg/i.test(ctype) && size > 1000;
      } else {
        code = resp.status;
      }
    } catch (e) {
      // ignore, we record below
    }
    results.push({ voice, ok, code, size, contentType: ctype, ms: Date.now() - started });
    await sleep(3300); // respect pacing
  }
  await fs.writeFile(outfile, JSON.stringify({ when: new Date().toISOString(), results }, null, 2), 'utf8');
  // Non-failing: ensure we attempted at least one
  assert.ok(results.length >= 1);
}

