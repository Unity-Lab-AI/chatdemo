import assert from 'node:assert/strict';
import { generateSeed } from '../src/seed.js';

export const name = 'Seed generator produces eight-digit integers';

export async function run() {
  const minimum = generateSeed(() => 0);
  const maximum = generateSeed(() => 0.999999999999);
  const clampHigh = generateSeed(() => 1.5);
  const clampLow = generateSeed(() => -0.5);
  const mid = generateSeed(() => 0.42);

  for (const value of [minimum, maximum, clampHigh, clampLow, mid]) {
    assert(Number.isInteger(value), `Seed should be an integer (received ${value})`);
    assert(value >= 10_000_000 && value <= 99_999_999, `Seed ${value} must be eight digits`);
    assert.equal(String(value).length, 8, `Seed ${value} should contain exactly eight digits`);
  }

  assert.equal(minimum, 10_000_000);
  assert.equal(maximum, 99_999_999);
  assert.equal(clampHigh, 99_999_999);
  assert.equal(clampLow, 10_000_000);
}
