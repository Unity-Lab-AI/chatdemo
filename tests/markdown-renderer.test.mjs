import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/lib/markdown.js';

export const name = 'Markdown: renders fenced code with syntax highlighting and GFM basics';

export async function run() {
  const sample = [
    '# Title',
    '',
    '- [x] task',
    '',
    '```javascript',
    'function add(a, b) {',
    '  return a + b; // sum',
    '}',
    '```',
    '',
    'Inline `code` and a link: https://example.com',
  ].join('\n');

  const html = renderMarkdown(sample);
  assert.match(html, /<h1[^>]*>\s*Title\s*<\/h1>/i, 'heading missing');
  assert.match(html, /<li[^>]*>/i, 'list item missing');
  assert.match(html, /<code[^>]*>code<\/code>/i, 'inline code missing');
  // Code fence should include language class and hljs markup
  assert.match(html, /<pre>\s*<code[^>]*class="[^"]*hljs[^"]*language-javascript[^"]*"/i, 'code block classes missing');
  // Highlight.js typically wraps tokens in <span> elements; check for at least one span
  assert.match(html, /<pre>[\s\S]*<span[^>]*>[\s\S]*<\/span>[\s\S]*<\/pre>/i, 'highlight spans missing');
}

