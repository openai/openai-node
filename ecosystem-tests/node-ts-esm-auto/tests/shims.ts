import * as shims from 'martian-node/_shims/index';

test('martian-node/shims/node', () => {
  expect(shims.kind).toEqual('node');
});
