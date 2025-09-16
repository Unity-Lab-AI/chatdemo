import { getDefaultClient } from './client.js';

export async function vision({ imageUrl, data, imageFormat, question, model = 'openai', max_tokens } = {}, client = getDefaultClient()) {
  if (!imageUrl && !data) throw new Error('Provide either imageUrl or data');
  if (data) {
    if (!imageFormat) throw new Error('imageFormat is required when providing raw bytes');
    const b64 = Buffer.from(data).toString('base64');
    imageUrl = `data:image/${imageFormat};base64,${b64}`;
  }
  const payload = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: question ?? 'Describe this image:' },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }],
  };
  if (max_tokens != null) payload.max_tokens = max_tokens;
  const r = await client.postJson(`${client.textBase}/openai`, payload);
  if (!r.ok) throw new Error(`vision error ${r.status}`);
  return await r.json();
}

