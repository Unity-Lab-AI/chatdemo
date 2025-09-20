import './style.css';
import { chat, image, textModels } from '../Libs/pollilib/index.js';
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

const FALLBACK_VOICES = [];
const DEFAULT_STATUS = 'Ready.';
const INJECTED_USER_PRIMER = `Formatting directive (output structure only):

- Do not generate any image unless the user explicitly asks for an image.
- Prefer returning a single JSON object with these optional keys when applicable:
  {
    "text": string,                     // assistant's prose (optional)
    "code": [                           // zero or more code blocks (optional)
      { "language": string, "content": string }
    ],
    "images": [                         // zero or more images to render (optional; only if user asked)
      { "prompt": string, "width": int?, "height": int?, "size": string?, "aspect_ratio": string?, "model": string?, "caption": string?, "seed": number? }
    ]
  }
- If you cannot or prefer not to return JSON, reply normally as text.
- This note only affects formatting; it must not change your tone, policy, or behavior.`;

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

const app = document.querySelector('#app');
const DEBUG = (() => {
  try {
    const u = new URL(location.href);
    return u.searchParams.get('debug') === '1' || /(?:^|[#&?])debug(?:=1)?(?:&|$)/.test(location.href);
  } catch { return false; }
})();
const FORCE_JSON = (() => {
  try {
    const u = new URL(location.href);
    return u.searchParams.get('json') === '1' || u.searchParams.get('structured') === '1';
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
  const jsonMode = !!FORCE_JSON;
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
    const wantsJson = FORCE_JSON || false;
    const payload = { model: model.id, endpoint: 'openai', messages, ...(wantsJson ? { response_format: { type: 'json_object' } } : {}) };
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

async function renderFromJsonPayload(payload) {
  try {
    if (payload == null || typeof payload !== 'object') return;
    const text = typeof payload.text === 'string' ? payload.text : null;
    const code = Array.isArray(payload.code) ? payload.code : [];
    const images = Array.isArray(payload.images) ? payload.images : [];

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
  const accepted = new Set(['polli-image', 'pollinations.image', 'image']);
  const kept = [];
  for (const t of tokens) {
    if (t.type === 'code' && accepted.has(t.lang)) {
      const raw = t.content.trim();
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && typeof obj.prompt === 'string' && obj.prompt.trim().length) {
          directives.push(obj);
          continue; // omit from kept
        }
      } catch (e) {
        console.warn('Invalid polli-image payload (ignored):', e);
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
}

function renderMessages() {
  const container = els.messages;
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const message of state.messages) {
    const article = document.createElement('article');
    article.className = `message ${message.role}${message.type === 'error' ? ' error' : ''}`;

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

    fragment.appendChild(article);
  }
  container.appendChild(fragment);
  container.scrollTop = container.scrollHeight;
}

function renderTextInto(container, text) {
  const lines = String(text).split(/\n+/);
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  for (const line of lines) {
    const paragraph = document.createElement('p');
    let hasText = false;
    const parts = line.split(urlPattern);
    for (const part of parts) {
      if (!part) continue;
      if (/^https?:\/\//.test(part)) {
        const trimmed = part.replace(/[),.;!?]+$/u, '');
        const trailing = part.slice(trimmed.length);
        if (/\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?.*)?$/i.test(trimmed)) {
          const wrapper = document.createElement('div');
          wrapper.className = 'message-image';
          const img = document.createElement('img');
          img.src = trimmed;
          img.alt = 'Image from response';
          img.loading = 'lazy';
          wrapper.appendChild(img);
          container.appendChild(wrapper);
        } else {
          hasText = true;
          const link = document.createElement('a');
          link.href = trimmed;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = trimmed;
          paragraph.appendChild(link);
        }
        if (trailing) {
          hasText = true;
          paragraph.appendChild(document.createTextNode(trailing));
        }
      } else {
        hasText = true;
        paragraph.appendChild(document.createTextNode(part));
      }
    }
    if (hasText) {
      container.appendChild(paragraph);
    }
  }
}

async function speakMessage(_message, _opts = {}) {
  // TTS is not available in the current JS PolliLib; voice playback disabled.
  return;
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
    // First turn: only inject formatting note when the user clearly asked for an image
    if (hasImageIntent(prompt)) {
      state.conversation.push({ role: 'user', content: buildFirstTurnUserMessage(prompt) });
    } else {
      state.conversation.push({ role: 'user', content: prompt });
    }
  } else {
    state.conversation.push({ role: 'user', content: prompt });
  }
  try {
    setStatus('Waiting for the model…');
    const pinnedId = state.pinnedModelId || selectedModel.id;
    const { response, endpoint } = await requestChatCompletion({ ...selectedModel, id: pinnedId }, endpoints, { wantsJson: FORCE_JSON || hasImageIntent(prompt) });
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
      const json = safeJsonParse(textContent);
      const looksRenderableJson = json && typeof json === 'object' && (
        (typeof json.text === 'string' && json.text.trim().length) ||
        (Array.isArray(json.code) && json.code.length) ||
        (Array.isArray(json.images) && json.images.length)
      );
      if (looksRenderableJson) {
        await renderFromJsonPayload(json);
      } else {
        // Extract any polli-image directives and render images (legacy fallback)
        const { cleaned, directives } = extractPolliImagesFromText(textContent);
        const assistantMessage = addMessage({
          role: 'assistant',
          type: 'text',
          content: cleaned || textContent,
        });
        if (state.voicePlayback && els.voiceSelect.value) {
          void speakMessage(assistantMessage, { autoplay: true });
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
      }
    }
    break;
  }
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
    const binary = await image(
      prompt,
      {
        width,
        height,
        model: imageModel,
        nologo: true,
        seed: resolvedSeed,
      },
      client,
    );
    const dataUrl = binary.toDataUrl();
    resetStatusIfIdle();
    return { dataUrl, seed: resolvedSeed };
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

async function requestChatCompletion(model, endpoints, opts = {}) {
  if (!model) {
    throw new Error('No model selected.');
  }
  if (!Array.isArray(endpoints) || !endpoints.length) {
    throw new Error(`No endpoints available for model "${model.label ?? model.id}".`);
  }

  const attemptErrors = [];
  for (const endpoint of endpoints) {
    try {
      let includeJson = !!opts.wantsJson;
      let response;
      try {
        response = await chat(
          {
            model: model.id,
            endpoint,
            messages: state.conversation,
            ...(includeJson ? { response_format: { type: 'json_object' } } : {}),
            ...(shouldIncludeTools(model, endpoint) ? { tools: [IMAGE_TOOL], tool_choice: 'auto' } : {}),
          },
          client,
        );
      } catch (err) {
        if (includeJson) {
          // Retry without JSON mode if the endpoint/model rejects it
          includeJson = false;
          response = await chat(
            {
              model: model.id,
              endpoint,
              messages: state.conversation,
              ...(shouldIncludeTools(model, endpoint) ? { tools: [IMAGE_TOOL], tool_choice: 'auto' } : {}),
            },
            client,
          );
        } else {
          throw err;
        }
      }
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
    } catch (error) {
      attemptErrors.push(error instanceof Error ? error : new Error(String(error)));
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
      await sendPrompt(raw);
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
