import * as shims from 'openai/_shims/index';

test('openai/shims/node', () => {
  expect(shims.kind).toEqual('node');
});
