import * as shims from 'martian-node/_shims/index';
import * as fd from 'formdata-node';

test('martian-node/shims/node', () => {
  expect(shims.kind).toEqual('node');
  expect(shims.File).toBe(fd.File);
});
