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

Pollinations models that require tiered access need a token on every request. The application now
expects the token to be provided at runtime so it is never bundled into the static assets.

- **GitHub Pages / production** – Provide the `POLLI_TOKEN` secret in the repository (or Pages
  environment). The included Pages Function at `.github/functions/polli-token.js` exposes the token
  at runtime via `/api/polli-token`, and responses are marked as non-cacheable.
- **Local development** – Either define `POLLI_TOKEN`/`VITE_POLLI_TOKEN` in your shell when running
  `npm run dev`, add a `<meta name="pollinations-token" ...>` tag to `index.html`, or inject
  `window.__POLLINATIONS_TOKEN__` before the application bootstraps.
- **Static overrides** – When a dynamic endpoint is unavailable, append a `token` query parameter
  to the page URL (e.g. `https://example.github.io/chatdemo/?token=your-secret`). The application
  will capture the token, remove it from the visible URL, and apply it to subsequent Pollinations
  requests.

If the token cannot be resolved the UI remains disabled and an error is shown in the status banner.
