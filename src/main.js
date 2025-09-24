import './style.css';
import 'highlight.js/styles/github.css';
import { renderMarkdown, enhanceCodeBlocksHtml } from './lib/markdown.js';
import { looseJsonParse, repairModelOutput } from './lib/json-repair.js';
import { chat, chatStream, image, textModels } from '../Libs/pollilib/index.js';
import { generateSeed } from './seed.js';
import { createPollinationsClient } from './pollinations-client.js';
import {
  createFallbackModel,
  matchesModelIdentifier,
  normalizeTextCatalog,
} from './model-catalog.js';
import { doesResponseMatchModel, isMatchingModelName } from './model-matching.js';

const FALLBACK_MODELS = [
  createFallbackModel('openai', 'OpenAI GPT-5 Nano (fallback)'),
  createFallbackModel('mistral', 'Mistral Small (fallback)'),
];

const FALLBACK_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const DEFAULT_STATUS = 'Ready.';
const INJECTED_USER_PRIMER = `Formatting directive (output format only; does not change your tone or behavior):

- You can cause an image to be generated when the user asks for one.
- When the user asks for an image, prefer returning a single JSON object with keys:
  {
    "text": string,                     // your explanation (optional)
    "code": [                           // code blocks to show (optional)
      { "language": string, "content": string }
    ],
    "images": [                         // one or more images to generate (only if asked)
      { "prompt": string, "width": int?, "height": int?, "size": string?, "aspect_ratio": string?, "model": string?, "caption": string?, "seed": number? }
    ]
  }
- If you cannot or prefer not to return JSON, you may instead include exactly one fenced code block with language polli-image whose content is a single JSON object having the fields above (at minimum: prompt).
- Keep normal prose outside JSON and outside the polli-image code block. Do not put backticks inside JSON.
- Do not generate any image unless the user explicitly asks for an image.`;

function buildFirstTurnUserMessage(userText) {
  const intro = `The user's first message is below. Follow the formatting directive above only when applicable.`;
  return `${INJECTED_USER_PRIMER}\n\n${intro}\n\n${userText}`;
}

function hasImageIntent(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  if (t.startsWith('/image')) return true;
  // Basic heuristics: user explicitly asks for an image/picture/render
  return /\b(image|picture|photo|render|draw|sketch|illustration|wallpaper|logo)\b/.test(t) && /\b(make|create|generate|show|produce|design|render|draw|sketch)\b/.test(t);
}
const IMAGE_TOOL = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: 'Create an illustrative image for the user.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to render.',
        },
        width: {
          type: 'integer',
          minimum: 256,
          maximum: 2048,
          description: 'Optional width in pixels.',
        },
        height: {
          type: 'integer',
          minimum: 256,
          maximum: 2048,
          description: 'Optional height in pixels.',
        },
        size: {
          type: 'string',
          description: 'Optional size string like "1024x768".',
        },
        aspect_ratio: {
          type: 'string',
          description: 'Optional aspect ratio like "16:9".',
        },
        model: {
          type: 'string',
          description: 'Optional Pollinations image model name.',
        },
        caption: {
          type: 'string',
          description: 'Optional caption to show with the image.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
};

let client = null;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const app = document.querySelector('#app');
const DEBUG = (() => {
  try {
    const u = new URL(location.href);
    return u.searchParams.get('debug') === '1' || /(?:^|[#&?])debug(?:=1)?(?:&|$)/.test(location.href);
  } catch { return false; }
})();

// Ensure users get the newest build even with aggressive caches
void (async function ensureFreshBuild() {
  try {
    const res = await fetch('./version.json?cb=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const rev = String(data.rev || data.version || data.commit || '').trim();
      try { globalThis.__BUILD_REV__ = rev; } catch {}
      const key = '__site_rev';
      const prev = localStorage.getItem(key);
      if (rev && prev && rev !== prev) {
        localStorage.setItem(key, rev);
        const u = new URL(location.href);
        u.searchParams.set('v', rev);
        location.replace(u.toString());
      } else if (rev && !prev) {
        localStorage.setItem(key, rev);
      }
    }
  } catch {}
})();

// Register a service worker that prevents caching of app shell (HTML/JS/CSS)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch((err) => console.warn('SW register failed', err));
  });
}
app.innerHTML = `
  <main class="container">
    <header class="toolbar">
      <div class="field">
        <label for="modelSelect">Model</label>
        <select id="modelSelect" name="model"></select>
      </div>
      <div class="field">
        <label for="voiceSelect">Voice</label>
        <select id="voiceSelect" name="voice"></select>
      </div>
      <div class="field toggle">
        <span class="toggle-label" id="voicePlaybackLabel">Voice playback</span>
        <label class="switch" for="voicePlayback" aria-labelledby="voicePlaybackLabel">
          <input type="checkbox" id="voicePlayback" />
          <span class="slider" aria-hidden="true"></span>
          <span class="toggle-state" aria-hidden="true"></span>
        </label>
      </div>
    </header>
    <div id="status" class="status" role="status" aria-live="polite"></div>
    <section id="messages" class="messages" aria-live="polite"></section>
    <form id="chatForm" class="chat-form">
      <label class="sr-only" for="promptInput">Message</label>
      <textarea
        id="promptInput"
        placeholder="Ask anything or request an image"
        autocomplete="off"
      ></textarea>
      <button id="voiceButton" type="button" class="voice" aria-pressed="false">
        🎙️ Speak
      </button>
      <button id="sendButton" type="submit" class="primary">Send</button>
    </form>
    <p class="hint">
      Tip: Voice capture ends automatically after 0.5 seconds of silence. Ask for images
      naturally and the assistant will create them when helpful.
    </p>
  </main>
`;

let debugEl = null;
if (DEBUG) {
  const panel = document.createElement('section');
  panel.className = 'debug-panel';
  panel.style.marginTop = '12px';
  panel.style.padding = '8px 12px';
  panel.style.border = '1px solid #ccc';
  panel.style.borderRadius = '6px';
  panel.style.background = '#fafafa';
  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
      <h3 style="margin:0; font-size:14px;">Diagnostics</h3>
      <div style="display:flex; gap:6px;">
        <button id="dbgCopy" class="ghost" type="button">Copy Logs</button>
        <button id="dbgClear" class="ghost" type="button">Clear Logs</button>
        <button id="dbgHealth" class="ghost" type="button">Health Check</button>
        <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px; color:#374151;">
          <input id="dbgShowPayloads" type="checkbox" /> Show payload meta
        </label>
      </div>
    </div>
    <div id="debugContent" style="margin-top:8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; font-size:12px; white-space:pre-wrap;"></div>
  `;
  app.querySelector('.container')?.appendChild(panel);
  debugEl = panel.querySelector('#debugContent');
  const btnCopy = panel.querySelector('#dbgCopy');
  const btnClear = panel.querySelector('#dbgClear');
  const btnHealth = panel.querySelector('#dbgHealth');
  const chkPayload = panel.querySelector('#dbgShowPayloads');
  if (btnCopy) btnCopy.addEventListener('click', copyLogsToClipboard);
  if (btnClear) btnClear.addEventListener('click', clearPanelLogs);
  if (btnHealth) btnHealth.addEventListener('click', runHealthCheck); 
  if (chkPayload) chkPayload.addEventListener('change', () => renderDebugPanel());

  // Ensure a log buffer exists and live-refresh the panel
  try {
    if (!globalThis.__PANEL_LOG__ || !Array.isArray(globalThis.__PANEL_LOG__)) {
      globalThis.__PANEL_LOG__ = [];
    }
  } catch {}
  try {
    if (!globalThis.__DBG_REFRESH__) {
      globalThis.__DBG_REFRESH__ = setInterval(() => renderDebugPanel(), 1000);
    }
  } catch {}
  renderDebugPanel();
}

function renderDebugPanel(extra = {}) {
  if (!DEBUG || !debugEl) return;
  const rev = (globalThis && globalThis.__BUILD_REV__) || null;
  const ref = (globalThis && globalThis.__POLLINATIONS_REFERRER__) || null;
  const log = (globalThis && globalThis.__PANEL_LOG__) || [];
  const active = state?.activeModel?.info?.id || els?.modelSelect?.value || null;
  const endpoints = state?.activeModel?.info?.endpoints || [];
  const recent = log.slice(-12);
  const sw = (navigator.serviceWorker && navigator.serviceWorker.controller) ? 'active' : 'none';
  const modelPinned = state?.pinnedModelId || null;
  const convoLen = state?.conversation?.length || 0;
  const showPayloads = !!document.querySelector('#dbgShowPayloads')?.checked;
  const ua = navigator.userAgent;
  const url = location.href;
  const jsonMode = false;
  const payload = {
    version: rev,
    referrer: ref,
    selectedModel: active,
    pinnedModel: modelPinned,
    endpoints,
    jsonMode,
    url,
    ua,
    serviceWorker: sw,
    conversationLength: convoLen,
    lastRequests: recent,
    ...extra,
  };
  if (!showPayloads) {
    // Redact verbose details
    const redacted = JSON.parse(JSON.stringify(payload));
    if (Array.isArray(redacted.lastRequests)) {
      redacted.lastRequests = redacted.lastRequests.map(entry => {
        const e = { ...entry };
        if (e.meta && typeof e.meta === 'object') {
          // keep only high-level meta flags
          e.meta = {
            ...('endpoint' in e.meta ? { endpoint: e.meta.endpoint } : {}),
            ...('json' in e.meta ? { json: e.meta.json } : {}),
            ...('has_tools' in e.meta ? { has_tools: e.meta.has_tools } : {}),
            ...('tool_count' in e.meta ? { tool_count: e.meta.tool_count } : {}),
          };
        }
        // trim noisy fields
        delete e.prompt; delete e.payload; delete e.body;
        return e;
      });
    }
    debugEl.textContent = JSON.stringify(redacted, null, 2);
  } else {
    debugEl.textContent = JSON.stringify(payload, null, 2);
  }
}

// Fast-path streaming for text-only prompts to improve perceived latency
async function sendPromptStreaming(prompt) {
  const selectedModel = getSelectedModel();
  if (!selectedModel) throw new Error('No model selected.');
  if (!client) throw new Error('Pollinations client is not ready.');
  const endpoints = buildEndpointSequence(selectedModel);
  if (!endpoints.length) throw new Error(`No endpoints available for model "${selectedModel.label ?? selectedModel.id}".`);

  const startingLength = state.conversation.length;
  // Do NOT inject the JSON primer for streaming text-only turns
  state.conversation.push({ role: 'user', content: prompt });
  try {
    setStatus('Streaming response…');
    const assistantMsg = addMessage({ role: 'assistant', type: 'text', content: '' });
    const pinnedId = state.pinnedModelId || selectedModel.id;
    const endpoint = endpoints[0] || 'openai';
    state.activeModel = { id: pinnedId, endpoint, info: selectedModel };
    if (!state.pinnedModelId) state.pinnedModelId = pinnedId;
    let streamed = '';
    try {
      for await (const chunk of chatStream({ model: pinnedId, endpoint, messages: state.conversation, seed: generateSeed() }, client)) {
        if (typeof chunk === 'string' && chunk) {
          streamed += chunk;
          assistantMsg.content = streamed;
          renderMessages();
        }
      }
    } catch (e) {
      // Fallback to existing non-stream flow
      console.warn('Streaming failed; falling back to standard request', e);
      state.conversation.length = startingLength; // revert user injection
      return await sendPrompt(prompt);
    }
    if (streamed.trim()) {
      state.conversation.push({ role: 'assistant', content: streamed });
      if (state.voicePlayback && els.voiceSelect.value) {
        void speakMessage(assistantMsg, { autoplay: true });
      }
    }
    resetStatusIfIdle();
  } catch (error) {
    console.error('Chat error (streaming)', error);
    state.conversation.length = startingLength;
    throw error;
  }
}

async function copyLogsToClipboard() {
  try {
    const data = (globalThis && globalThis.__PANEL_LOG__) || [];
    const payload = { when: new Date().toISOString(), data };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setStatus('Diagnostics copied to clipboard.');
    setTimeout(() => resetStatusIfIdle(), 1500);
  } catch (e) {
    console.warn('Copy failed', e);
    setStatus('Unable to copy diagnostics.', { error: true });
  }
}

function clearPanelLogs() {
  try {
    const log = (globalThis && globalThis.__PANEL_LOG__);
    if (log && Array.isArray(log)) log.length = 0;
    renderDebugPanel();
    setStatus('Diagnostics cleared.');
    setTimeout(() => resetStatusIfIdle(), 1200);
  } catch (e) {
    console.warn('Clear logs failed', e);
  }
}

async function runHealthCheck() {
  try {
    const model = getSelectedModel();
    if (!model) throw new Error('No model selected.');
    if (!client) throw new Error('Client not ready.');
    setStatus('Running health check…');
    const messages = [{ role: 'user', content: 'Return the word OK.' }];
    const payload = { model: model.id, endpoint: 'openai', messages, response_format: { type: 'json_object' } };
    const started = Date.now();
    const resp = await chat(payload, client);
    const ms = Date.now() - started;
    const ok = Array.isArray(resp?.choices) && (resp.choices[0]?.message?.content ?? '').length >= 2;
    renderDebugPanel({ health: { ok, ms, model: model.id } });
    setStatus(ok ? `Health OK (${ms} ms).` : `Health failed (${ms} ms).`, { error: !ok });
    setTimeout(() => resetStatusIfIdle(), 1500);
  } catch (e) {
    console.warn('Health check failed', e);
    renderDebugPanel({ health: { ok: false, error: e?.message || String(e) } });
    setStatus('Health check failed: ' + (e?.message || String(e)), { error: true });
  }
}

const els = {
  form: document.querySelector('#chatForm'),
  input: document.querySelector('#promptInput'),
  messages: document.querySelector('#messages'),
  modelSelect: document.querySelector('#modelSelect'),
  voiceSelect: document.querySelector('#voiceSelect'),
  status: document.querySelector('#status'),
  voiceButton: document.querySelector('#voiceButton'),
  sendButton: document.querySelector('#sendButton'),
  voicePlayback: document.querySelector('#voicePlayback'),
};

els.modelSelect.disabled = true;
els.voiceSelect.disabled = true;
if (els.voicePlayback) {
  els.voicePlayback.disabled = true;
  els.voicePlayback.checked = false;
}

const state = {
  conversation: [],
  messages: [],
  loading: false,
  models: [],
  activeModel: null,
  pinnedModelId: null,
  imagePrimerSent: false,
  voicePlayback: false,
  statusMessage: DEFAULT_STATUS,
  statusError: false,
};

let messageIdCounter = 0;
let recognition = null;
let recognizing = false;
let recognitionSilenceTimer = null;
let recognitionBaseText = '';
let recognitionFinalText = '';
let playbackStatusTimer = null;
const trackedAudioUrls = new Set();

function setStatus(message = DEFAULT_STATUS, options = {}) {
  const { error = false } = options;
  const text = message && message.length ? message : DEFAULT_STATUS;
  if (playbackStatusTimer) {
    clearTimeout(playbackStatusTimer);
    playbackStatusTimer = null;
  }
  state.statusMessage = text;
  state.statusError = !!error;
  els.status.textContent = text;
  els.status.classList.toggle('error', !!error);
}

function resetStatusIfIdle() {
  if (!state.statusError && !state.loading && !recognizing) {
    setStatus(DEFAULT_STATUS);
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;
  els.sendButton.disabled = isLoading;
  els.voiceButton.disabled = isLoading && !recognizing;
  els.input.disabled = isLoading && !recognizing;
  els.form.classList.toggle('loading', isLoading);
  if (!isLoading) {
    resetStatusIfIdle();
  }
}

function safeJsonParse(text) {
  if (text == null) return null;
  try {
    return JSON.parse(String(text));
  } catch { return null; }
}

// Attempt to parse slightly malformed JSON often produced by models.
// - Strips code fences and language tags if present
// - Removes line and block comments
// - Replaces smart quotes with standard quotes
// - Removes trailing commas before } or ]
function __unused_looseJsonParse(text) {
  if (text == null) return null;
  let s = String(text).trim();
  // Remove surrounding code fences if any
  if (/^```/.test(s)) {
    s = s.replace(/^```[a-zA-Z0-9_-]*\s*\r?\n/, '');
    s = s.replace(/\r?\n?```\s*$/, '');
  }
  // Normalize quotes
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, '"');
  // Remove comments (best-effort)
  s = s.replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
  s = s.replace(/^\s*\/\/.*$/gm, ''); // line comments
  // Remove trailing commas
  s = s.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(s); } catch { return null; }
}

async function renderFromJsonPayload(payload) {
  try {
    if (payload == null || typeof payload !== 'object') return;
    const { text, code, images } = coerceJsonPayload(payload);

    let combinedText = '';
    if (text && text.trim()) combinedText += text.trim();
    if (code.length) {
      const fences = code
        .map(block => {
          const lang = typeof block?.language === 'string' && block.language.trim() ? block.language.trim() : '';
          const content = typeof block?.content === 'string' ? block.content : (typeof block?.code === 'string' ? block.code : '');
          return content ? `\n\n\`\`\`${lang}\n${content}\n\`\`\`\n` : '';
        })
        .filter(Boolean)
        .join('');
      combinedText += fences;
    }
    if (combinedText.trim()) {
      const msg = addMessage({ role: 'assistant', type: 'text', content: combinedText.trim() });
      if (state.voicePlayback && els.voiceSelect.value) {
        void speakMessage(msg, { autoplay: true });
      }
    }

    for (const img of images) {
      try {
        const prompt = typeof img?.prompt === 'string' ? img.prompt.trim() : '';
        if (!prompt) continue;
        const { width, height } = resolveDimensions(img);
        const caption = String(img.caption ?? prompt).trim() || prompt;
        const { dataUrl, seed } = await generateImageAsset(prompt, {
          width,
          height,
          model: img.model,
          seed: img.seed,
        });
        addMessage({ role: 'assistant', type: 'image', url: dataUrl, alt: caption, caption });
        console.info('Rendered image from JSON payload (seed %s).', seed);
      } catch (err) {
        console.warn('Failed to render image from JSON payload:', err);
        addMessage({ role: 'assistant', type: 'error', content: String(err?.message ?? err) });
      }
    }
  } catch (error) {
    console.warn('renderFromJsonPayload error, falling back to text', error);
  }
}

function tokenizeMarkdownBlocks(text) {
  const tokens = [];
  const re = /```([a-zA-Z0-9_-]*)\s*\r?\n([\s\S]*?)\r?\n?```/g;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    if (before) tokens.push({ type: 'paragraph', text: before });
    tokens.push({ type: 'code', lang: (m[1] || '').toLowerCase(), content: m[2] || '' });
    lastIndex = re.lastIndex;
  }
  const tail = text.slice(lastIndex);
  if (tail) tokens.push({ type: 'paragraph', text: tail });
  return tokens;
}

function extractPolliImagesFromText(text) {
  const tokens = tokenizeMarkdownBlocks(String(text || ''));
  const directives = [];
  const accepted = new Set(['polli-image', 'pollinations.image', 'image', 'json']);
  const kept = [];
  for (const t of tokens) {
    if (t.type === 'code' && accepted.has(t.lang)) {
      const raw = t.content.trim();
      try {
        let obj = null;
        try { obj = JSON.parse(raw); } catch { obj = looseJsonParse(raw); }
        // Accept multiple shapes: {images:[...]}, {prompt:...}, {image:{prompt:...}}
        if (obj && typeof obj === 'object') {
          if (Array.isArray(obj.images) && obj.images.length) {
            for (const im of obj.images) {
              if (im && typeof im.prompt === 'string' && im.prompt.trim()) directives.push(im);
            }
            continue; // omit from kept
          }
          if (obj.image && typeof obj.image === 'object' && typeof obj.image.prompt === 'string') {
            directives.push({ ...obj.image });
            continue;
          }
          if (typeof obj.prompt === 'string' && obj.prompt.trim().length) {
            directives.push(obj);
            continue; // omit from kept
          }
        }
      } catch (e) {
        console.warn('Invalid JSON payload in code fence (ignored):', e);
        // If looks like a JSON-ish image payload, attempt lenient parse
        if (/"images"\s*:\s*\[/.test(raw) || /\bprompt\b/.test(raw)) {
          const obj = looseJsonParse(raw);
          if (obj && typeof obj === 'object') {
            if (Array.isArray(obj.images) && obj.images.length) {
              for (const im of obj.images) {
                if (im && typeof im.prompt === 'string' && im.prompt.trim()) directives.push(im);
              }
              continue;
            }
            if (obj.image && typeof obj.image === 'object' && typeof obj.image.prompt === 'string') {
              directives.push({ ...obj.image });
              continue;
            }
            if (typeof obj.prompt === 'string' && obj.prompt.trim().length) {
              directives.push(obj);
              continue;
            }
          }
        }
      }
    }
    // Also attempt to catch bare code fences without a language containing an images payload
    if (t.type === 'code' && !t.lang) {
      const raw = t.content.trim();
      if (/"images"\s*:\s*\[/.test(raw)) {
        const obj = looseJsonParse(raw);
        if (obj && typeof obj === 'object' && Array.isArray(obj.images) && obj.images.length) {
          for (const im of obj.images) {
            if (im && typeof im.prompt === 'string' && im.prompt.trim()) directives.push(im);
          }
          // omit this code block from output if it looked like an image directive
          continue;
        }
      }
    }
    kept.push(t);
  }
  const cleaned = kept
    .map(t => {
      if (t.type === 'code') {
        const lang = t.lang ? t.lang : '';
        return `\n\n\`\`\`${lang}\n${t.content}\n\`\`\`\n\n`;
      }
      return t.text;
    })
    .join('');
  return { cleaned, directives };
}

// Fallback: extract JSON objects with an images[] field from arbitrary text (not fenced)
function extractImagePayloadsFromAnyText(text) {
  const s = String(text || '');
  const results = [];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j += 1) {
      const ch = s[j];
      if (inStr) {
        if (esc) { esc = false; }
        else if (ch === '\\') { esc = true; }
        else if (ch === '"') { inStr = false; }
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            const chunk = s.slice(i, j + 1);
            if (/"images"\s*:\s*\[/.test(chunk)) {
              const obj = looseJsonParse(chunk) || safeJsonParse(chunk);
              if (obj && typeof obj === 'object') results.push(obj);
            }
            i = j; // advance outer loop
            break;
          }
        }
      }
    }
  }
  return results;
}

function disableApplicationControls() {
  const controls = [
    els.sendButton,
    els.voiceButton,
    els.input,
    els.modelSelect,
    els.voiceSelect,
    els.voicePlayback,
  ];
  for (const control of controls) {
    if (control) {
      control.disabled = true;
    }
  }
  if (els.voicePlayback) {
    els.voicePlayback.checked = false;
  }
  state.voicePlayback = false;
  cancelAllTtsJobs({ clearHistory: true });
  els.form.classList.remove('loading');
}

function addMessage(message) {
  const enriched = { ...message, id: ++messageIdCounter };
  state.messages.push(enriched);
  renderMessages();
  return enriched;
}

function resetConversation({ clearMessages = false } = {}) {
  state.conversation = [];
  state.activeModel = null;
  if (clearMessages) {
    state.messages = [];
    messageIdCounter = 0;
    renderMessages();
  }
  cancelAllTtsJobs({ clearHistory: true });
}

function renderMessages() {
  const container = els.messages;
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const message of state.messages) {
    const article = document.createElement('article');
    article.className = `message ${message.role}${message.type === 'error' ? ' error' : ''}`;
    try { article.dataset.messageId = String(message.id || ''); } catch {}

    if (message.type === 'image') {
      const wrapper = document.createElement('div');
      wrapper.className = 'message-image';
      const img = document.createElement('img');
      img.src = message.url;
      img.alt = message.alt ?? 'Pollinations generated image';
      img.loading = 'lazy';
      wrapper.appendChild(img);
      article.appendChild(wrapper);
      if (message.caption) {
        const caption = document.createElement('p');
        caption.textContent = message.caption;
        article.appendChild(caption);
      }
    } else {
      renderTextInto(article, message.content ?? '');
    }

    if (message.role === 'assistant' && message.type === 'text') {
      if (message.audioPending) {
        const pending = document.createElement('p');
        pending.className = 'audio-status';
        pending.textContent = 'Generating audio…';
        article.appendChild(pending);
      } else if (message.audioError) {
        const error = document.createElement('p');
        error.className = 'audio-status error';
        error.textContent = `Audio unavailable: ${message.audioError}`;
        article.appendChild(error);
      } else if (message.audioUrl) {
        const replay = document.createElement('button');
        replay.type = 'button';
        replay.className = 'play';
        replay.textContent = '🔁 Replay audio';
        replay.addEventListener('click', () => playMessageAudio(message));
        article.appendChild(replay);
      }
    }

    // Ensure a TTS status placeholder exists for assistant text messages
    if (message.role === 'assistant' && message.type === 'text') {
      const tts = document.createElement('div');
      tts.className = 'tts-status';
      try { tts.dataset.messageId = String(message.id || ''); } catch {}
      article.appendChild(tts);
    }
    fragment.appendChild(article);
  }
  container.appendChild(fragment);
  syncAllTtsStatusEls();
  container.scrollTop = container.scrollHeight;
}

function renderTextInto(container, text) {
  const html = enhanceCodeBlocksHtml(renderMarkdown(String(text ?? '')));
  const wrapper = document.createElement('div');
  wrapper.className = 'md';
  wrapper.innerHTML = html;

  // Preserve legacy behavior: turn plain image links into inline images
  // Find anchor tags whose href looks like an image, replace with image block
  const anchors = wrapper.querySelectorAll('a[href]');
  anchors.forEach(a => {
    const href = String(a.getAttribute('href') || '');
    if (/\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?.*)?$/i.test(href)) {
      const block = document.createElement('div');
      block.className = 'message-image';
      const img = document.createElement('img');
      img.src = href;
      img.alt = a.textContent || 'Image from response';
      img.loading = 'lazy';
      block.appendChild(img);
      a.replaceWith(block);
    }
  });

  // Enable copy-to-clipboard on code blocks (event delegation)
  enableCopyButtons(wrapper);

  container.appendChild(wrapper);
}

function enableCopyButtons(root) {
  if (!root) return;
  root.addEventListener('click', async (event) => {
    const btn = event.target && event.target.closest ? event.target.closest('button.copy-code') : null;
    if (!btn || !root.contains(btn)) return;
    const block = btn.closest('.code-block');
    const codeEl = block ? block.querySelector('pre > code') : null;
    if (!codeEl) return;
    const text = codeEl.textContent || '';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = prev || 'Copy';
        btn.disabled = false;
      }, 1500);
    } catch (err) {
      console.warn('Copy failed', err);
      setStatus('Unable to copy code.', { error: true });
    }
  });
}

async function speakMessage(_message, _opts = {}) {
  try {
    const voice = els.voiceSelect?.value || '';
    if (!state.voicePlayback || !voice || !_message || typeof _message.content !== 'string') return;
    const text = String(_message.content || '').trim();
    if (!text) return;
    if (isMessageInTtsPipeline(_message?.id)) return; // avoid duplicate starts for same message
    startVoicePlaybackForMessage(_message, voice);
  } catch {}
}

async function playMessageAudio(message) {
  if (!message?.audioUrl) return;
  try {
    const audio = new Audio(message.audioUrl);
    await audio.play();
  } catch (error) {
    console.error('Audio playback failed', error);
    setStatus(`Unable to play audio: ${error?.message ?? error}`, { error: true });
  }
}

// -------------------- Voice playback (TTS) --------------------
let currentTtsJob = null;
const ttsQueue = [];
const ttsJobsByMessage = new Map();
const ttsFetchQueue = [];
let ttsFetchWorkerActive = false;
let lastTtsFetchEndedAt = 0;
let ttsFetchCooldownMs = 750;
const TTS_PREFETCH_AHEAD = 3;
const TTS_FETCH_MAX_RETRIES = 4;
const TTS_FETCH_MIN_COOLDOWN_MS = 350;
const TTS_FETCH_MAX_COOLDOWN_MS = 4500;
const TTS_FETCH_FAST_THRESHOLD_MS = 1800;
const TTS_FETCH_SLOW_THRESHOLD_MS = 4200;
const TTS_FETCH_VERY_SLOW_THRESHOLD_MS = 6500;
const SILENT_WAV_DATA_URL = 'data:audio/wav;base64,UklGRhYAAABXQVZFZm10IBIAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';
const TTS_CHUNK_MAX_CHARS = 250;
const TTS_CHUNK_ERROR = Symbol('tts-chunk-error');
let audioUnlocked = false;
let audioUnlockPromise = null;
let lastAudioUnlockWarning = 0;

function isAutoplayError(error) {
  if (!error) return false;
  const name = typeof error.name === 'string' ? error.name.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : String(error || '').toLowerCase();
  if (name.includes('notallowed')) return true;
  return /autoplay|user gesture|user-gesture|gesture|interaction required|notallowed/.test(message);
}

async function tryUnlockWithAudioContext() {
  try {
    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextCtor) return false;
    const ctx = new AudioContextCtor();
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      if (typeof source.stop === 'function') {
        try { source.stop(0); } catch {}
      }
      await sleep(0);
      return true;
    } finally {
      try { await ctx.close(); } catch {}
    }
  } catch (error) {
    return false;
  }
}

async function tryUnlockWithSilentAudio() {
  try {
    if (typeof globalThis.Audio !== 'function') return false;
    const audio = new Audio(SILENT_WAV_DATA_URL);
    audio.muted = true;
    audio.volume = 0;
    await audio.play();
    audio.pause();
    return true;
  } catch (error) {
    return false;
  }
}

async function unlockAudioPlayback() {
  if (audioUnlocked) return true;
  if (audioUnlockPromise) return audioUnlockPromise;
  if (typeof globalThis === 'undefined') return false;
  audioUnlockPromise = (async () => {
    let unlocked = await tryUnlockWithAudioContext();
    if (!unlocked) {
      unlocked = await tryUnlockWithSilentAudio();
    }
    if (unlocked) {
      audioUnlocked = true;
    }
    return unlocked;
  })();
  try {
    return await audioUnlockPromise;
  } finally {
    audioUnlockPromise = null;
  }
}

function notifyAudioPlaybackBlocked() {
  const now = Date.now();
  if (now - lastAudioUnlockWarning < 3000) return;
  lastAudioUnlockWarning = now;
  setStatus('Audio playback was blocked by the browser. Tap anywhere on the page to enable sound and try again.', {
    error: true,
  });
}

async function playAudioWithUnlock(audio) {
  if (!audio) return;
  try {
    await audio.play();
  } catch (error) {
    if (!isAutoplayError(error)) {
      console.warn('Audio playback failed', error);
      return;
    }
    const unlocked = await unlockAudioPlayback();
    if (!unlocked) {
      console.warn('Audio playback blocked by browser policies.', error);
      notifyAudioPlaybackBlocked();
      return;
    }
    try {
      await audio.play();
    } catch (retryError) {
      console.warn('Audio playback failed even after unlock', retryError);
      notifyAudioPlaybackBlocked();
    }
  }
}

function getReferrer() {
  try {
    if (globalThis && globalThis.__POLLINATIONS_REFERRER__) return globalThis.__POLLINATIONS_REFERRER__;
  } catch {}
  try { return window.location.origin; } catch {}
  return null;
}

function stripNonSpokenParts(text) {
  let s = String(text || '');
  // Remove fenced code blocks and polli-image blocks
  s = s.replace(/```[\s\S]*?```/g, ' ');
  // Remove multiple spaces/newlines
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function splitIntoSentences(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  // Split on sentence terminators while keeping them attached
  const parts = [];
  let buf = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    buf += ch;
    if (/[\.!?]/.test(ch)) {
      // consume following closing quotes/brackets if any
      let j = i + 1;
      while (j < s.length && /["'\)\]]/.test(s[j])) { buf += s[j]; j += 1; }
      parts.push(buf.trim());
      buf = '';
      i = j - 1;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function groupSentences(sentences, groupSize = 2) {
  const groups = [];
  for (let i = 0; i < sentences.length; i += groupSize) {
    groups.push(sentences.slice(i, i + groupSize).join(' '));
  }
  return groups;
}

// Build TTS chunks by character length, prefer ending at sentence boundaries.
// - maxChars: hard cap per chunk (default 250)
// - If a single sentence exceeds max, split it on whitespace near the limit.
function buildTtsChunks(text, { maxChars = TTS_CHUNK_MAX_CHARS } = {}) {
  const sents = splitIntoSentences(text);
  const chunks = [];
  let i = 0;
  while (i < sents.length) {
    let chunk = '';
    let added = 0;
    while (i < sents.length) {
      const next = sents[i];
      const sep = chunk ? ' ' : '';
      if ((chunk.length + sep.length + next.length) <= maxChars) {
        chunk += sep + next;
        i += 1;
        added += 1;
      } else {
        break;
      }
    }
    if (!chunk) {
      // Single long sentence; split within maxChars using last whitespace
      const long = sents[i];
      const slice = long.slice(0, maxChars);
      const cut = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf(','), slice.lastIndexOf(';'));
      const end = cut > 40 ? cut : maxChars; // avoid cutting too early
      chunk = slice.slice(0, end).trim();
      sents[i] = long.slice(end).trim(); // keep remainder as a sentence
      if (!sents[i]) i += 1;
    }
    if (chunk) chunks.push(chunk);
    // If we added 0 sentences and remainder is empty, break to avoid infinite loop
    if (!chunk && i >= sents.length) break;
  }
  return chunks;
}

async function fetchTtsAudioUrl(text, voice) {
  const ref = getReferrer();
  const base = 'https://text.pollinations.ai';
  const header = 'Speak only the following text, exactly as it is written:';
  const attempts = [
    { withHeader: true, system: true },
    { withHeader: true, system: false },
    { withHeader: false, system: true },
    { withHeader: false, system: false },
  ];
  for (const a of attempts) {
    const combined = a.withHeader ? `${header}\n${text}` : text;
    const u = new URL(base + '/' + encodeURIComponent(combined));
    u.searchParams.set('model', 'openai-audio');
    u.searchParams.set('voice', String(voice));
    u.searchParams.set('temperature', '0');
    u.searchParams.set('top_p', '0');
    u.searchParams.set('presence_penalty', '0');
    u.searchParams.set('frequency_penalty', '0');
    u.searchParams.set('safe', 'false');
    if (a.system) u.searchParams.set('system', 'Speak exactly the provided text verbatim. Do not add, rephrase, or omit any words. Read only the content after the line break.');
    if (ref) u.searchParams.set('referrer', ref);
    // cache-buster to avoid any gateway caches returning truncated audio
    u.searchParams.set('cb', String(Date.now()) + Math.random().toString(36).slice(2));
    try {
      const resp = await fetch(u.toString(), { method: 'GET' });
      if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);
      const blob = await resp.blob();
      // Basic sanity: require something that looks like audio
      const ctype = resp.headers.get('Content-Type') || '';
      if (ctype && !/audio\//i.test(ctype)) {
        // Still try to play; some gateways do not set correct type
      }
      const url = URL.createObjectURL(blob);
      trackedAudioUrls.add(url);
      return url;
    } catch (e) {
      // Try next attempt
      continue;
    }
  }
  throw new Error('TTS fetch failed for all attempts');
}

function clampTtsCooldown(value) {
  return Math.max(TTS_FETCH_MIN_COOLDOWN_MS, Math.min(TTS_FETCH_MAX_COOLDOWN_MS, value));
}

function adjustTtsCooldownOnSuccess(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    ttsFetchCooldownMs = clampTtsCooldown(Math.round(ttsFetchCooldownMs * 0.9) || TTS_FETCH_MIN_COOLDOWN_MS);
    return;
  }
  if (durationMs >= TTS_FETCH_VERY_SLOW_THRESHOLD_MS) {
    const target = clampTtsCooldown(Math.round(durationMs * 0.35));
    ttsFetchCooldownMs = Math.max(ttsFetchCooldownMs, target);
  } else if (durationMs >= TTS_FETCH_SLOW_THRESHOLD_MS) {
    ttsFetchCooldownMs = clampTtsCooldown(Math.round(ttsFetchCooldownMs * 1.1));
  } else if (durationMs <= TTS_FETCH_FAST_THRESHOLD_MS) {
    ttsFetchCooldownMs = clampTtsCooldown(Math.round(ttsFetchCooldownMs * 0.7));
  } else {
    ttsFetchCooldownMs = clampTtsCooldown(Math.round(ttsFetchCooldownMs * 0.85));
  }
}

function adjustTtsCooldownOnError() {
  ttsFetchCooldownMs = clampTtsCooldown(Math.round(ttsFetchCooldownMs * 1.65 + 320));
}

function removeQueuedFetchesForJob(job) {
  if (!job) return;
  for (let i = ttsFetchQueue.length - 1; i >= 0; i -= 1) {
    if (ttsFetchQueue[i]?.job === job) {
      ttsFetchQueue.splice(i, 1);
    }
  }
  if (job.pendingFetches && typeof job.pendingFetches.clear === 'function') {
    job.pendingFetches.clear();
  }
}

function queueTtsFetch(job, index, attempt = 0, delayMs = 0) {
  if (!job || job.cancelled || job.completed) return;
  if (!Array.isArray(job.groups) || !job.groups[index]) return;
  if (job.pendingFetches?.has(index)) return;
  const task = {
    job,
    index,
    attempt,
    readyAt: Date.now() + Math.max(0, delayMs || 0),
  };
  if (job.pendingFetches) {
    job.pendingFetches.add(index);
  }
  ttsFetchQueue.push(task);
  ttsFetchQueue.sort((a, b) => (a.readyAt || 0) - (b.readyAt || 0));
  runTtsFetchQueue();
}

function scheduleMoreTtsFetches(job) {
  if (!job || job.cancelled || job.completed || currentTtsJob !== job) return;
  while (
    job.nextFetchIndex < job.groups.length &&
    (job.nextFetchIndex - job.playIndex) <= TTS_PREFETCH_AHEAD &&
    ((job.pendingFetches?.size ?? 0) + job.inflight) < (TTS_PREFETCH_AHEAD + 1)
  ) {
    queueTtsFetch(job, job.nextFetchIndex);
    job.nextFetchIndex += 1;
  }
}

function runTtsFetchQueue() {
  if (ttsFetchWorkerActive) return;
  ttsFetchWorkerActive = true;
  (async () => {
    try {
      while (ttsFetchQueue.length) {
        const task = ttsFetchQueue[0];
        if (!task) break;
        const now = Date.now();
        if (task.readyAt && task.readyAt > now) {
          await sleep(Math.min(task.readyAt - now, 250));
          continue;
        }
        ttsFetchQueue.shift();
        const { job, index, attempt } = task;
        if (!job) continue;
        job.pendingFetches?.delete(index);
        if (job.cancelled || job.completed || currentTtsJob !== job) {
          continue;
        }
        if (typeof job.results[index] !== 'undefined') {
          scheduleMoreTtsFetches(job);
          continue;
        }
        if (!job.groups || !job.groups[index]) {
          scheduleMoreTtsFetches(job);
          continue;
        }

        const wait = Math.max(0, (lastTtsFetchEndedAt + ttsFetchCooldownMs) - Date.now());
        if (wait > 0) {
          await sleep(wait);
        }

        job.inflight += 1;
        setTtsChunkState(job, index, 'sent');
        const fetchStart = Date.now();
        let url = null;
        let error = null;
        try {
          url = await fetchTtsAudioUrl(job.groups[index], job.voice);
        } catch (err) {
          error = err;
        }
        const duration = Date.now() - fetchStart;
        job.inflight = Math.max(0, job.inflight - 1);
        lastTtsFetchEndedAt = Date.now();

        if (job.cancelled || job.completed || currentTtsJob !== job) {
          continue;
        }

        if (!error && url) {
          job.results[index] = url;
          setTtsChunkState(job, index, 'received');
          adjustTtsCooldownOnSuccess(duration);
          tryStartPlayback(job);
        } else {
          console.warn('TTS fetch failed', error);
          adjustTtsCooldownOnError();
          if (attempt + 1 < TTS_FETCH_MAX_RETRIES) {
            const retryDelay = Math.min(4000, Math.round((attempt + 1) * 900 + Math.random() * 250));
            queueTtsFetch(job, index, attempt + 1, retryDelay);
          } else {
            job.results[index] = TTS_CHUNK_ERROR;
            setTtsChunkState(job, index, 'error');
            tryStartPlayback(job);
          }
        }

        scheduleMoreTtsFetches(job);
      }
    } finally {
      ttsFetchWorkerActive = false;
      if (ttsFetchQueue.length) {
        runTtsFetchQueue();
      }
    }
  })();
}

function isMessageInTtsPipeline(messageId) {
  if (messageId == null) return false;
  if (currentTtsJob && !currentTtsJob.cancelled && currentTtsJob.messageId === messageId) return true;
  return ttsQueue.some(job => !job.cancelled && job.messageId === messageId);
}

function ensureTtsStatusElement(job) {
  if (!job) return null;
  if (job.statusEl && job.statusEl.isConnected) return job.statusEl;
  try {
    const article = document.querySelector(`article.message.assistant[data-message-id="${String(job.messageId)}"]`);
    if (!article) return null;
    let el = article.querySelector('.tts-status');
    if (!el) {
      el = document.createElement('div');
      el.className = 'tts-status';
      article.appendChild(el);
    }
    job.statusEl = el;
    return el;
  } catch {
    return null;
  }
}

function cancelTtsJob(job, { resetPending = false } = {}) {
  if (!job) return;
  removeQueuedFetchesForJob(job);
  job.cancelled = true;
  for (const t of job.timers) clearTimeout(t);
  job.timers.length = 0;
  if (job.audio) {
    try { job.audio.pause(); } catch {}
  }
  job.audio = null;
  job.activeIndex = null;
  job.inflight = 0;
  job.nextFetchIndex = job.groups.length;
  if (resetPending && Array.isArray(job.status)) {
    for (let i = 0; i < job.status.length; i += 1) {
      if (job.status[i] !== 'done' && job.status[i] !== 'error') {
        job.status[i] = 'pending';
      }
    }
    renderTtsStatus(job);
  }
}

function cancelAllTtsJobs({ clearHistory = false } = {}) {
  if (currentTtsJob) {
    cancelTtsJob(currentTtsJob, { resetPending: true });
    currentTtsJob = null;
  }
  while (ttsQueue.length) {
    const job = ttsQueue.shift();
    cancelTtsJob(job, { resetPending: true });
  }
  if (clearHistory) {
    ttsJobsByMessage.clear();
  }
}

function createTtsJob(message, voice) {
  const raw = stripNonSpokenParts(message?.content || '');
  if (!raw) return null;
  const chunks = buildTtsChunks(raw, { maxChars: TTS_CHUNK_MAX_CHARS });
  if (!chunks.length) return null;

  return {
    messageId: message.id,
    voice,
    groups: chunks,
    nextFetchIndex: 0,
    inflight: 0,
    results: new Array(chunks.length),
    playIndex: 0,
    activeIndex: null,
    timers: [],
    audio: null,
    cancelled: false,
    completed: false,
    status: new Array(chunks.length).fill('pending'),
    statusEl: null,
    started: false,
    pendingFetches: new Set(),
  };
}

function activateNextTtsJob() {
  if (currentTtsJob) return;
  while (ttsQueue.length) {
    const nextJob = ttsQueue.shift();
    if (!nextJob || nextJob.cancelled) {
      continue;
    }
    currentTtsJob = nextJob;
    beginTtsJob(nextJob);
    break;
  }
}

function beginTtsJob(job) {
  if (!job || job.started || job.cancelled) return;
  job.started = true;
  job.completed = false;
  ensureTtsStatusElement(job);
  renderTtsStatus(job);
  scheduleMoreTtsFetches(job);
}

function completeTtsJob(job) {
  if (!job || job.completed) return;
  job.completed = true;
  removeQueuedFetchesForJob(job);
  for (const t of job.timers) clearTimeout(t);
  job.timers.length = 0;
  if (job.audio) {
    try { job.audio.pause(); } catch {}
  }
  job.audio = null;
  job.activeIndex = null;
  job.inflight = 0;
  job.nextFetchIndex = job.groups.length;
  if (currentTtsJob === job) {
    currentTtsJob = null;
  }
  activateNextTtsJob();
}

function startVoicePlaybackForMessage(message, voice) {
  const job = createTtsJob(message, voice);
  if (!job) return;
  ttsJobsByMessage.set(job.messageId, job);
  ensureTtsStatusElement(job);
  renderTtsStatus(job);
  ttsQueue.push(job);
  activateNextTtsJob();
}

function tryStartPlayback(job) {
  if (!job || job.cancelled || job.completed) return;
  if (currentTtsJob && currentTtsJob !== job) return;
  if (typeof job.activeIndex === 'number') {
    const activeStatus = job.status[job.activeIndex];
    if (activeStatus !== 'done' && activeStatus !== 'error') {
      const activeAudio = job.audio;
      if (activeAudio && !activeAudio.ended) {
        if (activeAudio.paused) {
          void playAudioWithUnlock(activeAudio);
        }
        return;
      }
      if (!activeAudio) {
        return;
      }
    } else {
      job.activeIndex = null;
    }
  }
  // If already playing, nothing to do; the 'ended' handler will pick next
  if (job.audio && !job.audio.ended && !job.audio.paused) return;
  while (job.playIndex < job.groups.length) {
    const index = job.playIndex;
    const result = job.results[index];
    if (typeof result === 'undefined') return; // not ready yet
    if (result === TTS_CHUNK_ERROR) {
      job.playIndex += 1;
      scheduleMoreTtsFetches(job);
      continue;
    }
    const url = result;
    if (!url) {
      job.playIndex += 1;
      scheduleMoreTtsFetches(job);
      continue;
    }
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.currentTime = 0;
    try { audio.load(); } catch {}
    try { audio.playsInline = true; } catch {}
    try { audio.crossOrigin = 'anonymous'; } catch {}
    job.audio = audio;
    job.activeIndex = index;
    let started = false;
    let watchdog = null;
    const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };

    let playbackPromise = null;
    const attemptPlayback = () => {
      if (job.cancelled || job.completed || currentTtsJob !== job) return;
      if (playbackPromise) return;
      playbackPromise = playAudioWithUnlock(audio).finally(() => {
        playbackPromise = null;
      });
    };
    audio.addEventListener('loadedmetadata', attemptPlayback, { once: true });
    audio.addEventListener('loadeddata', attemptPlayback, { once: true });
    audio.addEventListener('canplay', attemptPlayback, { once: true });
    audio.addEventListener('canplaythrough', attemptPlayback, { once: true });
    watchdog = setTimeout(attemptPlayback, 1500);
    // Also try an immediate kick-off in case events are delayed
    setTimeout(attemptPlayback, 0);

    audio.addEventListener('playing', () => {
      if (job.cancelled || job.completed || currentTtsJob !== job) return;
      if (!started) {
        started = true;
        setTtsChunkState(job, index, 'speaking');
        clearWatchdog();
      }
    });
    // Some browsers may not fire 'playing' reliably; detect progress via timeupdate
    const onTimeUpdate = () => {
      if (job.cancelled || job.completed || currentTtsJob !== job) return;
      if (!started && audio.currentTime > 0) {
        started = true;
        setTtsChunkState(job, index, 'speaking');
        clearWatchdog();
        audio.removeEventListener('timeupdate', onTimeUpdate);
      }
    };
    audio.addEventListener('timeupdate', onTimeUpdate);

    audio.addEventListener('stalled', () => {
      if (job.cancelled || job.completed || currentTtsJob !== job) return;
      void playAudioWithUnlock(audio);
    });

    const stallTimer = setTimeout(() => {
      if (!started && !job.cancelled && !job.completed && currentTtsJob === job) {
        // Give slower decoders more time; mark as error only after generous grace
        setTtsChunkState(job, index, 'error');
        job.playIndex += 1;
        tryStartPlayback(job);
      }
    }, 7000);

    audio.addEventListener('ended', () => {
      if (job.cancelled || job.completed || currentTtsJob !== job) return;
      clearTimeout(stallTimer);
      clearWatchdog();
      setTtsChunkState(job, index, 'done');
      job.activeIndex = null;
      job.audio = null;
      job.playIndex += 1;
      scheduleMoreTtsFetches(job);
      tryStartPlayback(job);
    });
    audio.addEventListener('error', () => {
      if (job.cancelled || job.completed || currentTtsJob !== job) return;
      setTtsChunkState(job, index, 'error');
      job.activeIndex = null;
      job.audio = null;
      job.playIndex += 1; // skip broken chunk
      scheduleMoreTtsFetches(job);
      tryStartPlayback(job);
    });
    return;
  }
  job.audio = null;
  completeTtsJob(job);
}

function renderTtsStatus(job) {
  if (!job || !job.statusEl) return;
  const el = job.statusEl;
  el.innerHTML = '';
  for (let i = 0; i < job.groups.length; i += 1) {
    const span = document.createElement('span');
    span.className = `tts-chunk ${job.status[i] || 'pending'}`;
    span.textContent = job.groups[i];
    el.appendChild(span);
  }
}

function setTtsChunkState(job, index, state) {
  if (!job) return;
  job.status[index] = state;
  if (!job.statusEl) return;
  const nodes = job.statusEl.querySelectorAll('.tts-chunk');
  const node = nodes[index];
  if (!node) return;
  node.className = `tts-chunk ${state}`;
}

function syncAllTtsStatusEls() {
  try {
    for (const job of ttsJobsByMessage.values()) {
      if (!job) continue;
      const el = ensureTtsStatusElement(job);
      if (el) {
        renderTtsStatus(job);
      }
    }
  } catch {}
}

function normalizeContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part?.text) return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content === 'object' && content.text) {
    return content.text;
  }
  return String(content);
}

async function sendPrompt(prompt) {
  const selectedModel = getSelectedModel();
  if (!selectedModel) {
    throw new Error('No model selected.');
  }
  if (!client) {
    throw new Error('Pollinations client is not ready.');
  }
  const endpoints = buildEndpointSequence(selectedModel);
  if (!endpoints.length) {
    throw new Error(`No endpoints available for model "${selectedModel.label ?? selectedModel.id}".`);
  }
  const startingLength = state.conversation.length;
  if (state.conversation.length === 0) {
    // Always inject formatting note on first turn to steer models into JSON
    state.conversation.push({ role: 'user', content: buildFirstTurnUserMessage(prompt) });
    state.imagePrimerSent = true;
  } else {
    // If the primer was not sent yet (e.g., preloaded convo), inject once
    if (!state.imagePrimerSent) {
      state.conversation.push({ role: 'user', content: buildFirstTurnUserMessage(prompt) });
      state.imagePrimerSent = true;
    } else {
      state.conversation.push({ role: 'user', content: prompt });
    }
  }
  try {
    setStatus('Waiting for the model…');
    const pinnedId = state.pinnedModelId || selectedModel.id;
    const { response, endpoint } = await requestChatCompletion({ ...selectedModel, id: pinnedId }, endpoints);
    state.activeModel = { id: pinnedId, endpoint, info: selectedModel };
    if (!state.pinnedModelId) {
      state.pinnedModelId = pinnedId;
    }
    await handleChatResponse(response, selectedModel, endpoint);
    resetStatusIfIdle();
  } catch (error) {
    console.error('Chat error', error);
    state.conversation.length = startingLength;
    throw error;
  }
}

async function handleChatResponse(initialResponse, model, endpoint) {
  let response = initialResponse;
  while (true) {
    const responseMeta = response?.metadata && typeof response.metadata === 'object' ? response.metadata : {};
    const attemptedJson = !!responseMeta.response_format_requested;
    const jsonFallbackUsed = !!responseMeta.jsonFallbackUsed;
    const choice = response?.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new Error('No response returned from model.');
    }

    const assistantRecord = { role: 'assistant' };
    if (message.content != null) assistantRecord.content = message.content;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
      assistantRecord.tool_calls = message.tool_calls.map(call => ({
        id: call.id,
        type: call.type,
        function: call.function ? { ...call.function } : undefined,
      }));
    }
    state.conversation.push(assistantRecord);

    if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
      await handleToolCalls(message.tool_calls);
      response = await chat(
        {
          model: model.id,
          endpoint,
          messages: state.conversation,
          ...(shouldIncludeTools(model, endpoint) ? { tools: [IMAGE_TOOL], tool_choice: 'auto' } : {}),
          response_format: { type: 'json_object' },
          seed: generateSeed(),
        },
        client,
      );
      if (response?.model && !isMatchingModelName(response.model, model)) {
        const aliasMatch = doesResponseMatchModel(response, model);
        console.warn(
          aliasMatch
            ? 'Model mismatch detected after tool call. Expected %s, received %s. Proceeding based on alias metadata.'
            : 'Model mismatch detected after tool call. Expected %s, received %s.',
          model.id,
          response?.model,
        );
      }
      continue;
    }

    const textContent = normalizeContent(message.content);
    if (textContent) {
      // Track images before/after to know if we need a deeper fallback
      const imagesBefore = state.messages.filter(m => m?.type === 'image').length;

      let json = safeJsonParse(textContent);
      if (!json) json = looseJsonParse(textContent);
      let looksRenderableJson = false;
      if (json && typeof json === 'object') {
        const coerced = coerceJsonPayload(json);
        looksRenderableJson = !!(
          (coerced.text && coerced.text.trim().length) ||
          (Array.isArray(coerced.code) && coerced.code.length) ||
          (Array.isArray(coerced.images) && coerced.images.length)
        );
      }
      if (looksRenderableJson) {
        await renderFromJsonPayload(json);
      } else {
        // Attempt repair: merge multiple JSON objects and capture stray prose
        try {
          const repaired = repairModelOutput(textContent, { coerce: coerceJsonPayload });
          const hasRenderable = !!(
            repaired && typeof repaired === 'object' && (
              (repaired.text && repaired.text.trim().length) ||
              (Array.isArray(repaired.code) && repaired.code.length) ||
              (Array.isArray(repaired.images) && repaired.images.length)
            )
          );
          if (hasRenderable) {
            await renderFromJsonPayload(repaired);
            break;
          }
        } catch (e) {
          console.warn('Repair parse failed; using text fallback', e);
        }

        // Secondary salvage: retry once without JSON response_format for long-form text
        if (attemptedJson && !jsonFallbackUsed) {
          try {
            const salvageMessages = state.conversation.slice(0, -1); // drop the empty assistant turn
            const retryResp = await chat({ model: model.id, endpoint, messages: salvageMessages, seed: generateSeed() }, client);
            const retryMsg = retryResp?.choices?.[0]?.message;
            const retryContent = normalizeContent(retryMsg?.content);
            if (retryContent && retryContent.trim()) {
              let retryJson = safeJsonParse(retryContent) || looseJsonParse(retryContent);
              if (retryJson && typeof retryJson === 'object') {
                try {
                  await renderFromJsonPayload(retryJson);
                } catch {
                  addMessage({ role: 'assistant', type: 'text', content: retryContent });
                }
              } else {
                addMessage({ role: 'assistant', type: 'text', content: retryContent });
              }
              try { state.conversation[state.conversation.length - 1].content = retryMsg?.content ?? retryContent; } catch {}
              break;
            }
          } catch (e) {
            console.warn('Salvage retry without JSON mode failed', e);
          }
        }
        // Extract any polli-image directives and render images (legacy fallback)
        const { cleaned, directives } = extractPolliImagesFromText(textContent);
        if (cleaned && cleaned.trim().length) {
          const assistantMessage = addMessage({
            role: 'assistant',
            type: 'text',
            content: cleaned,
          });
          if (state.voicePlayback && els.voiceSelect.value) {
            void speakMessage(assistantMessage, { autoplay: true });
          }
        }
        if (Array.isArray(directives) && directives.length) {
          for (const d of directives) {
            try {
              const { width, height } = resolveDimensions(d);
              const caption = String(d.caption ?? d.prompt).trim() || d.prompt;
              const { dataUrl, seed } = await generateImageAsset(d.prompt, {
                width,
                height,
                model: d.model,
                seed: d.seed,
              });
              addMessage({
                role: 'assistant',
                type: 'image',
                url: dataUrl,
                alt: caption,
                caption,
              });
              console.info('Rendered image from polli-image block (seed %s).', seed);
            } catch (err) {
              console.warn('Failed to render polli-image block:', err);
              addMessage({ role: 'assistant', type: 'error', content: String(err?.message ?? err) });
            }
          }
        }

        // If no images were produced yet, look for bare JSON objects in text
        const imagesAfter = state.messages.filter(m => m?.type === 'image').length;
        if (imagesAfter === imagesBefore) {
          const payloads = extractImagePayloadsFromAnyText(textContent);
          for (const obj of payloads) {
            try {
              await renderFromJsonPayload(obj);
            } catch (err) {
              console.warn('Failed to render image from loose JSON payload:', err);
            }
          }
          // As a last resort, if nothing was renderable but we do have a JSON object,
          // show it back to the user pretty-printed so they see the content.
          const postImages = state.messages.filter(m => m?.type === 'image').length;
          if (postImages === imagesBefore && json && typeof json === 'object') {
            try {
              const pretty = JSON.stringify(json, null, 2);
              addMessage({ role: 'assistant', type: 'text', content: '```json\n' + pretty + '\n```' });
            } catch {}
          }
        }
      }
    }
    break;
  }
}

// Normalize arbitrary JSON payloads from models to our app schema
function coerceJsonPayload(obj) {
  const result = { text: null, code: [], images: [] };
  if (!obj || typeof obj !== 'object') return result;

  // Text fields
  const textKeys = ['text', 'answer', 'response', 'content', 'message', 'explanation', 'summary'];
  for (const k of textKeys) {
    if (typeof obj[k] === 'string' && obj[k].trim()) { result.text = obj[k]; break; }
  }

  // Code fields
  const addCodeBlock = (block) => {
    if (!block) return;
    if (typeof block === 'string') { result.code.push({ language: '', content: block }); return; }
    if (typeof block === 'object') {
      const language = typeof block.language === 'string' ? block.language : (typeof block.lang === 'string' ? block.lang : '');
      const content = typeof block.content === 'string' ? block.content : (typeof block.code === 'string' ? block.code : '');
      if (content) { result.code.push({ language, content }); }
    }
  };
  if (Array.isArray(obj.code)) obj.code.forEach(addCodeBlock);
  else if (typeof obj.code === 'string') addCodeBlock(obj.code);
  if (Array.isArray(obj.blocks)) {
    for (const b of obj.blocks) {
      if (b && (b.type === 'code' || b.language || b.lang || typeof b.code === 'string' || typeof b.content === 'string')) addCodeBlock(b);
    }
  }
  if (typeof obj.snippet === 'string') addCodeBlock(obj.snippet);
  if (typeof obj.program === 'string') addCodeBlock(obj.program);
  if (typeof obj.script === 'string') addCodeBlock(obj.script);

  // Images fields
  if (Array.isArray(obj.images)) {
    for (const im of obj.images) {
      if (im && typeof im.prompt === 'string' && im.prompt.trim()) result.images.push(im);
    }
  } else if (obj.image && typeof obj.image === 'object' && typeof obj.image.prompt === 'string') {
    result.images.push({ ...obj.image });
  }

  return result;
}

async function handleToolCalls(toolCalls) {
  for (const call of toolCalls) {
    if (!call || call.type !== 'function' || call.function?.name !== 'generate_image') {
      state.conversation.push({
        role: 'tool',
        tool_call_id: call?.id ?? 'unknown',
        name: call?.function?.name ?? 'unknown',
        content: JSON.stringify({ status: 'error', message: 'Unsupported tool call' }),
      });
      continue;
    }
    const args = parseToolArguments(call.function.arguments);
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) {
      const error = new Error('Image tool call missing prompt.');
      state.conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify({ status: 'error', message: error.message }),
      });
      throw error;
    }

    const { width, height } = resolveDimensions(args);
    const caption = String(args.caption ?? prompt).trim() || prompt;

    try {
      const { dataUrl, seed } = await generateImageAsset(prompt, {
        width,
        height,
        model: args.model,
      });
      addMessage({
        role: 'assistant',
        type: 'image',
        url: dataUrl,
        alt: caption,
        caption,
      });
      state.conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify({
          status: 'success',
          prompt,
          width,
          height,
          seed,
        }),
      });
    } catch (error) {
      const message = error?.message ?? String(error);
      addMessage({ role: 'assistant', type: 'error', content: message });
      setStatus(`Image generation failed: ${message}`, { error: true });
      state.conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify({ status: 'error', message }),
      });
      const toolError = error instanceof Error ? error : new Error(message);
      toolError.handled = true;
      throw toolError;
    }
  }
}

async function generateImageAsset(prompt, { width, height, model: imageModel, seed } = {}) {
  setStatus('Generating image…');
  try {
    if (!client) {
      throw new Error('Pollinations client is not ready.');
    }
    const resolvedSeed = (typeof seed === 'number' || (typeof seed === 'string' && seed.trim().length)) ? seed : generateSeed();
    const dims = [];
    const w = Number(width) || 768;
    const h = Number(height) || 768;
    dims.push([w, h]);
    if (w > 512 || h > 512) dims.push([512, 512]);

    const fallbackModels = ['flux', 'turbo', 'kontext'];
    const tried = new Set();

    let lastError = null;
    for (const [dw, dh] of dims) {
      const modelSequence = [];
      if (imageModel) modelSequence.push(String(imageModel));
      for (const m of fallbackModels) if (!modelSequence.includes(m)) modelSequence.push(m);
      for (const modelName of modelSequence) {
        const key = `${modelName}:${dw}x${dh}`;
        if (tried.has(key)) continue;
        tried.add(key);
        try {
          const binary = await image(
            prompt,
            { width: dw, height: dh, model: modelName, nologo: true, seed: resolvedSeed },
            client,
          );
          const dataUrl = binary.toDataUrl();
          resetStatusIfIdle();
          return { dataUrl, seed: resolvedSeed };
        } catch (error) {
          lastError = error;
          const msg = String(error?.message || error);
          if (/HTTP\s+429/i.test(msg)) {
            await sleep(750);
          }
        }
      }
    }
    throw lastError || new Error('Image generation failed');
  } catch (error) {
    console.error('Image generation failed', error);
    throw error;
  }
}

function parseToolArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Unable to parse tool arguments', raw, error);
    return {};
  }
}

function resolveDimensions(args = {}) {
  const clamp = value => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(256, Math.min(2048, Math.round(num)));
  };

  let width = clamp(args.width);
  let height = clamp(args.height);

  if ((!width || !height) && typeof args.size === 'string') {
    const parts = args.size.split(/x|×/i).map(part => clamp(part));
    if (parts.length === 2) {
      width = width ?? parts[0];
      height = height ?? parts[1];
    }
  }

  if ((!width || !height) && typeof args.aspect_ratio === 'string') {
    const ratio = args.aspect_ratio.split(':').map(Number);
    if (ratio.length === 2 && ratio.every(n => Number.isFinite(n) && n > 0)) {
      const base = width ?? 1024;
      width = clamp(base) ?? 1024;
      height = clamp((width * ratio[1]) / ratio[0]);
    }
  }

  width = width ?? 1024;
  height = height ?? width;
  return { width, height };
}

function populateModels(models) {
  els.modelSelect.innerHTML = '';
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.description ? `${model.label} — ${model.description}` : model.label;
    option.dataset.modelId = model.id;
    els.modelSelect.appendChild(option);
  }
  els.modelSelect.disabled = false;
  const preferred = models.find(model => matchesModelIdentifier('openai', model)) ?? models[0];
  if (preferred) {
    els.modelSelect.value = preferred.id;
  }
}

function populateVoices(voices) {
  els.voiceSelect.innerHTML = '';
  if (!voices.length) {
    els.voiceSelect.disabled = true;
    els.voicePlayback.checked = false;
    if (els.voicePlayback) {
      els.voicePlayback.disabled = true;
    }
    state.voicePlayback = false;
    return;
  }
  els.voiceSelect.disabled = false;
  if (els.voicePlayback) {
    els.voicePlayback.disabled = false;
  }
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice;
    option.textContent = voice;
    els.voiceSelect.appendChild(option);
  }
  if (voices.includes('nova')) {
    els.voiceSelect.value = 'nova';
  } else {
    els.voiceSelect.value = voices[0];
  }
}

async function loadModels() {
  setStatus('Loading models…');
  try {
    const catalog = await textModels(client);
    const models = normalizeTextCatalog(catalog);
    if (!Array.isArray(models) || !models.length) {
      throw new Error('Received an empty model list');
    }
    state.models = models.sort((a, b) => a.label.localeCompare(b.label));
    populateModels(state.models);
    const voiceModel = state.models.find(model => Array.isArray(model.voices) && model.voices.length > 0);
    populateVoices(voiceModel?.voices ?? FALLBACK_VOICES);
    resetConversation({ clearMessages: true });
    setStatus(DEFAULT_STATUS);
  } catch (error) {
    console.warn('Failed to load models, falling back to defaults', error);
    state.models = FALLBACK_MODELS.map(model => ({
      ...model,
      endpoints: Array.isArray(model.endpoints) ? [...model.endpoints] : ['openai'],
      identifiers: model.identifiers ? new Set(model.identifiers) : new Set(),
      hints: model.hints ? new Set(model.hints) : new Set(),
    }));
    populateModels(state.models);
    populateVoices(FALLBACK_VOICES);
    resetConversation({ clearMessages: true });
    setStatus('Using fallback models. Some features may be limited.', { error: true });
  }
}

function getSelectedModel() {
  if (!state.models.length) return null;
  const rawValue = els.modelSelect.value;
  if (!rawValue) return state.models[0];
  const normalized = String(rawValue).trim().toLowerCase();
  for (const model of state.models) {
    if (model?.identifiers?.has?.(normalized)) {
      return model;
    }
  }
  return state.models[0];
}

function buildEndpointSequence(model) {
  if (!model) return [];
  const result = [];
  const seen = new Set();
  const add = endpoint => {
    if (!endpoint && endpoint !== 0) return;
    const normalized = String(endpoint).trim().toLowerCase();
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  };

  if (Array.isArray(model.endpoints)) {
    model.endpoints.forEach(add);
  }

  const provider = String(model?.provider ?? '').toLowerCase();
  const tier = String(model?.tier ?? '').toLowerCase();
  const hintValues = Array.from(new Set([...(model?.hints ?? []), ...(model?.identifiers ?? [])]));

  const indicatesSeed =
    hintValues.some(value =>
      ['seed', 'pollinations', 'unity', 'flux', 'kontext', 'chatdolphin', 'hunyuan', 'kling', 'blackforest'].some(marker =>
        value.includes(marker),
      ),
    ) || provider.includes('pollinations') || provider.includes('seed') || tier.includes('seed');

  const indicatesOpenAi =
    hintValues.some(value =>
      [
        'openai',
        'gpt',
        'claude',
        'anthropic',
        'mistral',
        'llama',
        'deepseek',
        'grok',
        'sonnet',
        'opus',
      ].some(marker => value.includes(marker)),
    ) || provider.includes('openai');

  if (indicatesSeed) add('seed');
  if (indicatesOpenAi || !result.length) add('openai');
  if (indicatesSeed && !seen.has('openai')) add('openai');

  return result;
}


function shouldIncludeTools(_model, _endpoint) {
  // Apply the same behavior to all models as for unity: do not attach tools.
  // Image generation remains available via the explicit "/image" command path.
  return false;
}

async function requestChatCompletion(model, endpoints) {
  if (!model) {
    throw new Error('No model selected.');
  }
  if (!Array.isArray(endpoints) || !endpoints.length) {
    throw new Error(`No endpoints available for model "${model.label ?? model.id}".`);
  }

  const attemptErrors = [];
  for (const endpoint of endpoints) {
    let retried429 = false;
    let retriedNetwork = false;
    for (;;) {
      try {
        const response = await chat(
          {
            model: model.id,
            endpoint,
            messages: state.conversation,
            ...(shouldIncludeTools(model, endpoint) ? { tools: [IMAGE_TOOL], tool_choice: 'auto' } : {}),
            response_format: { type: 'json_object' },
            seed: generateSeed(),
          },
          client,
        );
        if (!response?.model) {
          return { response, endpoint };
        }
        if (isMatchingModelName(response.model, model)) {
          return { response, endpoint };
        }
        if (doesResponseMatchModel(response, model)) {
          console.warn(
            'Model mismatch detected. Expected %s, received %s. Proceeding based on alias metadata.',
            model.id,
            response.model,
          );
          return { response, endpoint };
        }
        attemptErrors.push(
          new Error(
            `Endpoint "${endpoint}" responded with "${response?.model ?? 'unknown'}" instead of "${model.id}".`,
          ),
        );
        break;
      } catch (error) {
        const message = error?.message ?? String(error);
        attemptErrors.push(error instanceof Error ? error : new Error(String(error)));
        if (!retried429 && /HTTP\s+429/i.test(message)) {
          retried429 = true;
          await sleep(750);
          continue;
        }
        // Retry once on transient network/abort errors which surface during long generations
        if (!retriedNetwork && /(NetworkError|Failed to fetch|AbortError|aborted|network error|The user aborted a request)/i.test(message)) {
          retriedNetwork = true;
          await sleep(700);
          continue;
        }
        break;
      }
    }
  }

  if (attemptErrors.length) {
    const summary = attemptErrors
      .map(err => err?.message ?? String(err))
      .filter(Boolean)
      .join('; ');
    const aggregated = new Error(
      summary.length
        ? `Unable to reach model "${model.id}". Attempts: ${summary}`
        : `Unable to reach model "${model.id}".`,
    );
    aggregated.attempts = attemptErrors;
    throw aggregated;
  }

  throw new Error(`Unable to reach model "${model.id}".`);
}

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    els.voiceButton.disabled = true;
    els.voiceButton.textContent = 'Voice unsupported';
    els.voiceButton.title = 'This browser does not support the Web Speech API.';
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || 'en-US';

  recognition.onstart = () => {
    recognizing = true;
    els.voiceButton.classList.add('active');
    els.voiceButton.setAttribute('aria-pressed', 'true');
    setStatus('Listening…');
    recognitionBaseText = els.input.value.trim();
    recognitionFinalText = '';
  };

  recognition.onerror = event => {
    console.error('Speech recognition error', event.error);
    setStatus(`Voice input error: ${event.error}`, { error: true });
  };

  recognition.onend = () => {
    recognizing = false;
    els.voiceButton.classList.remove('active');
    els.voiceButton.setAttribute('aria-pressed', 'false');
    clearTimeout(recognitionSilenceTimer);
    recognitionSilenceTimer = null;
    els.input.disabled = state.loading;
    resetStatusIfIdle();
  };

  recognition.onresult = event => {
    clearTimeout(recognitionSilenceTimer);
    let interim = '';
    let finalAddition = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) {
        finalAddition += `${result[0].transcript} `;
      } else {
        interim += result[0].transcript;
      }
    }
    if (finalAddition) {
      recognitionFinalText += finalAddition;
    }
    const combined = `${recognitionBaseText} ${recognitionFinalText}${interim}`
      .replace(/\s+/g, ' ')
      .trim();
    els.input.value = combined;
    els.input.focus();

    recognitionSilenceTimer = setTimeout(() => {
      stopRecognition();
    }, 500);
  };
}

function startRecognition() {
  if (!recognition) return;
  if (recognizing) {
    stopRecognition();
    return;
  }
  try {
    recognition.start();
  } catch (error) {
    console.error('Unable to start recognition', error);
    setStatus(`Cannot start voice input: ${error?.message ?? error}`, { error: true });
  }
}

function stopRecognition() {
  if (!recognition || !recognizing) return;
  try {
    recognition.stop();
  } catch (error) {
    console.error('Unable to stop recognition', error);
  }
}

async function initializeApp() {
  setStatus('Configuring Pollinations client…');
  setLoading(true);
  els.modelSelect.disabled = true;
  els.voiceSelect.disabled = true;
  if (els.voicePlayback) {
    els.voicePlayback.disabled = true;
    els.voicePlayback.checked = false;
  }

  let tokenSource = null;
  let tokenMessages = [];

  try {
    const {
      client: polliClient,
      tokenSource: resolvedTokenSource,
      tokenMessages: resolvedTokenMessages,
      referrer,
    } = await createPollinationsClient();
    client = polliClient;
    tokenSource = resolvedTokenSource;
    tokenMessages = Array.isArray(resolvedTokenMessages) ? resolvedTokenMessages : [];
    // Using referrer-only access; no token required.
    console.info('Pollinations client configured (referrer: %s).', referrer || 'unknown');
  } catch (error) {
    console.error('Failed to configure Pollinations client', error);
    setLoading(false);
    disableApplicationControls();
    const message = error?.message ?? 'Unable to configure Pollinations client.';
    setStatus(message, { error: true });
    return;
  }

  try {
    await loadModels();
  } finally {
    setLoading(false);
  }

  if (!state.statusError) {
    setStatus(`Ready. Using referrer-based access${typeof referrer === 'string' && referrer ? ' (' + referrer + ')' : ''}.`);
  }

  try {
    setupRecognition();
  } catch (error) {
    console.error('Failed to configure voice recognition', error);
  }
}

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  const raw = els.input.value.trim();
  if (!raw) return;

  if (recognizing) {
    stopRecognition();
  }

  addMessage({ role: 'user', type: 'text', content: raw });
  els.input.value = '';
  els.input.focus();
  setLoading(true);

  try {
    if (raw.toLowerCase().startsWith('/image')) {
      const prompt = raw.slice('/image'.length).trim();
      if (!prompt) {
        throw new Error('Provide a prompt after /image');
      }
      const { dataUrl, seed } = await generateImageAsset(prompt);
      addMessage({
        role: 'assistant',
        type: 'image',
        url: dataUrl,
        alt: prompt,
        caption: prompt,
      });
      console.info('Generated Pollinations image with seed %s.', seed);
      resetStatusIfIdle();
    } else {
      // Stream for non-image prompts to speed up perceived latency
      const wantsImage = hasImageIntent(raw);
      if (!wantsImage) {
        await sendPromptStreaming(raw);
      } else {
        await sendPrompt(raw);
      }
    }
  } catch (error) {
    console.error('Submission error', error);
    const message = error?.message ?? String(error);
    if (!error?.handled) {
      setStatus(message, { error: true });
      addMessage({ role: 'assistant', type: 'error', content: message });
    }
    if (state.conversation.length && state.conversation[state.conversation.length - 1].role === 'user') {
      state.conversation.pop();
    }
  } finally {
    setLoading(false);
  }
});

els.modelSelect.addEventListener('change', () => {
  resetConversation({ clearMessages: true });
  state.pinnedModelId = null;
  const modelName = els.modelSelect.value;
  setStatus(`Switched to ${modelName}.`);
  playbackStatusTimer = window.setTimeout(() => {
    resetStatusIfIdle();
  }, 1500);
});

els.voiceSelect.addEventListener('change', () => {
  renderMessages();
  if (state.voicePlayback && !els.voiceSelect.value) {
    setStatus('Select a voice to enable playback.', { error: true });
  }
});

els.voiceButton.addEventListener('click', () => {
  startRecognition();
});

els.voicePlayback.addEventListener('change', () => {
  if (!els.voicePlayback.checked) {
    state.voicePlayback = false;
    cancelAllTtsJobs();
    setStatus('Voice playback muted.');
    playbackStatusTimer = window.setTimeout(() => {
      resetStatusIfIdle();
    }, 1500);
    return;
  }

  if (!els.voiceSelect.value) {
    els.voicePlayback.checked = false;
    state.voicePlayback = false;
    setStatus('Select a voice to enable playback.', { error: true });
    return;
  }

  state.voicePlayback = true;
  void unlockAudioPlayback();
  setStatus(`Voice playback enabled (${els.voiceSelect.value}).`);
  playbackStatusTimer = window.setTimeout(() => {
    resetStatusIfIdle();
  }, 1500);
});

initializeApp().catch(error => {
  console.error('Failed to initialise application', error);
  disableApplicationControls();
  const message = error?.message ?? 'Unable to initialise application.';
  setStatus(message, { error: true });
});

window.addEventListener('beforeunload', () => {
  if (recognizing) {
    stopRecognition();
  }
  for (const url of trackedAudioUrls) {
    URL.revokeObjectURL(url);
  }
  trackedAudioUrls.clear();
});
