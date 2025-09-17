import { getDefaultClient } from './client.js';
import { image, imageModels, imageUrl } from './image.js';
import { textModels } from './text.js';
import { tts } from './audio.js';

export function serverName() {
  return 'pollinations-multimodal-api';
}

export function toolDefinitions() {
  return {
    name: serverName(),
    tools: [
      {
        name: 'generateImageUrl',
        description: 'Generate an image and return its signed URL',
        parameters: imageParameters(),
      },
      {
        name: 'generateImage',
        description: 'Generate an image and return base64 data',
        parameters: imageParameters(),
      },
      {
        name: 'respondAudio',
        description: 'Generate text-to-speech audio and return base64',
        parameters: audioParameters(),
      },
      {
        name: 'sayText',
        description: 'Alias for respondAudio',
        parameters: audioParameters(),
      },
      {
        name: 'listImageModels',
        description: 'List available image models',
        parameters: emptyParameters(),
      },
      {
        name: 'listTextModels',
        description: 'List text and multimodal models',
        parameters: emptyParameters(),
      },
      {
        name: 'listAudioVoices',
        description: 'List available audio voices',
        parameters: emptyParameters(),
      },
      {
        name: 'listModels',
        description: 'List models by kind',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['image', 'text', 'audio'] },
          },
        },
      },
    ],
  };
}

export async function generateImageUrl(client, params) {
  const { resolvedClient, resolvedParams } = resolveClientArgs(client, params);
  const { prompt, ...options } = resolvedParams;
  if (!prompt) throw new Error('generateImageUrl requires a prompt');
  return await imageUrl(prompt, options, resolvedClient);
}

export async function generateImageBase64(client, params) {
  const { resolvedClient, resolvedParams } = resolveClientArgs(client, params);
  const { prompt, ...options } = resolvedParams;
  if (!prompt) throw new Error('generateImage requires a prompt');
  const data = await image(prompt, options, resolvedClient);
  return await data.toBase64();
}

export async function listImageModels(client, params) {
  const { resolvedClient } = resolveClientArgs(client, params);
  return await imageModels(resolvedClient);
}

export async function listTextModels(client, params) {
  const { resolvedClient } = resolveClientArgs(client, params);
  return await textModels(resolvedClient);
}

export async function listAudioVoices(client, params) {
  const { resolvedClient } = resolveClientArgs(client, params);
  const models = await textModels(resolvedClient);
  return extractAudioModels(models);
}

export async function listModels(client, params = {}) {
  const { resolvedClient, resolvedParams } = resolveClientArgs(client, params);
  const kind = resolvedParams?.kind;
  if (kind === 'image') {
    return await imageModels(resolvedClient);
  }
  const text = await textModels(resolvedClient);
  if (kind === 'text') {
    return text;
  }
  if (kind === 'audio') {
    return extractAudioModels(text);
  }
  const [images, audio] = await Promise.all([imageModels(resolvedClient), Promise.resolve(extractAudioModels(text))]);
  return { image: images, text, audio };
}

export async function respondAudio(client, params) {
  return await sayText(client, params);
}

export async function sayText(client, params) {
  const { resolvedClient, resolvedParams } = resolveClientArgs(client, params);
  const { text: message, voice, model } = resolvedParams;
  if (!message) throw new Error('sayText requires text');
  const audio = await tts(message, { voice, model }, resolvedClient);
  return {
    base64: await audio.toBase64(),
    mimeType: audio.mimeType,
    dataUrl: audio.toDataUrl(),
  };
}

function imageParameters() {
  return {
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
  };
}

function audioParameters() {
  return {
    type: 'object',
    properties: {
      text: { type: 'string' },
      voice: { type: 'string' },
      model: { type: 'string' },
    },
    required: ['text'],
  };
}

function emptyParameters() {
  return { type: 'object', properties: {} };
}

function extractAudioModels(models) {
  const audio = {};
  if (!models || typeof models !== 'object') return audio;
  for (const [name, info] of Object.entries(models)) {
    const hasVoices = Array.isArray(info?.voices) && info.voices.length > 0;
    const declaresAudio = Array.isArray(info?.capabilities) && info.capabilities.includes('audio');
    if (name.includes('audio') || hasVoices || declaresAudio) {
      audio[name] = info;
    }
  }
  return audio;
}

function resolveClientArgs(client, params) {
  if (client && typeof client.getSignedUrl === 'function') {
    return { resolvedClient: client, resolvedParams: params ?? {} };
  }
  return { resolvedClient: getDefaultClient(), resolvedParams: client ?? {} };
}
