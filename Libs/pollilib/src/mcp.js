import { getDefaultClient } from './client.js';
import { image as imageGen, imageModels as listImage } from './image.js';
import { textModels as listText } from './text.js';
import { tts as ttsGen } from './audio.js';

export function serverName() {
  return 'pollinations-multimodal-api';
}

export function toolDefinitions() {
  return {
    name: serverName(),
    tools: [
      {
        name: 'generateImageUrl',
        description: 'Generate an image and return its URL',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            model: { type: 'string' },
            seed: { type: 'integer' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            nologo: { type: 'boolean' },
            private: { type: 'boolean' },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'generateImage',
        description: 'Generate an image and return base64',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            model: { type: 'string' },
            seed: { type: 'integer' },
            width: { type: 'integer' },
            height: { type: 'integer' },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'respondAudio',
        description: 'Generate text-to-speech audio and return base64',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            voice: { type: 'string' },
            model: { type: 'string' },
          },
          required: ['text'],
        },
      },
      {
        name: 'sayText',
        description: 'Alias for respondAudio',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            voice: { type: 'string' },
            model: { type: 'string' },
          },
          required: ['text'],
        },
      },
      {
        name: 'listImageModels',
        description: 'List available image models',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'listTextModels',
        description: 'List text & multimodal models',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'listAudioVoices',
        description: 'List available voices',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'listModels',
        description: 'List models by kind',
        parameters: {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['image', 'text', 'audio'] } },
        },
      },
    ],
  };
}

export async function generateImageUrl(client, params) {
  ({ client, params } = ensureClientArgs(client, params));
  if (!params?.prompt) throw new Error('generateImageUrl requires a prompt');
  const baseUrl = `${client.imageBase}/prompt/${encodeURIComponent(params.prompt)}`;
  const { prompt, ...rest } = params;
  try {
    return await client.getSignedUrl(baseUrl, { params: rest, includeToken: true });
  } catch (err) {
    if (String(err.message).includes('Token can only be embedded')) {
      return await client.getSignedUrl(baseUrl, { params: rest, includeToken: false });
    }
    throw err;
  }
}

export async function generateImageBase64(client, params) {
  ({ client, params } = ensureClientArgs(client, params));
  if (!params?.prompt) throw new Error('generateImage requires a prompt');
  const data = await imageGen(params.prompt, params, client);
  return await data.toBase64();
}

export async function listImageModels(client, params) {
  ({ client } = ensureClientArgs(client, params));
  return await listImage(client);
}

export async function listTextModels(client, params) {
  ({ client } = ensureClientArgs(client, params));
  return await listText(client);
}

export async function listAudioVoices(client, params) {
  ({ client } = ensureClientArgs(client, params));
  const models = await listText(client);
  return models?.['openai-audio']?.voices ?? [];
}

export async function listModels(client, params = {}) {
  ({ client, params } = ensureClientArgs(client, params));
  const kind = params?.kind;
  if (kind === 'image') {
    return await listImage(client);
  }
  const textModels = await listText(client);
  if (kind === 'audio') {
    return extractAudioModels(textModels);
  }
  if (kind === 'text') {
    return textModels;
  }
  const [imageModels, audioModels] = await Promise.all([
    listImage(client),
    Promise.resolve(extractAudioModels(textModels)),
  ]);
  return { image: imageModels, text: textModels, audio: audioModels };
}

export async function respondAudio(client, params) {
  return await sayText(client, params);
}

export async function sayText(client, params) {
  ({ client, params } = ensureClientArgs(client, params));
  if (!params?.text) throw new Error('sayText requires text');
  const binary = await ttsGen(params.text, { voice: params.voice, model: params.model }, client);
  return {
    base64: await binary.toBase64(),
    mimeType: binary.mimeType,
    dataUrl: binary.toDataUrl(),
  };
}

function extractAudioModels(models) {
  const audio = {};
  if (!models || typeof models !== 'object') return audio;
  for (const [name, info] of Object.entries(models)) {
    const hasVoices = info?.voices?.length;
    const declaresAudio = info?.capabilities?.includes?.('audio');
    if (name.includes('audio') || hasVoices || declaresAudio) {
      audio[name] = info;
    }
  }
  return audio;
}

function ensureClientArgs(client, params) {
  if (!params && (!client || typeof client.getSignedUrl !== 'function')) {
    return { client: getDefaultClient(), params: client ?? {} };
  }
  if (!client || typeof client.getSignedUrl !== 'function') {
    return { client: getDefaultClient(), params: params ?? {} };
  }
  return { client, params: params ?? {} };
}
