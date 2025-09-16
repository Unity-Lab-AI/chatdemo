const OPENAI_HINTS = [
  'openai',
  'gpt',
  'o1',
  'o2',
  'o3',
  'o4',
  'mistral',
  'claude',
  'anthropic',
  'sonnet',
  'opus',
  'haiku',
  'llama',
  'deepseek',
  'grok',
  'nova',
  'whisper',
  'gpt4o',
];

const SEED_HINTS = [
  'seed',
  'pollinations',
  'unity',
  'flux',
  'kontext',
  'chatdolphin',
  'hunyuan',
  'kling',
  'blackforest',
];

export function normalizeTextCatalog(raw) {
  const entries = [];
  if (Array.isArray(raw)) {
    raw.forEach((entry, index) => {
      const normalized = normalizeEntry(entry, { fallbackKey: String(index) });
      if (normalized) entries.push(normalized);
    });
  } else if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([key, value]) => {
      const normalized = normalizeEntry(value, { fallbackKey: key });
      if (normalized) entries.push(normalized);
    });
  }
  return entries;
}

export function createFallbackModel(id, description, endpoints = ['openai']) {
  const model = normalizeEntry(
    {
      id,
      name: id,
      description,
      endpoints,
    },
    { fallbackKey: id },
  );
  if (model) return model;
  const identifiers = new Set();
  addIdentifier(identifiers, id);
  return {
    id,
    value: id,
    label: id,
    name: id,
    description: description ?? '',
    tier: null,
    provider: null,
    capabilities: [],
    families: [],
    voices: [],
    aliases: [],
    endpoints: endpoints.length ? Array.from(new Set(endpoints.map(normalizeEndpoint))) : ['openai'],
    identifiers,
    hints: normalizeHintSet([id, description]),
    raw: { id, name: id, description, endpoints },
  };
}

export function matchesModelIdentifier(value, model) {
  if (!model) return false;
  if (!value && value !== 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  const identifiers = model.identifiers ?? collectIdentifiers(model);
  return identifiers.has(normalized);
}

export function collectModelIdentifiers(model) {
  if (!model) return new Set();
  return new Set(model.identifiers ?? collectIdentifiers(model));
}

function normalizeEntry(entry, { fallbackKey }) {
  if (entry == null) return null;
  if (typeof entry === 'string') {
    return buildModel({
      id: entry,
      label: entry,
      description: '',
      tier: null,
      provider: null,
      voices: [],
      capabilities: [],
      families: [],
      aliases: [],
      explicitEndpoints: [],
      hints: [entry],
      raw: entry,
    });
  }

  const raw = entry;
  const id = pickString(raw.id, raw.model, raw.slug, raw.handle, raw.key, raw.value, raw.name, fallbackKey);
  if (!id) return null;
  const label = pickString(
    raw.displayName,
    raw.display_name,
    raw.label,
    raw.title,
    raw.prettyName,
    raw.shortName,
    raw.name,
    id,
  );
  const description = pickString(raw.description, raw.summary, raw.notes, raw.tagline, raw.subtitle);
  const tier = pickString(raw.tier, raw.pack, raw.plan, raw.access, raw.level);
  const provider = pickString(raw.provider, raw.vendor, raw.source, raw.backend, raw.engine, raw.platform, raw.family);
  const voices = uniqueStrings(toArray(raw.voices));
  const capabilities = uniqueStrings([
    ...toArray(raw.capabilities),
    ...toArray(raw.modes),
    ...toArray(raw.features),
    ...toArray(raw.skills),
  ]);
  const families = uniqueStrings([
    ...toArray(raw.families),
    ...toArray(raw.family),
    ...toArray(raw.categories),
    ...toArray(raw.tags),
    ...toArray(raw.groups),
    ...toArray(raw.domains),
  ]);
  const aliases = uniqueStrings([
    ...toArray(raw.aliases),
    ...toArray(raw.alias),
    ...toArray(raw.ids),
    ...toArray(raw.identifiers),
    ...toArray(raw.slugs),
    ...toArray(raw.keys),
    ...toArray(raw.handles),
  ]);

  const explicitEndpoints = extractExplicitEndpoints(raw);
  const hints = gatherHints({
    id,
    label,
    description,
    tier,
    provider,
    capabilities,
    families,
    aliases,
    raw,
  });

  return buildModel({
    id,
    label,
    description,
    tier,
    provider,
    voices,
    capabilities,
    families,
    aliases,
    explicitEndpoints,
    hints,
    raw,
  });
}

function buildModel({
  id,
  label,
  description,
  tier,
  provider,
  voices,
  capabilities,
  families,
  aliases,
  explicitEndpoints,
  hints,
  raw,
}) {
  const identifiers = collectIdentifiers({
    id,
    label,
    aliases,
    raw,
  });
  const hintSet = normalizeHintSet(hints);
  const endpoints = deriveModelEndpoints(explicitEndpoints, hintSet, identifiers);
  return {
    id,
    value: id,
    label,
    name: label,
    description: description ?? '',
    tier: tier ?? null,
    provider: provider ?? null,
    capabilities,
    families,
    voices,
    aliases,
    endpoints,
    identifiers,
    hints: hintSet,
    raw,
  };
}

function collectIdentifiers({ id, label, aliases = [], raw }) {
  const identifiers = new Set();
  addIdentifier(identifiers, id);
  addIdentifier(identifiers, label);
  const rawObj = raw && typeof raw === 'object' ? raw : {};
  addIdentifier(identifiers, rawObj.id);
  addIdentifier(identifiers, rawObj.model);
  addIdentifier(identifiers, rawObj.slug);
  addIdentifier(identifiers, rawObj.name);
  addIdentifier(identifiers, rawObj.handle);
  toArray(rawObj.ids).forEach(value => addIdentifier(identifiers, value));
  toArray(rawObj.slugs).forEach(value => addIdentifier(identifiers, value));
  toArray(rawObj.aliases).forEach(value => addIdentifier(identifiers, value));
  toArray(rawObj.identifiers).forEach(value => addIdentifier(identifiers, value));
  aliases.forEach(value => addIdentifier(identifiers, value));
  return identifiers;
}

function addIdentifier(set, value) {
  if (!value && value !== 0) return;
  if (Array.isArray(value)) {
    value.forEach(item => addIdentifier(set, item));
    return;
  }
  const str = String(value).trim();
  if (!str) return;
  const normalized = str.toLowerCase();
  if (!set.has(normalized)) {
    set.add(normalized);
    if (normalized.includes('/')) {
      const parts = normalized.split('/');
      const last = parts[parts.length - 1];
      if (last && !set.has(last)) {
        set.add(last);
      }
    }
  }
}

function deriveModelEndpoints(explicitEndpoints, hints, identifiers) {
  const endpoints = [];
  const seen = new Set();
  const add = endpoint => {
    const normalized = normalizeEndpoint(endpoint);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    endpoints.push(normalized);
  };

  explicitEndpoints.forEach(add);

  const combinedHints = new Set([...(hints ?? []), ...identifiers]);
  const lowerHints = Array.from(combinedHints).map(value => String(value).toLowerCase());

  const indicatesOpenAi = lowerHints.some(hint => OPENAI_HINTS.some(marker => hint.includes(marker)));
  const indicatesSeed = lowerHints.some(hint => SEED_HINTS.some(marker => hint.includes(marker)));

  if (indicatesOpenAi) add('openai');
  if (indicatesSeed) add('seed');
  if (indicatesSeed && !seen.has('openai')) add('openai');

  if (!endpoints.length) add('openai');
  return endpoints;
}

function normalizeHintSet(values) {
  const set = new Set();
  toArray(values).forEach(value => {
    if (!value && value !== 0) return;
    const str = String(value).trim();
    if (!str) return;
    set.add(str.toLowerCase());
  });
  return set;
}

function extractExplicitEndpoints(raw) {
  const endpoints = [];
  const directFields = [
    raw && raw.endpoint,
    raw && raw.chat_endpoint,
    raw && raw.chatEndpoint,
    raw && raw.api,
    raw && raw.api_endpoint,
    raw && raw.apiEndpoint,
    raw && raw.path,
    raw && raw.route,
    raw && raw.url,
    raw && raw.default_endpoint,
    raw && raw.defaultEndpoint,
  ];
  directFields.forEach(value => {
    const normalized = normalizeEndpoint(value);
    if (normalized) endpoints.push(normalized);
  });

  const containers = [raw && raw.endpoints, raw && raw.routes, raw && raw.paths, raw && raw.api_paths, raw && raw.apis];
  containers.forEach(container => {
    for (const value of iterateValues(container)) {
      const normalized = normalizeEndpoint(value);
      if (normalized) endpoints.push(normalized);
    }
  });

  return endpoints;
}

function gatherHints({ id, label, description, tier, provider, capabilities, families, aliases, raw }) {
  const hints = new Set();
  const add = value => {
    if (!value && value !== 0) return;
    if (Array.isArray(value) || value instanceof Set) {
      for (const item of value) add(item);
      return;
    }
    if (typeof value === 'object') {
      for (const entry of Object.values(value)) {
        add(entry);
      }
      return;
    }
    const str = String(value).trim();
    if (!str) return;
    hints.add(str.toLowerCase());
  };

  add(id);
  add(label);
  add(description);
  add(tier);
  add(provider);
  add(capabilities);
  add(families);
  add(aliases);

  const rawObj = raw && typeof raw === 'object' ? raw : {};
  add(rawObj.provider);
  add(rawObj.vendor);
  add(rawObj.source);
  add(rawObj.backend);
  add(rawObj.engine);
  add(rawObj.platform);
  add(rawObj.family);
  add(rawObj.category);
  add(rawObj.kind);
  add(rawObj.tier);
  add(rawObj.pack);
  add(rawObj.plan);
  add(rawObj.access);
  add(rawObj.level);
  add(rawObj.compatibility);
  add(rawObj.interfaces);
  add(rawObj.protocols);
  add(rawObj.formats);
  add(rawObj.adapters);
  add(rawObj.integrations);
  add(rawObj.capabilities);
  add(rawObj.modes);
  add(rawObj.features);
  add(rawObj.skills);
  add(rawObj.tags);
  add(rawObj.groups);

  return Array.from(hints);
}

function normalizeEndpoint(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'string') {
    let trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const url = new URL(trimmed);
        trimmed = url.pathname || '';
      } catch {
        // ignore invalid URLs
      }
    }
    trimmed = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
    return trimmed || null;
  }
  return null;
}

function pickString(...values) {
  for (const value of values) {
    if (!value && value !== 0) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return null;
}

function toArray(value) {
  if (!value && value !== 0) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  if (typeof value === 'object') return Object.values(value);
  return [value];
}

function uniqueStrings(values) {
  const set = new Set();
  values.forEach(value => {
    if (!value && value !== 0) return;
    const str = String(value).trim();
    if (!str) return;
    set.add(str);
  });
  return Array.from(set);
}

function* iterateValues(value) {
  if (!value && value !== 0) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      yield item;
    }
    return;
  }
  if (value instanceof Set) {
    for (const item of value) {
      yield item;
    }
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      yield item;
    }
    return;
  }
  yield value;
}
