import { runInNewContext } from 'node:vm';
import { configuredOption } from 'openai/internal/runner-lifecycle';
import { isObj } from 'openai/internal/utils/values';
import { expect, test } from 'vitest';

function foreign(source: string) {
  const value: unknown = runInNewContext(source);
  if (!isObj(value)) {
    throw new Error('Expected an object fixture');
  }
  return value;
}

test('configuration excludes the native base prototype in another realm', () => {
  const value = foreign('({})');
  expect(configuredOption(value, 'toString')).toBeUndefined();
  expect(configuredOption(value, 'constructor')).toBeUndefined();
});

test('configuration preserves foreign class getters and their receiver', () => {
  const value = foreign('new class { #value = "configured"; get policy() { return this.#value; } }');
  expect(configuredOption(value, 'policy')).toBe('configured');
});

test.each([
  'Object.assign(Object.create(null), { policy: "configured" })',
  'Object.create(Object.assign(Object.create(null), { policy: "configured" }))',
  'new class extends null { constructor() { return Object.create(new.target.prototype); } get policy() { return "configured"; } }',
])('configuration preserves explicit null-prototype owners: %s', (source) => {
  expect(configuredOption(foreign(source), 'policy')).toBe('configured');
});

test('configuration does not invoke a terminal owner constructor getter', () => {
  const value = foreign(
    'Object.create(Object.create(null, { constructor: { get() { throw new Error("unused constructor"); } }, policy: { value: "configured" } }))',
  );
  expect(configuredOption(value, 'policy')).toBe('configured');
});
