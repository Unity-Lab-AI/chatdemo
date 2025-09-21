import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

// Configure Markdown-It for GFM-like behavior, safe by default (no raw HTML)
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
  langPrefix: 'language-',
  highlight(str, lang) {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(str).value;
    } catch (_) {
      return '';
    }
  },
});

// Ensure rendered fenced blocks include the `hljs` class for theming
const origFence = md.renderer.rules.fence?.bind(md.renderer.rules) || null;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info ? String(token.info).trim() : '';
  const lang = info ? `language-${md.utils.escapeHtml(info)}` : '';
  const code = options.highlight
    ? options.highlight(token.content, info, '')
    : md.utils.escapeHtml(token.content);
  return `<pre><code class="hljs ${lang}">${code}</code></pre>\n`;
};

export function renderMarkdown(text) {
  const input = text == null ? '' : String(text);
  return md.render(input);
}

// Inject a copy button before each fenced code block. This keeps UI wiring simple
// and lets tests assert on static HTML.
export function enhanceCodeBlocksHtml(html) {
  if (!html || typeof html !== 'string') return html || '';
  if (html.includes('class="code-block"')) return html; // already enhanced
  const openRe = /<pre>\s*<code/gi;
  const closeRe = /<\/code>\s*<\/pre>/gi;
  return html
    .replace(openRe, '<div class="code-block"><button class="copy-code" type="button" aria-label="Copy code">Copy<\/button><pre><code')
    .replace(closeRe, '</code></pre></div>');
}
