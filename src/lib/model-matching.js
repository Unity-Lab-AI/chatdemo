const RESPONSE_MODEL_FIELDS = [
  'alias',
  'model_alias',
  'modelAlias',
  'canonical_model',
  'canonicalModel',
  'resolved_model',
  'resolvedModel',
  'primary_model',
  'primaryModel',
  'requested_model',
  'requestedModel',
  'requested',
  'backend_model',
  'backendModel',
  'provider_model',
  'providerModel',
  'origin_model',
  'originModel',
  'served_model',
  'servedModel',
  'model_name',
  'modelName',
  'model_id',
  'modelId',
  'target_model',
  'targetModel',
];

function normalize(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.toLowerCase() : null;
}

function addCandidate(set, value) {
  if (value == null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = normalize(value);
    if (normalized) set.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(entry => addCandidate(set, entry));
    return;
  }
  if (typeof value === 'object') {
    for (const key of ['id', 'model', 'name', 'alias', 'slug']) {
      if (key in value) {
        addCandidate(set, value[key]);
      }
    }
  }
}

export function collectResponseModelNames(response) {
  const names = new Set();
  if (!response || typeof response !== 'object') {
    return [];
  }

  for (const key of RESPONSE_MODEL_FIELDS) {
    addCandidate(names, response[key]);
  }

  if (Array.isArray(response?.aliases)) {
    response.aliases.forEach(entry => addCandidate(names, entry));
  }
  if (Array.isArray(response?.models)) {
    response.models.forEach(entry => addCandidate(names, entry));
  }
  if (Array.isArray(response?.modelAliases)) {
    response.modelAliases.forEach(entry => addCandidate(names, entry));
  }
  if (Array.isArray(response?.available_models)) {
    response.available_models.forEach(entry => addCandidate(names, entry));
  }

  const metadata = response?.metadata;
  if (metadata && typeof metadata === 'object') {
    for (const key of RESPONSE_MODEL_FIELDS) {
      addCandidate(names, metadata[key]);
    }
    if (Array.isArray(metadata.aliases)) {
      metadata.aliases.forEach(entry => addCandidate(names, entry));
    }
  }

  const reported = normalize(response?.model);
  if (reported) {
    names.delete(reported);
  }

  return Array.from(names);
}

export function isMatchingModelName(value, model) {
  if (!value && value !== 0) return false;
  const normalized = normalize(value);
  if (!normalized) return false;
  const identifiers = model?.identifiers;
  if (identifiers?.has?.(normalized)) return true;
  if (normalized.includes('/')) {
    const last = normalized.split('/').pop();
    if (last && identifiers?.has?.(last)) return true;
  }
  return false;
}

export function doesResponseMatchModel(response, model) {
  if (!response || typeof response !== 'object') {
    return false;
  }
  if (isMatchingModelName(response.model, model)) {
    return true;
  }
  const candidates = collectResponseModelNames(response);
  for (const candidate of candidates) {
    if (isMatchingModelName(candidate, model)) {
      return true;
    }
  }
  return false;
}

export const __testing = {
  collectResponseModelNames,
  isMatchingModelName,
  normalize,
};
