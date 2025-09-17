import { getDefaultClient } from './client.js';
import { DEFAULT_MODEL, DEFAULT_SEED } from './defaults.js';
import { BinaryData } from './binary.js';
import { raiseForStatus } from './errors.js';

export async function image(prompt, options = {}, client = getDefaultClient()) {
  const normalizedPrompt = normalizePrompt(prompt);
  const { timeoutMs, ...rest } = options ?? {};
  const params = buildImageParams(rest);
  const url = `${client.imageBase}/prompt/${encodeURIComponent(normalizedPrompt)}`;

  const response = await client.get(url, { params, timeoutMs });
  await raiseForStatus(response, 'image');
  return await BinaryData.fromResponse(response);
}

export async function imageUrl(prompt, options = {}, client = getDefaultClient()) {
  const normalizedPrompt = normalizePrompt(prompt);
  const params = buildImageParams(options ?? {});
  const url = `${client.imageBase}/prompt/${encodeURIComponent(normalizedPrompt)}`;
  return await client.getSignedUrl(url, { params, includeToken: true });
}

export async function imageModels(client = getDefaultClient()) {
  const response = await client.get(`${client.imageBase}/models`);
  await raiseForStatus(response, 'imageModels');
  return await response.json();
}

function normalizePrompt(prompt) {
  if (typeof prompt !== 'string') {
    throw new Error('image() expects the prompt to be a string');
  }
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error('image() requires a non-empty prompt string');
  }
  return trimmed;
}

function buildImageParams(options) {
  const params = {};
  const extras = { ...options };

  const model = extras.model ?? DEFAULT_MODEL;
  if (model) {
    params.model = model;
  }
  delete extras.model;

  const seed = extras.seed ?? DEFAULT_SEED;
  if (seed != null) {
    params.seed = seed;
  }
  delete extras.seed;

  assignIfPresent(params, 'width', extras.width);
  delete extras.width;

  assignIfPresent(params, 'height', extras.height);
  delete extras.height;

  assignIfPresent(params, 'size', extras.size);
  delete extras.size;

  assignIfPresent(params, 'aspect_ratio', extras.aspect_ratio ?? extras.aspectRatio);
  delete extras.aspect_ratio;
  delete extras.aspectRatio;

  assignIfPresent(params, 'background', extras.background);
  delete extras.background;

  assignIfPresent(params, 'image', extras.image ?? extras.imageUrl);
  delete extras.image;
  delete extras.imageUrl;

  assignIfPresent(params, 'mask', extras.mask);
  delete extras.mask;

  assignBooleanParam(params, 'nologo', pickFirst(extras, ['nologo', 'noLogo']));
  delete extras.nologo;
  delete extras.noLogo;

  assignBooleanParam(params, 'private', pickFirst(extras, ['private', 'isPrivate']));
  delete extras.private;
  delete extras.isPrivate;

  assignBooleanParam(params, 'enhance', extras.enhance);
  delete extras.enhance;

  assignBooleanParam(params, 'safe', extras.safe);
  delete extras.safe;

  assignBooleanParam(params, 'upscale', extras.upscale);
  delete extras.upscale;

  assignBooleanParam(params, 'high_contrast', extras.high_contrast ?? extras.highContrast);
  delete extras.high_contrast;
  delete extras.highContrast;

  if ('referer' in extras && extras.referer) {
    params.referer = extras.referer;
    delete extras.referer;
  }

  if ('referrer' in extras && extras.referrer) {
    params.referer = params.referer ?? extras.referrer;
    delete extras.referrer;
  }

  delete extras.timeoutMs;

  for (const [key, value] of Object.entries(extras)) {
    if (value === undefined || value === null) continue;
    params[key] = value;
  }

  return params;
}

function assignIfPresent(target, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}

function assignBooleanParam(target, key, value) {
  if (value == null) return;
  target[key] = value ? 'true' : 'false';
}

function pickFirst(source, keys) {
  for (const key of keys) {
    if (key in source && source[key] !== undefined) {
      return source[key];
    }
  }
  return undefined;
}
