const { jest: jestObject } = require('@jest/globals');

function doMock(moduleName, factory, options) {
  if (typeof factory !== 'function') {
    return jestObject.doMock(moduleName, factory, options);
  }

  return jestObject.doMock(
    moduleName,
    (...args) => {
      try {
        return factory(...args);
      } catch (cause) {
        throw new Error(cause instanceof Error ? cause.message : String(cause), { cause });
      }
    },
    options,
  );
}

module.exports = {
  vi: {
    ...jestObject,
    doMock,
    doUnmock: jestObject.dontMock,
  },
};
