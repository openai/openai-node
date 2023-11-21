// shouldn't need extension, but Jest's ESM module resolution is broken
import 'martian-node/shims/web.mjs';
import * as shims from 'martian-node/_shims/index';

function typeTests(x: shims.Request) {
  const url: string = x.url;
}

test('martian-node/shims/node', () => {
  expect(shims.kind).toEqual('web');
  expect(shims.File).toEqual(File);
});
