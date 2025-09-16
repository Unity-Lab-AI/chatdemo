import { getDefaultClient } from './client.js';

export async function vision({ imageUrl, file, data, imageFormat, question, model = 'openai', max_tokens } = {}, client = getDefaultClient()) {
  if (!imageUrl && !file && !data) throw new Error('Provide imageUrl or file/data');
  if (!imageUrl) {
    const ab = file ? await file.arrayBuffer() : (data instanceof ArrayBuffer ? data : (data?.buffer ?? data));
    if (!imageFormat) {
      if (file?.type?.startsWith('image/')) imageFormat = file.type.split('/')[1];
      else throw new Error('imageFormat is required when providing raw bytes');
    }
    const b64 = base64FromArrayBuffer(ab);
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

function base64FromArrayBuffer(ab) {
  const bytes = new Uint8Array(ab);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

