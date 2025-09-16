import { getDefaultClient } from './client.js';
import { BinaryData, arrayBufferFrom, base64FromArrayBuffer } from './binary.js';
import { raiseForStatus } from './errors.js';

export async function tts(text, options = {}, client = getDefaultClient()) {
  if (typeof text !== 'string' || !text.length) {
    throw new Error('tts() expects a non-empty text string');
  }
  const { voice, model = 'openai-audio', referrer, timeoutMs } = options;
  const url = `${client.textBase}/${encodeURIComponent(text)}`;
  const params = { model };
  if (voice) params.voice = voice;
  if (referrer) params.referrer = referrer;
  const response = await client.get(url, { params, timeoutMs });
  await raiseForStatus(response, 'tts');
  return await BinaryData.fromResponse(response);
}

export async function stt({ file, data, arrayBuffer, buffer, path, format, question, model = 'openai-audio', timeoutMs } = {}, client = getDefaultClient()) {
  let bytes = null;
  if (file) bytes = await arrayBufferFrom(file);
  else if (data) bytes = await arrayBufferFrom(data);
  else if (arrayBuffer) bytes = await arrayBufferFrom(arrayBuffer);
  else if (buffer) bytes = await arrayBufferFrom(buffer);
  else if (path) bytes = await readFileArrayBuffer(path);
  if (!bytes) throw new Error("stt() requires 'file', 'data', 'arrayBuffer', 'buffer', or 'path'");

  let fmt = format ?? guessFormat({ file, path });
  if (!fmt) throw new Error("Audio 'format' is required (e.g., 'mp3' or 'wav')");

  const b64 = base64FromArrayBuffer(bytes);
  const payload = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: question ?? 'Transcribe this audio' },
        { type: 'input_audio', input_audio: { data: b64, format: fmt } },
      ],
    }],
  };
  const response = await client.postJson(`${client.textBase}/openai`, payload, { timeoutMs });
  await raiseForStatus(response, 'stt');
  return await response.json();
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

function guessFormat({ file, path }) {
  if (file?.type?.startsWith?.('audio/')) {
    return file.type.split('/')[1];
  }
  const name = file?.name ?? path;
  if (typeof name === 'string' && name.includes('.')) {
    return name.split('.').pop().toLowerCase();
  }
  return null;
}
