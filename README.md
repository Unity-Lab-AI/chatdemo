# chatdemo

Static browser demo for interacting with [Pollinations](https://pollinations.ai) using the bundled
[PolliLib](./Libs/pollilib/) client. The application is built with Vite so it can be deployed to a
static host such as GitHub Pages. It features:

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
