import { chat as chatPost } from './text.js';

export function functionTool(name, description, parameters) {
  return { type: 'function', function: { name, description, parameters } };
}

export class ToolBox {
  constructor() { this.map = new Map(); }
  register(name, fn) { this.map.set(name, fn); return this; }
  get(name) { return this.map.get(name); }
}

export async function chatWithTools({ client, model, messages, tools, toolbox, maxRounds = 3, tool_choice }) {
  const history = [...messages];
  for (let round = 0; round <= maxRounds; round++) {
    const resp = await chatPost({ model, messages: history, tools, tool_choice }, client);
    const choice = (resp.choices?.[0]?.message) ?? {};
    const toolCalls = choice.tool_calls ?? [];
    if (!toolCalls.length) return resp;

    history.push({ role: 'assistant', tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const fname = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments ?? '{}'); } catch {}
      const fn = toolbox.get(fname);
      if (!fn) return resp;
      const out = await fn(args);
      history.push({ role: 'tool', tool_call_id: tc.id, name: fname, content: typeof out === 'string' ? out : JSON.stringify(out) });
    }
  }
  return await chatPost({ model, messages: history }, client);
}

