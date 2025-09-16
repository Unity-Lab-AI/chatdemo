import { getDefaultClient } from './client.js';
import { BinaryData } from './binary.js';
import { raiseForStatus } from './errors.js';

const boolString = value => (value == null ? undefined : value ? 'true' : 'false');

export async function image(prompt, options = {}, client = getDefaultClient()) {
  if (typeof prompt !== 'string' || !prompt.length) {
    throw new Error('image() expects a non-empty prompt string');
  }
  const {
    model,
    seed,
    width,
    height,
    image: imageUrl,
    nologo,
    private: priv,
    enhance,
    safe,
    referrer,
    timeoutMs,
  } = options;
  const url = `${client.imageBase}/prompt/${encodeURIComponent(prompt)}`;
  const params = {};
  if (model) params.model = model;
  if (seed != null) params.seed = seed;
  if (width != null) params.width = width;
  if (height != null) params.height = height;
  if (imageUrl) params.image = imageUrl;
  if (nologo != null) params.nologo = boolString(nologo);
  if (priv != null) params.private = boolString(priv);
  if (enhance != null) params.enhance = boolString(enhance);
  if (safe != null) params.safe = boolString(safe);
  if (referrer) params.referrer = referrer;

  const response = await client.get(url, { params, timeoutMs });
  await raiseForStatus(response, 'image');
  return await BinaryData.fromResponse(response);
}

export async function imageModels(client = getDefaultClient()) {
  const response = await client.get(`${client.imageBase}/models`);
  await raiseForStatus(response, 'imageModels');
  return await response.json();
}
