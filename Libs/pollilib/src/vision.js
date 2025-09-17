import { getDefaultClient } from './client.js';
import { arrayBufferFrom, base64FromArrayBuffer } from './binary.js';
import { raiseForStatus } from './errors.js';

export async function vision(options = {}, client = getDefaultClient()) {
  const payload = await buildVisionPayload(options);
  const response = await client.postJson(`${client.textBase}/openai`, payload, {
    timeoutMs: options.timeoutMs,
  });
  await raiseForStatus(response, 'vision');
  return await response.json();
}

async function buildVisionPayload(options = {}) {
  const {
    imageUrl,
    file,
    data,
    buffer,
    arrayBuffer,
    imageFormat,
    question,
    prompt,
    model = 'openai',
    max_tokens,
    temperature,
  } = options;

  const url = imageUrl ?? (await createDataUrl({ file, data, buffer, arrayBuffer, imageFormat }));
  if (!url) {
    throw new Error('vision() requires either imageUrl or image binary data');
  }

  const userPrompt = question ?? prompt ?? 'Describe this image:';

  const message = {
    role: 'user',
    content: [
      { type: 'text', text: userPrompt },
      { type: 'image_url', image_url: { url } },
    ],
  };

  const payload = { model, messages: [message] };
  if (max_tokens != null) payload.max_tokens = max_tokens;
  if (temperature != null) payload.temperature = temperature;

  return payload;
}

async function createDataUrl({ file, data, buffer, arrayBuffer, imageFormat }) {
  const bytes = await resolveImageBytes({ file, data, buffer, arrayBuffer });
  if (!bytes) return null;
  const fmt = imageFormat ?? guessImageFormat({ file });
  if (!fmt) {
    throw new Error('imageFormat is required when providing raw image bytes');
  }
  const base64 = base64FromArrayBuffer(bytes);
  return `data:image/${fmt};base64,${base64}`;
}

async function resolveImageBytes({ file, data, buffer, arrayBuffer }) {
  if (file) return await arrayBufferFrom(file);
  if (data) return await arrayBufferFrom(data);
  if (buffer) return await arrayBufferFrom(buffer);
  if (arrayBuffer) return await arrayBufferFrom(arrayBuffer);
  return null;
}

function guessImageFormat({ file }) {
  if (file?.type?.startsWith?.('image/')) {
    return file.type.split('/')[1];
  }
  if (file?.name && file.name.includes('.')) {
    return file.name.split('.').pop().toLowerCase();
  }
  return null;
}
