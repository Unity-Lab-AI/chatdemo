import { chat as chatPost } from './text.js';
import { getDefaultClient } from './client.js';

export function functionTool(name, description, parameters) {
  return { type: 'function', function: { name, description, parameters } };
}

export class ToolBox {
  constructor() {
    this.map = new Map();
  }

  register(name, fn) {
    this.map.set(name, fn);
    return this;
  }

  get(name) {
    return this.map.get(name);
  }
}

export async function chatWithTools({
  client = getDefaultClient(),
  model,
  messages,
  tools,
  toolbox = new ToolBox(),
  maxRounds = 3,
  tool_choice,
} = {}) {
  if (!model) throw new Error('chatWithTools requires a model');
  if (!Array.isArray(messages)) throw new Error('chatWithTools requires an array of messages');

  const history = [...messages];
  for (let round = 0; round <= maxRounds; round++) {
    const response = await chatPost({ model, messages: history, tools, tool_choice }, client);
    const choice = response?.choices?.[0]?.message ?? {};
    const toolCalls = choice.tool_calls ?? [];
    if (!toolCalls.length) return response;

    history.push({ role: 'assistant', tool_calls: toolCalls });

    for (const call of toolCalls) {
      const name = call.function?.name;
      const fn = toolbox.get(name);
      if (!fn) return response;
      let args = {};
      if (call.function?.arguments) {
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
        }
      }
      const result = await fn(args);
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }

  return await chatPost({ model, messages: history }, client);
}
