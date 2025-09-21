import assert from 'node:assert/strict';
import { renderMarkdown, enhanceCodeBlocksHtml } from '../src/lib/markdown.js';

export const name = 'Code copy: injects a copy button for each fenced block';

export async function run() {
  const md = [
    '```python',
    'print("hello")',
    '```',
    '',
    '```js',
    'console.log(123)',
    '```',
  ].join('\n');
  const html = enhanceCodeBlocksHtml(renderMarkdown(md));
  const countButtons = (html.match(/class=\"copy-code\"/g) || []).length;
  const countBlocks = (html.match(/<pre>\s*<code/gi) || []).length;
  assert.equal(countButtons, 2, 'should add one copy button per code block');
  assert.ok(/class=\"code-block\"[\s\S]*<pre>[\s\S]*<code/i.test(html), 'wrapper missing');
  assert.ok(/Copy<\/button>\s*<pre>/i.test(html), 'button should be before <pre>');
}

