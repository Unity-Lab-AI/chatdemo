import assert from 'node:assert/strict';
import { matchesModelIdentifier, normalizeTextCatalog } from '../src/model-catalog.js';

export const name = 'Model catalog normalization infers endpoints and aliases';

export async function run() {
  const rawCatalog = {
    openai: {
      id: 'openai',
      name: 'GPT-4o mini',
      description: 'OpenAI reference model',
      provider: 'OpenAI',
      compatibility: ['openai', 'chat-completions'],
    },
    unity: {
      id: 'unity',
      name: 'Unity Seed Model',
      description: 'Unity-focused model',
      provider: 'Pollinations',
      tier: 'seed',
      aliases: ['pollinations/unity'],
    },
  };

  const models = normalizeTextCatalog(rawCatalog);
  assert.equal(models.length, 2);

  const openaiModel = models.find(model => matchesModelIdentifier('openai', model));
  const unityModel = models.find(model => matchesModelIdentifier('unity', model));

  assert(openaiModel, 'Expected to find the OpenAI model');
  assert(unityModel, 'Expected to find the Unity model');

  assert(openaiModel.endpoints.includes('openai'), 'OpenAI model should include the openai endpoint');
  assert(!openaiModel.endpoints.includes('seed'), 'OpenAI model should not include the seed endpoint');

  assert(unityModel.endpoints[0] === 'seed', 'Unity model should prioritise the seed endpoint');
  assert(unityModel.endpoints.includes('openai'), 'Unity model should include the openai fallback');
  assert(matchesModelIdentifier('pollinations/unity', unityModel), 'Unity aliases should support namespaced identifiers');
}
