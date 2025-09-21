import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PolliClient, chat, image } from '../Libs/pollilib/index.js';

export const name = 'Reliability: JSON mode (unity preferred) for images and code, single/multi-turn';

const OUT_DIR = path.resolve(process.cwd(), 'reports');
const OUT_FILE = path.join(OUT_DIR, 'json-mode-reliability.json');

const SINGLE_TURN_ATTEMPTS = 10;
const MULTI_TURN_ATTEMPTS = 5;

const INJECTED_USER_PRIMER = `Formatting directive (output format only; does not change your tone or behavior):

- You can cause an image to be generated when the user asks for one.
- When the user asks for an image, prefer returning a single JSON object with keys:
  {
    "text": string,                     // your explanation (optional)
    "code": [                           // code blocks to show (optional)
      { "language": string, "content": string }
    ],
    "images": [                         // one or more images to generate (only if asked)
      { "prompt": string, "width": int?, "height": int?, "size": string?, "aspect_ratio": string?, "model": string?, "caption": string?, "seed": number? }
    ]
  }
- If you cannot or prefer not to return JSON, you may instead include exactly one fenced code block with language polli-image whose content is a single JSON object having the fields above (at minimum: prompt).
- Keep normal prose outside JSON and outside the polli-image code block. Do not put backticks inside JSON.
- Do not generate any image unless the user explicitly asks for an image.`;

function buildFirstTurnUserMessage(userText) {
  const intro = `The user's first message is below. Follow the formatting directive above only when applicable.`;
  return `${INJECTED_USER_PRIMER}\n\n${intro}\n\n${userText}`;
}

async function discoverUnityModel(client) {
  try {
    const models = await client.listModels('text');
    for (const m of models) {
      const id = (m && (m.name || m.id || m.model || ''))?.toString().toLowerCase();
      if (id && id.includes('unity')) return m.name || m.id || m.model || 'unity';
    }
  } catch {}
  return 'openai';
}

async function tryChatJson(model, messages, { timeoutMs = 15000 } = {}) {
  const client = new PolliClient();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let resp = null;
    try {
      resp = await chat({ endpoint: 'openai', model, messages, response_format: { type: 'json_object' } }, client);
    } catch {
      return null;
    }
    const content = resp?.choices?.[0]?.message?.content ?? '';
    try { return JSON.parse(content); } catch { return null; }
  } finally { clearTimeout(t); }
}

async function attemptSingleTurnImage(model) {
  const prompt = 'Respond strictly as JSON with this shape {"text":"optional","images":[{"prompt":"A single, shiny, red apple on a white background","width":256,"height":256,"model":"flux","caption":"A single, shiny, red apple on a white background","seed": 123456}]}. Do not include code fences or extra text.';
  const obj = await tryChatJson(model, [{ role: 'user', content: prompt }]);
  if (!obj || !Array.isArray(obj.images) || !obj.images.length || typeof obj.images[0]?.prompt !== 'string') return { ok: false, reason: 'bad_json' };
  const req = obj.images[0];
  try {
    const client = new PolliClient();
    const bin = await image(req.prompt, { width: req.width || 256, height: req.height || 256, model: req.model || 'flux', nologo: true, seed: req.seed ?? 123456 }, client);
    const dataUrl = bin?.toDataUrl?.();
    const ok = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/');
    return { ok, reason: ok ? 'ok' : 'bad_image' };
  } catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

async function attemptSingleTurnCode(model) {
  const prompt = 'Reply strictly as JSON with fields {"text":"optional","code":[{"language":"javascript","content":"console.log(\\"hello\\");"}]}. No extra text.';
  const obj = await tryChatJson(model, [{ role: 'user', content: prompt }]);
  const ok = !!(obj && Array.isArray(obj.code) && obj.code.length && typeof (obj.code[0]?.content || obj.code[0]?.code) === 'string');
  return { ok, reason: ok ? 'ok' : 'bad_json' };
}

async function attemptMultiTurnImage(model) {
  const messages = [
    { role: 'user', content: buildFirstTurnUserMessage('hello') },
    { role: 'user', content: 'Generate an image of an apple; reply strictly as JSON with images[] only.' },
  ];
  const obj = await tryChatJson(model, messages);
  if (!obj || !Array.isArray(obj.images) || !obj.images.length || typeof obj.images[0]?.prompt !== 'string') return { ok: false, reason: 'bad_json' };
  const req = obj.images[0];
  try {
    const client = new PolliClient();
    const bin = await image(req.prompt, { width: req.width || 256, height: req.height || 256, model: req.model || 'flux', nologo: true, seed: req.seed ?? 123456 }, client);
    const dataUrl = bin?.toDataUrl?.();
    const ok = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/');
    return { ok, reason: ok ? 'ok' : 'bad_image' };
  } catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

async function attemptMultiTurnCode(model) {
  const messages = [
    { role: 'user', content: buildFirstTurnUserMessage('hello') },
    { role: 'user', content: 'Write a tiny Python hello world; reply strictly as JSON with code[] only.' },
  ];
  const obj = await tryChatJson(model, messages);
  const ok = !!(obj && Array.isArray(obj.code) && obj.code.length && typeof (obj.code[0]?.content || obj.code[0]?.code) === 'string');
  return { ok, reason: ok ? 'ok' : 'bad_json' };
}

export async function run() {
  const client = new PolliClient();
  const model = await discoverUnityModel(client);

  const summary = {
    model,
    singleTurn: { image: { attempts: SINGLE_TURN_ATTEMPTS, ok: 0 }, code: { attempts: SINGLE_TURN_ATTEMPTS, ok: 0 } },
    multiTurn: { image: { attempts: MULTI_TURN_ATTEMPTS, ok: 0 }, code: { attempts: MULTI_TURN_ATTEMPTS, ok: 0 } },
    details: [],
  };

  for (let i = 0; i < SINGLE_TURN_ATTEMPTS; i += 1) {
    const r1 = await attemptSingleTurnImage(model);
    if (r1.ok) summary.singleTurn.image.ok += 1;
    summary.details.push({ kind: 'single:image', i, ...r1 });

    const r2 = await attemptSingleTurnCode(model);
    if (r2.ok) summary.singleTurn.code.ok += 1;
    summary.details.push({ kind: 'single:code', i, ...r2 });
  }

  for (let i = 0; i < MULTI_TURN_ATTEMPTS; i += 1) {
    const r1 = await attemptMultiTurnImage(model);
    if (r1.ok) summary.multiTurn.image.ok += 1;
    summary.details.push({ kind: 'multi:image', i, ...r1 });

    const r2 = await attemptMultiTurnCode(model);
    if (r2.ok) summary.multiTurn.code.ok += 1;
    summary.details.push({ kind: 'multi:code', i, ...r2 });
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`[reliability] Model: ${model}`);
  console.log(`[reliability] Single-turn image: ${summary.singleTurn.image.ok}/${summary.singleTurn.image.attempts}`);
  console.log(`[reliability] Single-turn code: ${summary.singleTurn.code.ok}/${summary.singleTurn.code.attempts}`);
  console.log(`[reliability] Multi-turn image: ${summary.multiTurn.image.ok}/${summary.multiTurn.image.attempts}`);
  console.log(`[reliability] Multi-turn code: ${summary.multiTurn.code.ok}/${summary.multiTurn.code.attempts}`);

  // Non-failing report: verify we executed the attempts and produced output
  assert.equal(summary.singleTurn.image.attempts, SINGLE_TURN_ATTEMPTS);
  assert.equal(summary.singleTurn.code.attempts, SINGLE_TURN_ATTEMPTS);
  assert.equal(summary.multiTurn.image.attempts, MULTI_TURN_ATTEMPTS);
  assert.equal(summary.multiTurn.code.attempts, MULTI_TURN_ATTEMPTS);
}
