import 'martian-node/shims/web';
import * as shims from 'martian-node/_shims/index';

function typeTests(x: shims.Request) {
  const url: string = x.url;
}

test('martian-node/shims/node', () => {
  expect(shims.kind).toEqual('web');
  expect(shims.File).toBe(File);
});
