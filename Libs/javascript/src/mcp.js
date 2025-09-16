import { image as imageGen } from './image.js';
import { imageModels as listImage } from './image.js';
import { textModels as listText } from './text.js';

export function serverName() { return 'pollinations-multimodal-api'; }

export function toolDefinitions() {
  return {
    name: serverName(),
    tools: [
      { name: 'generateImageUrl', description: 'Generate an image and return its URL', parameters: {
        type: 'object', properties: {
          prompt: { type: 'string' }, model: { type: 'string' }, seed: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, nologo: { type: 'boolean' }, private: { type: 'boolean' }
        }, required: ['prompt'] } },
      { name: 'generateImage', description: 'Generate an image and return base64', parameters: {
        type: 'object', properties: { prompt: { type: 'string' }, model: { type: 'string' }, seed: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, required: ['prompt'] } },
      { name: 'listImageModels', description: 'List available image models', parameters: { type: 'object', properties: {} } },
      { name: 'respondAudio', description: 'Generate TTS audio (voice) from text', parameters: { type: 'object', properties: { text: { type: 'string' }, voice: { type: 'string' } }, required: ['text'] } },
      { name: 'sayText', description: 'Speak the provided text', parameters: { type: 'object', properties: { text: { type: 'string' }, voice: { type: 'string' } }, required: ['text'] } },
      { name: 'listAudioVoices', description: 'List available voices', parameters: { type: 'object', properties: {} } },
      { name: 'listTextModels', description: 'List text & multimodal models', parameters: { type: 'object', properties: {} } },
      { name: 'listModels', description: 'List models by kind', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['image','text','audio'] } } } },
    ]
  };
}

export function generateImageUrl(client, params) {
  const { prompt, ...rest } = params;
  const u = new URL(`${client.imageBase}/prompt/${encodeURIComponent(prompt)}`);
  for (const [k, v] of Object.entries(rest)) if (v != null) u.searchParams.set(k, String(v));
  if (client.referrer && !u.searchParams.has('referrer')) u.searchParams.set('referrer', client.referrer);
  if (client.token && !u.searchParams.has('token')) u.searchParams.set('token', client.token);
  return u.toString();
}

export async function generateImageBase64(client, params) {
  const data = await imageGen(params.prompt, params, client);
  return Buffer.from(data).toString('base64');
}

export async function listImageModels(client) { return await listImage(client); }
export async function listTextModels(client) { return await listText(client); }

export async function listAudioVoices(client) {
  const models = await listText(client);
  const voices = models?.['openai-audio']?.voices ?? [];
  return voices;
}

