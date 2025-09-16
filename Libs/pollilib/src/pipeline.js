import { text as textGet } from './text.js';
import { image as imageGen } from './image.js';
import { tts as ttsGen } from './audio.js';
import { vision as visionAnalyze } from './vision.js';

export class Context extends Map {}

export class Pipeline {
  constructor() {
    this.steps = [];
  }

  step(step) {
    this.steps.push(step);
    return this;
  }

  async execute({ client, context = new Context() } = {}) {
    for (const step of this.steps) {
      await step.run({ client, context });
    }
    return context;
  }
}

export class TextGetStep {
  constructor({ prompt, outKey, params = {} }) {
    this.prompt = prompt;
    this.outKey = outKey;
    this.params = params;
  }

  async run({ client, context }) {
    const value = await textGet(this.prompt, this.params, client);
    context.set(this.outKey, value);
  }
}

export class ImageStep {
  constructor({ prompt, outKey, params = {} }) {
    this.prompt = prompt;
    this.outKey = outKey;
    this.params = params;
  }

  async run({ client, context }) {
    const binary = await imageGen(this.prompt, this.params, client);
    context.set(this.outKey, {
      binary,
      mimeType: binary.mimeType,
      base64: await binary.toBase64(),
      dataUrl: binary.toDataUrl(),
    });
  }
}

export class TtsStep {
  constructor({ text, outKey, params = {} }) {
    this.text = text;
    this.outKey = outKey;
    this.params = params;
  }

  async run({ client, context }) {
    const binary = await ttsGen(this.text, this.params, client);
    context.set(this.outKey, {
      binary,
      mimeType: binary.mimeType,
      base64: await binary.toBase64(),
      dataUrl: binary.toDataUrl(),
    });
  }
}

export class VisionUrlStep {
  constructor({ imageUrl, outKey, question, params = {} }) {
    this.imageUrl = imageUrl;
    this.outKey = outKey;
    this.params = { question, ...params };
  }

  async run({ client, context }) {
    const value = await visionAnalyze({ imageUrl: this.imageUrl, ...this.params }, client);
    context.set(this.outKey, value);
  }
}
