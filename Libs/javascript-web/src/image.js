import { getDefaultClient } from './client.js';

const bool = v => (v == null ? undefined : (v ? 'true' : 'false'));

// Returns a Blob compatible with <img src={URL.createObjectURL(blob)} />
export async function image(prompt, {
  model, seed, width, height, image, nologo, private: priv, enhance, safe, referrer,
} = {}, client = getDefaultClient()) {
  const url = `${client.imageBase}/prompt/${encodeURIComponent(prompt)}`;
  const params = {};
  if (model) params.model = model;
  if (seed != null) params.seed = seed;
  if (width != null) params.width = width;
  if (height != null) params.height = height;
  if (image) params.image = image;
  if (nologo != null) params.nologo = bool(nologo);
  if (priv != null) params.private = bool(priv);
  if (enhance != null) params.enhance = bool(enhance);
  if (safe != null) params.safe = bool(safe);
  if (referrer) params.referrer = referrer;

  const r = await client.get(url, { params });
  if (!r.ok) throw new Error(`image error ${r.status}`);
  return await r.blob();
}

export async function imageModels(client = getDefaultClient()) {
  const r = await client.get(`${client.imageBase}/models`);
  if (!r.ok) throw new Error(`imageModels error ${r.status}`);
  return await r.json();
}

