// Simple Node chat example using PolliLib (token-based)
// Usage: POLLINATIONS_TOKEN=your_token node chat.js
import * as polli from '../index.js';

async function main() {
  const messages = [
    { role: 'user', content: 'Say hello in one short sentence.' }
  ];

  // Non-streaming example
  const res = await polli.chat({ model: 'openai', messages });
  console.log('Assistant:', res?.choices?.[0]?.message?.content ?? String(res));

  // Streaming example
  const stream = await polli.chat({ model: 'openai', messages, stream: true });
  let acc = '';
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content ?? '';
    if (delta) {
      acc += delta;
      process.stdout.write(delta);
    }
  }
  console.log('\n[done]');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

