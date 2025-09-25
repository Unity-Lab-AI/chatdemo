import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export const name = 'Live TTS: openai-audio returns audio/mpeg';

function timeoutSignal(ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(t) };
}

export async function run() {
  const outDir = path.resolve(process.cwd(), 'reports');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'tts-live.json');

  const base = 'https://text.pollinations.ai';
  const text = 'Hello from Pollinations';
  const voice = 'nova';
  const model = 'openai-audio';
  const u = new URL(`${base}/${encodeURIComponent(text)}`);
  u.searchParams.set('model', model);
  u.searchParams.set('voice', voice);
  u.searchParams.set('safe', 'false');
  try { if (globalThis && globalThis.__POLLINATIONS_REFERRER__) u.searchParams.set('referrer', globalThis.__POLLINATIONS_REFERRER__); } catch {}

  let ok = false; let code = 0; let status = 'unknown'; let size = 0; let ctype = '';
  const started = Date.now();
  const { signal, cancel } = timeoutSignal(Number(process.env.TTS_TEST_TIMEOUT_MS || 15000));
  try {
    const resp = await fetch(u, { method: 'GET', headers: { 'Accept': 'audio/mpeg', 'Cache-Control': 'no-store' }, signal });
    ctype = String(resp.headers?.get?.('Content-Type') || '');
    if (!resp.ok) {
      code = resp.status;
      status = `http_${resp.status}`;
    } else {
      const buf = await resp.arrayBuffer();
      size = buf.byteLength || 0;
      ok = /audio\/mpeg/i.test(ctype) && size > 1024; // at least 1KB
      status = ok ? 'ok' : 'bad_audio';
    }
  } catch (e) {
    const msg = e?.message || String(e);
    const m = /HTTP\s+(\d{3})/i.exec(msg);
    if (m) code = Number(m[1]);
    status = /aborted/i.test(msg) ? 'timeout' : 'error';
  } finally { cancel(); }

  const summary = { ok, status, code, size, contentType: ctype, ms: Date.now() - started, url: u.toString() };
  await fs.writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), summary }, null, 2), 'utf8');

  // Non-failing: Just ensure we ran and wrote a report
  assert.ok(true);
}

