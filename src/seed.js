const MIN_SEED = 10_000_000;
const MAX_SEED = 99_999_999;

export function generateSeed(random = Math.random) {
  const fn = typeof random === 'function' ? random : Math.random;
  const value = fn();
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999999, value)) : 0;
  const span = MAX_SEED - MIN_SEED + 1;
  return Math.floor(clamped * span + MIN_SEED);
}
