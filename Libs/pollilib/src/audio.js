import { getDefaultClient } from './client.js';
import { BinaryData, arrayBufferFrom, base64FromArrayBuffer } from './binary.js';
import { raiseForStatus } from './errors.js';

export async function tts(text, options = {}, client = getDefaultClient()) {
  const normalizedText = normalizeText(text);
  const { timeoutMs, ...rest } = options ?? {};
  const params = buildTtsParams(rest);
  const url = `${client.textBase}/${encodeURIComponent(normalizedText)}`;

  const response = await client.get(url, { params, timeoutMs });
  await raiseForStatus(response, 'tts');
  return await BinaryData.fromResponse(response);
}

export async function ttsUrl(text, options = {}, client = getDefaultClient()) {
  const normalizedText = normalizeText(text);
  const params = buildTtsParams(options ?? {});
  const url = `${client.textBase}/${encodeURIComponent(normalizedText)}`;
  return await client.getSignedUrl(url, { params, includeToken: true });
}

export async function stt(options = {}, client = getDefaultClient()) {
  const payload = await buildSttPayload(options);
  const response = await client.postJson(`${client.textBase}/openai`, payload, {
    timeoutMs: options.timeoutMs,
  });
  await raiseForStatus(response, 'stt');
  return await response.json();
}

async function buildSttPayload(options = {}) {
  const {
    file,
    data,
    arrayBuffer,
    buffer,
    path,
    question,
    prompt,
    model = 'openai-audio',
    format,
    language,
    temperature,
  } = options;

  const bytes = await resolveAudioBytes({ file, data, arrayBuffer, buffer, path });
  const mime = format ?? guessFormat({ file, path, explicit: options.mimeType });
  if (!mime) {
    throw new Error("stt() requires an audio format (e.g. 'mp3' or 'wav')");
  }

  const b64 = base64FromArrayBuffer(bytes);
  const userQuestion = question ?? prompt ?? 'Transcribe this audio';

  const message = {
    role: 'user',
    content: [
      { type: 'text', text: userQuestion },
      { type: 'input_audio', input_audio: { data: b64, format: mime } },
    ],
  };

  const payload = { model, messages: [message] };
  if (language) payload.language = language;
  if (temperature != null) payload.temperature = temperature;

  return payload;
}

async function resolveAudioBytes({ file, data, arrayBuffer, buffer, path }) {
  if (file) return await arrayBufferFrom(file);
  if (data) return await arrayBufferFrom(data);
  if (arrayBuffer) return await arrayBufferFrom(arrayBuffer);
  if (buffer) return await arrayBufferFrom(buffer);
  if (path) return await readFileArrayBuffer(path);
  throw new Error("stt() requires 'file', 'data', 'arrayBuffer', 'buffer', or 'path'");
}

function buildTtsParams(options) {
  const params = {};
  const extras = { ...options };

  assignIfPresent(params, 'model', extras.model ?? 'openai-audio');
  delete extras.model;

  assignIfPresent(params, 'voice', extras.voice);
  delete extras.voice;

  assignIfPresent(params, 'format', extras.format);
  delete extras.format;

  assignIfPresent(params, 'language', extras.language);
  delete extras.language;

  if ('referrer' in extras && extras.referrer) {
    params.referrer = extras.referrer;
    delete extras.referrer;
  }

  delete extras.timeoutMs;

  for (const [key, value] of Object.entries(extras)) {
    if (value === undefined || value === null) continue;
    params[key] = value;
  }

  return params;
}

async function readFileArrayBuffer(path) {
  if (typeof path !== 'string' || !path.length) {
    throw new Error('stt() path must be a string');
  }
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw new Error('Reading audio files from disk is only supported in Node environments');
  }
  const fs = await import('node:fs/promises');
  const buf = await fs.readFile(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function guessFormat({ file, path, explicit }) {
  if (explicit) return explicit;
  if (file?.type?.startsWith?.('audio/')) {
    return file.type.split('/')[1];
  }
  const name = file?.name ?? path;
  if (typeof name === 'string' && name.includes('.')) {
    return name.split('.').pop().toLowerCase();
  }
  return null;
}

function normalizeText(text) {
  if (typeof text !== 'string') {
    throw new Error('tts() expects the text to be a string');
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('tts() requires a non-empty text string');
  }
  return trimmed;
}

function assignIfPresent(target, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}
