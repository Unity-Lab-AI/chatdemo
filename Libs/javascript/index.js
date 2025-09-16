// Top-level API surface matching AGENTS.md
import { PolliClient, getDefaultClient, setDefaultClient } from './src/client.js';
import { image as _image, imageModels as _imageModels } from './src/image.js';
import { text as _text, chat as _chat, textModels as _textModels, search as _search } from './src/text.js';
import { tts as _tts, stt as _stt } from './src/audio.js';
import { vision as _vision } from './src/vision.js';
import { imageFeed as _imageFeed, textFeed as _textFeed } from './src/feeds.js';
import * as tools from './src/tools.js';
import * as mcp from './src/mcp.js';
import * as pipeline from './src/pipeline.js';

export function configure({ token = undefined, referrer = undefined, imageBase = 'https://image.pollinations.ai', textBase = 'https://text.pollinations.ai', timeoutMs = 60_000 } = {}) {
  setDefaultClient(new PolliClient({ token, referrer, imageBase, textBase, timeoutMs }));
}

export async function image(prompt, params) { return _image(prompt, params, getDefaultClient()); }
export async function text(prompt, params) { return _text(prompt, params, getDefaultClient()); }
export async function chat(args) { return _chat(args, getDefaultClient()); }
export async function search(query, model) { return _search(query, model, getDefaultClient()); }
export async function tts(text, params) { return _tts(text, params, getDefaultClient()); }
export async function stt(args) { return _stt(args, getDefaultClient()); }
export async function vision(args) { return _vision(args, getDefaultClient()); }
export async function imageModels() { return _imageModels(getDefaultClient()); }
export async function textModels() { return _textModels(getDefaultClient()); }
export function imageFeed(opts) { return _imageFeed(opts, getDefaultClient()); }
export function textFeed(opts) { return _textFeed(opts, getDefaultClient()); }

export { tools, mcp, pipeline, PolliClient };

