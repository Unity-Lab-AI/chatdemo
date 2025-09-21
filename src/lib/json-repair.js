// Utilities to repair and normalize model outputs that mix JSON fragments
// with stray prose, smart quotes, or mildly malformed structures.

function replaceSmartQuotes(text) {
  if (text == null) return '';
  let s = String(text);
  // Common curly double quotes “ ” and others → "
  s = s.replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036]/g, '"');
  // Curly single quotes ‘ ’ and similar → " (JSON requires double quotes)
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u2039\u203A]/g, '"');
  // Full-width double quote
  s = s.replace(/[\uFF02]/g, '"');
  // Normalize backticks and straight apostrophes to double quotes (safer for JSON)
  s = s.replace(/[`']/g, '"');
  return s;
}

export function looseJsonParse(text) {
  if (text == null) return null;
  let s = replaceSmartQuotes(text).trim();
  // Remove surrounding code fences if any
  if (/^```/.test(s)) {
    s = s.replace(/^```[a-zA-Z0-9_-]*\s*\r?\n/, '');
    s = s.replace(/\r?\n?```\s*$/, '');
  }
  // Remove comments (best-effort)
  s = s.replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
  s = s.replace(/^\s*\/\/.*$/gm, ''); // line comments
  // Remove trailing commas
  s = s.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(s); } catch { return null; }
}

export function extractJsonObjectsAndStrayText(text) {
  const input = String(text || '');
  const s = replaceSmartQuotes(input);
  const objects = [];
  let stray = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '{') {
      stray += s[i++];
      continue;
    }
    // Found a potential JSON object start
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < s.length; j += 1) {
      const ch = s[j];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = false; continue; }
        continue;
      } else {
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') { depth += 1; continue; }
        if (ch === '}') {
          depth -= 1;
          if (depth === 0) { j += 1; break; }
          continue;
        }
      }
    }
    if (depth === 0) {
      const chunk = s.slice(i, j);
      const obj = looseJsonParse(chunk);
      if (obj && typeof obj === 'object') {
        objects.push(obj);
      } else {
        // If we failed to parse, consider it not JSON and add to stray
        stray += chunk;
      }
      i = j;
    } else {
      // Unbalanced; add the rest to stray and break
      stray += s.slice(i);
      break;
    }
  }

  // Clean up stray: collapse whitespace and remove trivial quote garbage
  const cleanedStray = stray
    .replace(/[\s\u200B\u200C\u200D\u2060\uFEFF]+/g, ' ')
    .replace(/^[\s"\u201C\u201D]+|[\s"\u201C\u201D]+$/g, '')
    .trim();
  return { objects, strayText: cleanedStray };
}

export function repairModelOutput(text, { coerce } = {}) {
  // coerce: function(obj) => { text, code[], images[] }
  const { objects, strayText } = extractJsonObjectsAndStrayText(text);
  const result = { text: '', code: [], images: [] };
  const hasMeaningfulStray = !!(strayText && /[\p{L}\p{N}]/u.test(strayText));
  if (hasMeaningfulStray) result.text = strayText;
  if (typeof coerce !== 'function') {
    // If no coerce provided, just return text + raw objects
    return { ...result, objects };
  }
  for (const obj of objects) {
    const payload = coerce(obj);
    if (!payload || typeof payload !== 'object') continue;
    // Merge text
    if (payload.text && payload.text.trim()) {
      if (!result.text) result.text = payload.text.trim();
      else if (!result.text.includes(payload.text.trim())) result.text += `\n\n${payload.text.trim()}`;
    }
    // Merge code
    if (Array.isArray(payload.code) && payload.code.length) {
      for (const block of payload.code) {
        if (!block) continue;
        const language = typeof block.language === 'string' ? block.language : '';
        const content = typeof block.content === 'string' ? block.content : (typeof block.code === 'string' ? block.code : '');
        if (content) result.code.push({ language, content });
      }
    }
    // Merge images
    if (Array.isArray(payload.images) && payload.images.length) {
      for (const img of payload.images) {
        if (img && typeof img.prompt === 'string' && img.prompt.trim()) result.images.push(img);
      }
    }
  }
  return result;
}

export default {
  replaceSmartQuotes,
  looseJsonParse,
  extractJsonObjectsAndStrayText,
  repairModelOutput,
};

