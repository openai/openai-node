// shouldn't need extension, but Jest's ESM module resolution is broken
import 'martian-node/shims/node.mjs';
import * as shims from 'martian-node/_shims/index';

test('martian-node/shims/node', () => {
  expect(shims.kind).toEqual('node');
});
