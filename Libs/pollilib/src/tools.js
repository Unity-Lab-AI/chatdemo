import { chat } from './text.js';
import { getDefaultClient } from './client.js';

export function functionTool(name, description, parameters) {
  return {
    type: 'function',
    function: { name, description, parameters },
  };
}

export class ToolBox {
  constructor(entries) {
    this._map = new Map();
    if (entries) {
      for (const [name, handler] of Object.entries(entries)) {
        this.register(name, handler);
      }
    }
  }

  register(name, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Tool '${name}' must be a function`);
    }
    this._map.set(name, handler);
    return this;
  }

  has(name) {
    return this._map.has(name);
  }

  get(name) {
    return this._map.get(name);
  }

  async invoke(name, args, context) {
    const handler = this._map.get(name);
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return await handler(args ?? {}, context);
  }
}

export async function chatWithTools({
  client = getDefaultClient(),
  model,
  messages,
  tools = [],
  toolbox = new ToolBox(),
  maxRounds = 3,
  toolChoice,
  onToolCall,
} = {}) {
  if (!model) {
    throw new Error('chatWithTools requires a model');
  }
  if (!Array.isArray(messages)) {
    throw new Error('chatWithTools requires an array of messages');
  }

  const history = [...messages];

  for (let round = 0; round <= maxRounds; round += 1) {
    const response = await chat({ model, messages: history, tools, tool_choice: toolChoice }, client);
    const choice = response?.choices?.[0]?.message ?? {};
    const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

    if (!toolCalls.length) {
      return response;
    }

    history.push({ role: 'assistant', tool_calls: toolCalls });

    for (const call of toolCalls) {
      const name = call.function?.name;
      if (!name || !toolbox.has(name)) {
        return response;
      }
      const args = parseToolArguments(call.function?.arguments);
      const context = { round, history: [...history] };
      if (typeof onToolCall === 'function') {
        await onToolCall({ name, args, round, history });
      }
      const result = await toolbox.invoke(name, args, context);
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: serializeToolResult(result),
      });
    }
  }

  return await chat({ model, messages: history }, client);
}

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return {};
}

function serializeToolResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
