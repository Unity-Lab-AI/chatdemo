import { getDefaultClient } from './client.js';
import { text } from './text.js';
import { image } from './image.js';
import { tts } from './audio.js';
import { vision } from './vision.js';

export class Context extends Map {
  getOrDefault(key, fallback) {
    return this.has(key) ? this.get(key) : fallback;
  }
}

export class Pipeline {
  constructor(steps = []) {
    this._steps = steps.map(normalizeStep);
  }

  use(step) {
    this._steps.push(normalizeStep(step));
    return this;
  }

  async run({ client = getDefaultClient(), context } = {}) {
    const ctx = context instanceof Context ? context : new Context(context ? Object.entries(context) : []);
    for (const step of this._steps) {
      await step({ client, context: ctx });
    }
    return ctx;
  }
}

export function textStep({ prompt, storeAs, options = {} }) {
  return async ({ client, context }) => {
    const resolvedPrompt = resolveValue(prompt, context);
    const result = await text(resolvedPrompt, resolveValue(options, context), client);
    context.set(storeAs, result);
  };
}

export function imageStep({ prompt, storeAs, options = {} }) {
  return async ({ client, context }) => {
    const resolvedPrompt = resolveValue(prompt, context);
    const result = await image(resolvedPrompt, resolveValue(options, context), client);
    context.set(storeAs, {
      binary: result,
      mimeType: result.mimeType,
      size: result.size,
      base64: await result.toBase64(),
      dataUrl: result.toDataUrl(),
    });
  };
}

export function ttsStep({ text: input, storeAs, options = {} }) {
  return async ({ client, context }) => {
    const resolvedText = resolveValue(input, context);
    const result = await tts(resolvedText, resolveValue(options, context), client);
    context.set(storeAs, {
      binary: result,
      mimeType: result.mimeType,
      size: result.size,
      base64: await result.toBase64(),
      dataUrl: result.toDataUrl(),
    });
  };
}

export function visionStep({ storeAs, options = {} }) {
  return async ({ client, context }) => {
    const payload = resolveValue(options, context);
    const result = await vision(payload, client);
    context.set(storeAs, result);
  };
}

function normalizeStep(step) {
  if (typeof step === 'function') {
    return step;
  }
  throw new Error('Pipeline steps must be functions');
}

function resolveValue(value, context) {
  if (typeof value === 'function') {
    return value(context);
  }
  return value;
}
