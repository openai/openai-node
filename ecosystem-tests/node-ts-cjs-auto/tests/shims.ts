import * as shims from 'openai/_shims/index';
import * as fd from 'formdata-node';

test('openai/shims/node', () => {
  expect(shims.kind).toEqual('node');
  expect(shims.File).toBe(fd.File);
});
