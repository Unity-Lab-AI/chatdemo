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

const client = new PolliClient();

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
      <button id="newSession" type="button" class="ghost">New session</button>
    </header>
    <div id="status" class="status" role="status" aria-live="polite"></div>
    <section id="messages" class="messages" aria-live="polite"></section>
    <form id="chatForm" class="chat-form">
      <textarea
        id="promptInput"
        placeholder="Type a message or use /image prompt to generate a picture"
        autocomplete="off"
      ></textarea>
      <div class="actions">
        <button id="voiceButton" type="button" class="voice" aria-pressed="false">
          🎙️ Voice input
        </button>
        <button id="sendButton" type="submit" class="primary">Send</button>
      </div>
    </form>
    <p class="hint">
      Tip: Voice capture ends automatically after 0.5 seconds of silence. Use
      <code>/image your prompt</code> for image generations.
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
  newSession: document.querySelector('#newSession'),
};

const state = {
  conversation: [],
  messages: [],
  loading: false,
  models: [],
};

let messageIdCounter = 0;
let recognition = null;
let recognizing = false;
let recognitionSilenceTimer = null;
let recognitionBaseText = '';
let recognitionFinalText = '';

function setStatus(message, options = {}) {
  const { error = false } = options;
  els.status.textContent = message ?? '';
  els.status.classList.toggle('error', !!error);
}

function setLoading(isLoading) {
  state.loading = isLoading;
  els.sendButton.disabled = isLoading;
  els.input.disabled = isLoading && recognizing === false;
  els.form.classList.toggle('loading', isLoading);
}

function addMessage(message) {
  state.messages.push({ ...message, id: ++messageIdCounter });
  renderMessages();
}

function resetConversation() {
  state.conversation = [];
  state.messages = [];
  messageIdCounter = 0;
  renderMessages();
  setStatus('Starting a fresh session.');
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

    if (message.role === 'assistant' && message.type === 'text' && els.voiceSelect.value) {
      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'play';
      playButton.textContent = '🔊 Play response';
      playButton.addEventListener('click', () => speakMessage(message, playButton));
      article.appendChild(playButton);
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

async function speakMessage(message, button) {
  if (!message?.content) return;
  const voice = els.voiceSelect.value;
  if (!voice) return;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Generating audio…';
  try {
    const audioData = await tts(message.content, { voice, model: 'openai-audio' }, client);
    const blob = audioData.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('ended', () => URL.revokeObjectURL(url));
    audio.addEventListener('error', () => URL.revokeObjectURL(url));
    await audio.play();
  } catch (error) {
    console.error('TTS failed', error);
    setStatus(`Text-to-speech failed: ${error.message ?? error}`, { error: true });
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function sendPrompt(prompt) {
  const model = els.modelSelect.value || state.models[0]?.name;
  if (!model) {
    throw new Error('No model selected.');
  }
  state.conversation.push({ role: 'user', content: prompt });
  try {
    const response = await chat({ model, messages: state.conversation }, client);
    const reply = response?.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error('No response returned from model.');
    }
    state.conversation.push({ role: 'assistant', content: reply });
    addMessage({ role: 'assistant', type: 'text', content: reply });
  } catch (error) {
    console.error('Chat error', error);
    setStatus(`Request failed: ${error.message ?? error}`, { error: true });
    state.conversation.pop();
    addMessage({
      role: 'assistant',
      type: 'error',
      content: error.message ?? String(error),
    });
  }
}

async function generateImage(prompt) {
  setStatus('Generating image…');
  try {
    const binary = await image(prompt, { width: 768, height: 512 }, client);
    const dataUrl = binary.toDataUrl();
    addMessage({
      role: 'assistant',
      type: 'image',
      url: dataUrl,
      alt: prompt,
      caption: prompt,
    });
    setStatus('');
  } catch (error) {
    console.error('Image generation failed', error);
    setStatus(`Image generation failed: ${error.message ?? error}`, { error: true });
    addMessage({
      role: 'assistant',
      type: 'error',
      content: error.message ?? String(error),
    });
  }
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
  const mute = document.createElement('option');
  mute.value = '';
  mute.textContent = 'Muted';
  els.voiceSelect.appendChild(mute);
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice;
    option.textContent = voice;
    els.voiceSelect.appendChild(option);
  }
  els.voiceSelect.value = voices.includes('nova') ? 'nova' : voices[0] ?? '';
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
    setStatus('Models loaded.');
  } catch (error) {
    console.warn('Failed to load models, falling back to defaults', error);
    state.models = FALLBACK_MODELS;
    populateModels(state.models);
    populateVoices(FALLBACK_VOICES);
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
    setStatus('');
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
    setStatus(`Cannot start voice input: ${error.message ?? error}`, { error: true });
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
  setStatus('');
  setLoading(true);

  try {
    if (raw.toLowerCase().startsWith('/image')) {
      const prompt = raw.slice('/image'.length).trim();
      if (!prompt) {
        throw new Error('Provide a prompt after /image');
      }
      await generateImage(prompt);
    } else {
      await sendPrompt(raw);
    }
  } catch (error) {
    console.error('Submission error', error);
    setStatus(error.message ?? String(error), { error: true });
    addMessage({ role: 'assistant', type: 'error', content: error.message ?? String(error) });
    if (state.conversation.length && state.conversation[state.conversation.length - 1].role === 'user') {
      state.conversation.pop();
    }
  } finally {
    setLoading(false);
  }
});

els.modelSelect.addEventListener('change', () => {
  resetConversation();
});

els.voiceSelect.addEventListener('change', () => {
  renderMessages();
});

els.voiceButton.addEventListener('click', () => {
  startRecognition();
});

els.newSession.addEventListener('click', () => {
  resetConversation();
  els.input.value = '';
  els.input.focus();
});

loadModels().then(() => {
  setupRecognition();
  setStatus('Ready.');
});

window.addEventListener('beforeunload', () => {
  if (recognizing) {
    stopRecognition();
  }
});
