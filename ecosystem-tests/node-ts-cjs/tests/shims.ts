import 'martian-node/shims/node';
import * as shims from 'martian-node/_shims/index';
import * as fd from 'formdata-node';

function typeTests(x: shims.Request) {
  const url: string = x.url;
}

test('martian-node/shims/node', () => {
  expect(shims.kind).toEqual('node');
  expect(shims.File).toBe(fd.File);
});
