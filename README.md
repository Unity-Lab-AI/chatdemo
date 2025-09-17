# chatdemo

Static browser demo for interacting with [Pollinations](https://pollinations.ai) using the bundled
[PolliLib](./Libs/pollilib/) client. The application is built with Vite so it can be deployed to a
static host such as GitHub Pages. It features:

## Main branch status

[![Build status](https://github.com/Unity-Lab-AI/chatdemo/actions/workflows/main.yml/badge.svg?branch=main&job=Build%20and%20Upload%20Artifacts)](https://github.com/Unity-Lab-AI/chatdemo/actions/workflows/main.yml)
[![Test status](https://github.com/Unity-Lab-AI/chatdemo/actions/workflows/main.yml/badge.svg?branch=main&job=Run%20Tests)](https://github.com/Unity-Lab-AI/chatdemo/actions/workflows/main.yml)

- Text chat powered by PolliLib's `chat()` helper.
- Assistant-guided and manual (`/image`) Pollinations image generation.
- Model selector populated from the Pollinations text model catalog.
- Voice selector paired with an optional playback toggle for text-to-speech responses.
- Browser voice capture (Web Speech API) with an automatic 0.5 second silence timeout.

## Development

```bash
npm install
npm run dev
```

## Building for static hosting

```bash
npm run build
```

The generated assets are written to `dist/` and can be published as-is. When hosted on GitHub Pages
make sure the contents of `dist/` are deployed.

## Configuring the Pollinations token

Pollinations models that require tiered access expect the token to be supplied as a request
parameter. The demo can resolve the token at runtime (via URL parameters, meta tags, or injected
globals) and also honours build-time environment variables when you want to bake the token into the
bundle.

- **GitHub Pages / production** – Provide the `POLLI_TOKEN` secret in the repository (or Pages
  environment). You can surface the token to the client by setting `window.__POLLINATIONS_TOKEN__`,
  defining a `<meta name="pollinations-token" content="...">` tag, adding a `token=...` query
  parameter to the published URL (e.g. `https://example.github.io/chatdemo/?token=your-secret`), or
  injecting `POLLI_TOKEN`/`VITE_POLLI_TOKEN` during the build so the token ships with the bundle.
  The token is removed from the visible URL after it is captured.
- **Local development** – Define `POLLI_TOKEN`/`VITE_POLLI_TOKEN` in your shell when running
  `npm run dev`, add a meta tag as above, or inject `window.__POLLINATIONS_TOKEN__` before the
  application bootstraps. Build-time environment variables also work in development.
- **Optional runtime endpoint** – If you expose the token via a custom endpoint, configure its URL
  with `POLLI_TOKEN_ENDPOINT`/`VITE_POLLI_TOKEN_ENDPOINT` (environment variables),
  `window.__POLLINATIONS_TOKEN_ENDPOINT__`, or a `<meta name="pollinations-token-endpoint" ...>` tag.
  When present, the client will fetch the token from that endpoint.

If the token cannot be resolved the application continues without one, allowing you to browse public
models while gated Pollinations models remain unavailable until a token is supplied.

All chat and image requests automatically include a random eight-digit `seed` parameter so they
match Pollinations' expected request format.
