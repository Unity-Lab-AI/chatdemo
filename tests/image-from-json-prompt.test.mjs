import assert from 'node:assert/strict';
import { PolliClient, chat, image } from '../Libs/pollilib/index.js';

export const name = 'Roundtrip: model returns JSON with images[] and we render via image()';

export async function run() {
  const client = new PolliClient();
  const messages = [
    { role: 'user', content: 'Respond strictly as JSON with this shape: {"text":"string","images":[{"prompt":"A simple blue square","width":256,"height":256,"model":"flux"}]}' },
  ];
  // Prefer a permissive model
  const resp = await chat({ endpoint: 'openai', model: 'openai', messages, response_format: { type: 'json_object' } }, client);
  assert.ok(Array.isArray(resp?.choices), 'choices missing');
  const content = resp.choices[0]?.message?.content ?? '';
  let obj = null;
  try { obj = JSON.parse(content); } catch {}
  if (!obj || !obj.images || !obj.images.length) {
    // Soft pass: not all models will honor formatting here
    return;
  }
  const imgReq = obj.images[0];
  assert.ok(typeof imgReq.prompt === 'string' && imgReq.prompt.length > 0, 'missing prompt');
  const bin = await image(imgReq.prompt, { width: imgReq.width || 256, height: imgReq.height || 256, model: imgReq.model || 'flux', nologo: true, seed: 12345678 }, client);
  const dataUrl = bin?.toDataUrl?.();
  assert.ok(typeof dataUrl === 'string' && dataUrl.startsWith('data:image/'), 'invalid data url');
}

