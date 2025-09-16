PolliLib Web (Browser)
----------------------

Browser‑friendly JavaScript client for Pollinations.AI that uses referrer‑based authentication and never sends tokens from the frontend.

Key points:

- Uses `referrer` (browser Referer header or explicit `?referrer=`/body field) — no `Authorization` or `token` is used.
- Returns Blobs for binary endpoints (images, TTS) so you can use `URL.createObjectURL`.
- Supports streaming via SSE with async generators.

Quick start

```js
import * as polli from './index.js'; // or your bundler path

polli.configure({ referrer: window.location.origin }); // optional; browsers send Referer automatically

// Image
const imgBlob = await polli.image('a scenic beach at sunset', { width: 512 });
const imgUrl = URL.createObjectURL(imgBlob);
document.querySelector('#out').src = imgUrl;

// Text
const text = await polli.text('Respond with: ok');

// Chat (OpenAI compatible)
const chat = await polli.chat({
  model: 'openai',
  messages: [{ role: 'user', content: 'Say hi' }],
});
```

API surface

- `polli.image(prompt, params)` → Blob
- `polli.text(prompt, params)` → string or async generator (when `stream:true`)
- `polli.search(query, model?)` → string
- `polli.tts(text, params)` → Blob (audio)
- `polli.stt({ file|data, format, question? })` → JSON
- `polli.vision({ imageUrl|file|data, imageFormat?, question?, model?, max_tokens? })` → JSON
- `polli.imageModels()` / `polli.textModels()` → JSON
- `polli.imageFeed(opts)` / `polli.textFeed(opts)` → async generator of feed items
- `polli.tools`, `polli.mcp`, `polli.pipeline` — helpers

Security

- Never expose API tokens in the browser. Register your domain at auth.pollinations.ai and rely on referrer.

