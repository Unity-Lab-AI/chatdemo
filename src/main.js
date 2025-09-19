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
  state.conversation.push({ role: 'user', content: prompt });
  try {
    setStatus('Waiting for the model…');
    const { response, endpoint } = await requestChatCompletion(selectedModel, endpoints);
    state.activeModel = { id: selectedModel.id, endpoint, info: selectedModel };
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
          tools: [IMAGE_TOOL],
          tool_choice: 'auto',
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
      const assistantMessage = addMessage({
        role: 'assistant',
        type: 'text',
        content: textContent,
      });
      if (state.voicePlayback && els.voiceSelect.value) {
        void speakMessage(assistantMessage, { autoplay: true });
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

async function generateImageAsset(prompt, { width, height, model: imageModel } = {}) {
  setStatus('Generating image…');
  try {
    if (!client) {
      throw new Error('Pollinations client is not ready.');
    }
    const seed = generateSeed();
    const binary = await image(
      prompt,
      {
        width,
        height,
        model: imageModel,
        nologo: true,
        seed,
      },
      client,
    );
    const dataUrl = binary.toDataUrl();
    resetStatusIfIdle();
    return { dataUrl, seed };
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


async function requestChatCompletion(model, endpoints) {
  if (!model) {
    throw new Error('No model selected.');
  }
  if (!Array.isArray(endpoints) || !endpoints.length) {
    throw new Error(`No endpoints available for model "${model.label ?? model.id}".`);
  }

  const attemptErrors = [];
  for (const endpoint of endpoints) {
    try {
      const response = await chat(
        {
          model: model.id,
          endpoint,
          messages: state.conversation,
          tools: [IMAGE_TOOL],
          tool_choice: 'auto',
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
    } = await createPollinationsClient();
    client = polliClient;
    tokenSource = resolvedTokenSource;
    tokenMessages = Array.isArray(resolvedTokenMessages) ? resolvedTokenMessages : [];
    if (tokenSource) {
      console.info('Pollinations token loaded via %s.', tokenSource);
    } else if (tokenMessages.length) {
      console.warn(
        'Proceeding without a Pollinations token. Attempts: %s',
        tokenMessages.join('; '),
      );
    } else {
      console.info('Proceeding without a Pollinations token.');
    }
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

  if (!tokenSource && !state.statusError) {
    setStatus('Ready. Pollinations token not configured; only public models are available.');
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
