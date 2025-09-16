import './style.css';
import {
  PolliClient,
  chat,
  image,
  textModels,
  tts,
} from '../Libs/pollilib/index.js';

const FALLBACK_MODELS = [
  { name: 'openai', description: 'OpenAI GPT-5 Nano (fallback)' },
  { name: 'mistral', description: 'Mistral Small (fallback)' },
];

const FALLBACK_VOICES = ['nova', 'ash', 'alloy', 'echo', 'fable'];
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

const SYSTEM_PROMPT = `
You are a helpful assistant for Pollinations chats that can see the full conversation.
When a user asks for an illustration—or when a visual would help—call the
"generate_image" tool with a vivid prompt and any desired dimensions. After the tool
runs, briefly describe what you created. Otherwise, reply conversationally.
Keep responses concise, friendly, and helpful.
`;

const client = new PolliClient();

function createSystemMessage() {
  return { role: 'system', content: SYSTEM_PROMPT };
}

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

const state = {
  conversation: [createSystemMessage()],
  messages: [],
  loading: false,
  models: [],
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

function addMessage(message) {
  const enriched = { ...message, id: ++messageIdCounter };
  state.messages.push(enriched);
  renderMessages();
  return enriched;
}

function resetConversation({ clearMessages = false } = {}) {
  state.conversation = [createSystemMessage()];
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

async function speakMessage(message, { autoplay = false } = {}) {
  if (!message?.content || !state.voicePlayback || !els.voiceSelect.value) {
    return;
  }
  if (message.audioUrl) {
    if (autoplay) {
      void playMessageAudio(message);
    }
    return;
  }
  message.audioPending = true;
  message.audioError = null;
  renderMessages();
  try {
    const voice = els.voiceSelect.value;
    const audioData = await tts(message.content, { voice, model: 'openai-audio' }, client);
    const blob = audioData.blob();
    const url = URL.createObjectURL(blob);
    trackedAudioUrls.add(url);
    message.audioUrl = url;
    message.audioVoice = voice;
    message.audioPending = false;
    renderMessages();
    if (autoplay) {
      void playMessageAudio(message);
    }
  } catch (error) {
    console.error('TTS failed', error);
    message.audioPending = false;
    message.audioError = error?.message ?? String(error);
    renderMessages();
    setStatus(`Text-to-speech failed: ${message.audioError}`, { error: true });
  }
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
  const model = els.modelSelect.value || state.models[0]?.name;
  if (!model) {
    throw new Error('No model selected.');
  }
  const startingLength = state.conversation.length;
  state.conversation.push({ role: 'user', content: prompt });
  try {
    setStatus('Waiting for the model…');
    const response = await chat(
      {
        model,
        messages: state.conversation,
        tools: [IMAGE_TOOL],
        tool_choice: 'auto',
      },
      client,
    );
    await handleChatResponse(response, model);
    resetStatusIfIdle();
  } catch (error) {
    console.error('Chat error', error);
    state.conversation.length = startingLength;
    throw error;
  }
}

async function handleChatResponse(initialResponse, model) {
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
          model,
          messages: state.conversation,
          tools: [IMAGE_TOOL],
          tool_choice: 'auto',
        },
        client,
      );
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
      const { dataUrl } = await generateImageAsset(prompt, {
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
    const binary = await image(
      prompt,
      {
        width,
        height,
        model: imageModel,
      },
      client,
    );
    const dataUrl = binary.toDataUrl();
    resetStatusIfIdle();
    return { dataUrl };
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
    option.value = model.name;
    option.textContent = model.description ? `${model.name} — ${model.description}` : model.name;
    els.modelSelect.appendChild(option);
  }
  const preferred = models.find(m => m.name === 'openai') ?? models[0];
  if (preferred) {
    els.modelSelect.value = preferred.name;
  }
}

function populateVoices(voices) {
  els.voiceSelect.innerHTML = '';
  if (!voices.length) {
    els.voiceSelect.disabled = true;
    els.voicePlayback.checked = false;
    state.voicePlayback = false;
    return;
  }
  els.voiceSelect.disabled = false;
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
    const models = await textModels(client);
    if (!Array.isArray(models) || !models.length) {
      throw new Error('Received an empty model list');
    }
    state.models = models.sort((a, b) => a.name.localeCompare(b.name));
    populateModels(state.models);
    const voiceModel = state.models.find(model => Array.isArray(model.voices) && model.voices.length > 0);
    populateVoices(voiceModel?.voices ?? FALLBACK_VOICES);
    resetConversation({ clearMessages: true });
    setStatus(DEFAULT_STATUS);
  } catch (error) {
    console.warn('Failed to load models, falling back to defaults', error);
    state.models = FALLBACK_MODELS;
    populateModels(state.models);
    populateVoices(FALLBACK_VOICES);
    resetConversation({ clearMessages: true });
    setStatus('Using fallback models. Some features may be limited.', { error: true });
  }
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
      const { dataUrl } = await generateImageAsset(prompt);
      addMessage({
        role: 'assistant',
        type: 'image',
        url: dataUrl,
        alt: prompt,
        caption: prompt,
      });
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

loadModels().then(() => {
  setupRecognition();
}).catch(error => {
  console.error('Failed to initialise application', error);
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
