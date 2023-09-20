// shouldn't need extension, but Jest's ESM module resolution is broken
import 'openai/shims/node.mjs';
import * as shims from 'openai/_shims/index';

test('openai/shims/node', () => {
  expect(shims.kind).toEqual('node');
});
