import { runInNewContext } from 'node:vm';
import { configuredOption, overlayRequestOptions } from 'openai/internal/runner-lifecycle';
import type { RequestOptions } from 'openai/internal/request-options';
import { isObj } from 'openai/internal/utils/values';
import { expect, test } from 'vitest';

function foreign(source: string) {
  const value: unknown = runInNewContext(source);
  if (!isObj(value)) {
    throw new Error('Expected an object fixture');
  }
  return value;
}

test('repeated freezing retains the overlay keys captured before source changes', () => {
  const source: RequestOptions = { timeout: 1000 };
  const view = overlayRequestOptions(source, { signal: new AbortController().signal });
  Object.preventExtensions(view);
  source.maxRetries = 0;
  expect(() => Object.freeze(view)).not.toThrow();
  expect(Object.keys(view)).toEqual(['timeout', 'signal']);
  expect('maxRetries' in view).toBe(false);
});

test('frozen overlays keep accessor writes separate from the caller', () => {
  let timeout = 1000;
  const source: RequestOptions = {
    get timeout() {
      return timeout;
    },
    set timeout(value) {
      timeout = value ?? 0;
    },
  };
  Object.freeze(source);
  const view = overlayRequestOptions(source, { signal: new AbortController().signal });
  Object.freeze(view);
  view.timeout = 2000;
  expect(view.timeout).toBe(2000);
  expect(source.timeout).toBe(1000);
});

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
