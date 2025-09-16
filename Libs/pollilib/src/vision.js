import { getDefaultClient } from './client.js';
import { arrayBufferFrom, base64FromArrayBuffer } from './binary.js';
import { raiseForStatus } from './errors.js';

export async function vision({
  imageUrl,
  file,
  data,
  buffer,
  arrayBuffer,
  imageFormat,
  question,
  model = 'openai',
  max_tokens,
  timeoutMs,
} = {}, client = getDefaultClient()) {
  let finalUrl = imageUrl;
  if (!finalUrl) {
    const bytes = file
      ? await arrayBufferFrom(file)
      : data
        ? await arrayBufferFrom(data)
        : arrayBuffer
          ? await arrayBufferFrom(arrayBuffer)
          : buffer
            ? await arrayBufferFrom(buffer)
            : null;
    if (!bytes) {
      throw new Error('vision() requires either imageUrl or image binary data');
    }
    const fmt = imageFormat ?? guessImageFormat({ file });
    if (!fmt) {
      throw new Error('imageFormat is required when providing raw image bytes');
    }
    const b64 = base64FromArrayBuffer(bytes);
    finalUrl = `data:image/${fmt};base64,${b64}`;
  }

  const payload = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: question ?? 'Describe this image:' },
        { type: 'image_url', image_url: { url: finalUrl } },
      ],
    }],
  };
  if (max_tokens != null) payload.max_tokens = max_tokens;

  const response = await client.postJson(`${client.textBase}/openai`, payload, { timeoutMs });
  await raiseForStatus(response, 'vision');
  return await response.json();
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
