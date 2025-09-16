# polliLib

A unified, environment-agnostic JavaScript wrapper around the [Pollinations](https://pollinations.ai) API.  The library was
re-built from the previous split `javascript`, `javascript-web`, and `javascript-node` implementations so the exact same
source can be bundled into browser applications or imported directly in Node.

## Features

- Works in browsers, Node 18+, Bun, and any runtime that exposes a WHATWG `fetch` implementation.
- Automatic referrer-based authentication in the browser and secure token based authentication for backends.
- Streaming support for the text and OpenAI-compatible chat endpoints.
- Image, audio (TTS/STT), and vision helpers that return ergonomic `BinaryData` wrappers.
- Feed consumers, tool helpers, and MCP-friendly utilities.
- Lightweight ES module source that can be bundled with tools such as Vite, Rollup, or Webpack without additional shims.

## Installation

The library is pure ESM.  You can import it directly from source or publish it as an npm package.  When using it in a browser
project make sure your bundler is configured for ES modules.

```js
import { PolliClient, text } from './Libs/pollilib/index.js';

const client = new PolliClient();
const reply = await text('Hello from polliLib!', {}, client);
console.log(reply);
```

In Node 18+ run the script with `node --experimental-modules` on older releases or simply `node` when ES modules are enabled
(the default for `.mjs` files or when `"type": "module"` is set).

## Authentication

polliLib ships with a flexible `PolliClient` that can operate in one of three modes:

| Mode       | When to use                                         | Behaviour |
|------------|-----------------------------------------------------|-----------|
| `referrer` | Frontend/browser apps (default when `window` exists) | Adds the referrer domain to outgoing requests. |
| `token`    | Trusted backends or CLIs                            | Retrieves a token via a provider function and sends it using the `Authorization` header by default. |
| `none`     | Quick experiments                                   | Sends anonymous requests and respects public rate limits. |

Example backend usage with a token provider:

```js
import { PolliClient, chat } from './Libs/pollilib/index.js';

const client = new PolliClient({
  auth: {
    mode: 'token',
    // Never embed static tokens inside frontend bundles.
    getToken: () => process.env.POLLINATIONS_TOKEN,
  },
});

const response = await chat({
  model: 'openai',
  messages: [{ role: 'user', content: 'Give me a short haiku about Pollinations.' }],
}, client);

console.log(response.choices[0].message.content);
```

When bundling for the browser you can omit the `auth` block and the client will rely on the page referrer automatically.
If you must call authenticated endpoints from the frontend provide a `getToken` function that performs a server round-trip to
fetch a short-lived credential; the library never appends tokens to query strings unless you explicitly request that behaviour.

## Working with binary responses

Functions like `image()` and `tts()` return a `BinaryData` instance.  It lazily exposes the payload in the form most convenient
for your environment:

```js
const picture = await image('Colourful abstract art', { width: 768, height: 512 }, client);

// Browser: attach to an <img>
const url = picture.toDataUrl();
document.querySelector('img#result').src = url;

// Node: write to disk
import { writeFile } from 'node:fs/promises';
await writeFile('artwork.png', picture.toNodeBuffer());
```

`BinaryData` also exposes `arrayBuffer()`, `uint8Array()`, and `toBase64()` helpers so you do not need to juggle environment
specific APIs.

## Streaming text

Both `text()` and `chat()` support server-sent events when the `stream` option is `true`:

```js
const stream = await text('List five emoji for joy', { stream: true }, client);
for await (const chunk of stream) {
  console.log(chunk);
}
```

`chat()` yields parsed JSON objects for each chunk which makes tool calling loops straightforward.

## Tooling helpers

The `ToolBox`, `chatWithTools()`, pipeline steps, feed consumers, and MCP helpers have all been updated to work across
runtimes.  See the source files inside `src/` for additional details and customise them as needed for your app.

