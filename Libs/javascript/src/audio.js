import { getDefaultClient } from './client.js';

export async function tts(text, { voice, model = 'openai-audio', referrer } = {}, client = getDefaultClient()) {
  const url = `${client.textBase}/${encodeURIComponent(text)}`;
  const params = { model };
  if (voice) params.voice = voice;
  if (referrer) params.referrer = referrer;
  const r = await client.get(url, { params });
  if (!r.ok) throw new Error(`tts error ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function stt({ path, data, format, question }, client = getDefaultClient()) {
  if (!data && !path) throw new Error("Provide either 'path' or 'data'");
  if (!data && path) data = await BunOrNodeReadFile(path);
  if (!format) {
    if (path && path.includes('.')) format = path.split('.').pop().toLowerCase();
    if (!format) throw new Error("Audio 'format' is required (e.g., 'mp3' or 'wav')");
  }
  const b64 = Buffer.from(data).toString('base64');
  const body = {
    model: 'openai-audio',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: question ?? 'Transcribe this audio' },
        { type: 'input_audio', input_audio: { data: b64, format } },
      ],
    }],
  };
  const r = await client.postJson(`${client.textBase}/openai`, body);
  if (!r.ok) throw new Error(`stt error ${r.status}`);
  return await r.json();
}

async function BunOrNodeReadFile(p) {
  if (typeof Bun !== 'undefined' && Bun.file) {
    return await Bun.file(p).arrayBuffer().then(ab => Buffer.from(ab));
  }
  const fs = await import('fs');
  return fs.promises.readFile(p);
}

