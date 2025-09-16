# polliLib (JavaScript)

High‑level JavaScript client for Pollinations.AI. ESM module targeting Node.js >= 18 with native `fetch` and Streams.

- Uses `process.env.POLLINATIONS_TOKEN` automatically. You can also call `configure({ token, referrer })`.
- Top‑level API (exact names per AGENTS.md):
  - `image`, `text`, `search`, `tts`, `stt`, `vision`
  - `imageModels`, `textModels`
  - `imageFeed`, `textFeed`
  - `tools`, `mcp`, `pipeline` modules
- Supports streaming (SSE) for text GET, chat POST, and public feeds.

## Install (local repo)
```bash
# from repo root
cd javascript
npm i
# use via relative import or `npm link` in your app
```

## Quickstart
```js
import * as polli from './javascript/index.js';

// Optional: configure; otherwise POLLINATIONS_TOKEN env is used
polli.configure({ referrer: 'my-app' });

// Text (GET)
const txt = await polli.text('Write a short poem about robots');
console.log(txt);

// Chat (OpenAI-compatible)
const chatResp = await polli.chat({
  model: 'openai',
  messages: [{ role: 'user', content: 'Explain event loops succinctly' }],
});
console.log(chatResp.choices[0].message.content);

// Image
const img = await polli.image('a watercolor cityscape', { width: 768, height: 512 });
await fs.promises.writeFile('city.jpg', img);

// TTS
const mp3 = await polli.tts('Hello from polliLib', { voice: 'nova' });
await fs.promises.writeFile('hello.mp3', mp3);

// Vision
const vision = await polli.vision({ imageUrl: 'https://example.com/pic.jpg', question: 'Describe the scene' });
console.log(vision.choices[0].message.content);

// Feeds (SSE)
for await (const ev of polli.imageFeed({ limit: 5 })) {
  console.log(ev);
}
```

## Build artifacts
- ESM only. No build step required.

