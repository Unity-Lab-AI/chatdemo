import { getDefaultClient } from './client.js';

// Returns a Blob (e.g., audio/mpeg)
export async function tts(text, { voice, model = 'openai-audio', referrer } = {}, client = getDefaultClient()) {
  const url = `${client.textBase}/${encodeURIComponent(text)}`;
  const params = { model };
  if (voice) params.voice = voice;
  if (referrer) params.referrer = referrer;
  const r = await client.get(url, { params });
  if (!r.ok) throw new Error(`tts error ${r.status}`);
  return await r.blob();
}

// STT via OpenAI-compatible POST; accepts { file?: Blob|File, data?: ArrayBuffer|Uint8Array, format?: string, question?: string }
export async function stt({ file, data, format, question }, client = getDefaultClient()) {
  if (!file && !data) throw new Error("Provide either 'file' or 'data'");

  // Derive format from file.type or name if possible
  if (!format && file) {
    if (file.type && file.type.startsWith('audio/')) format = file.type.split('/')[1];
    else if (file.name && file.name.includes('.')) format = file.name.split('.').pop().toLowerCase();
  }
  if (!format) throw new Error("Audio 'format' is required (e.g., 'mp3' or 'wav')");

  const bytes = file ? await file.arrayBuffer() : (data instanceof ArrayBuffer ? data : (data?.buffer ?? data));
  const b64 = base64FromArrayBuffer(bytes);
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

function base64FromArrayBuffer(ab) {
  const bytes = new Uint8Array(ab);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub);
  }
  // btoa expects binary string
  return btoa(binary);
}

