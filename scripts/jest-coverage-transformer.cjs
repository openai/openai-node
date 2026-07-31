const { createTransformer } = require('@swc/jest');

const transformer = createTransformer({ sourceMaps: 'inline' });

function normalizeVitestMocks(source, filename) {
  if (!filename.includes('/tests/') || !/from\s*['"]vitest['"]/.test(source)) {
    return source;
  }

  return source.replaceAll('vi.mock(', 'jest.mock(');
}

module.exports = {
  ...transformer,

  process(source, filename, options) {
    return transformer.process(normalizeVitestMocks(source, filename), filename, options);
  },

  async processAsync(source, filename, options) {
    return transformer.processAsync(normalizeVitestMocks(source, filename), filename, options);
  },
};
