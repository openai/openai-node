/* oxlint-disable max-classes-per-file -- Separate classes model distinct native realms. */
import { vi } from 'vitest';

test('selects a branded value realm before reading Headers storage', async () => {
  const branded = Symbol('branded Headers');
  const authorization = Symbol('authorization');
  class Headers {
    has(this: { [branded]?: boolean }) {
      if (!this[branded]) {
        throw new TypeError('Illegal invocation');
      }
      return true;
    }

    get(this: { [authorization]?: string }) {
      return this[authorization] ?? 'Bearer local';
    }

    *entries(this: { [authorization]?: string }) {
      yield ['Authorization', this[authorization] ?? 'Bearer local'];
    }
  }
  Object.defineProperties(Headers.prototype, {
    [Symbol.iterator]: { value: Headers.prototype.entries },
    [Symbol.toStringTag]: { value: 'Headers' },
  });
  class ForeignHeaders {
    get(this: { [authorization]?: string }) {
      return this[authorization] ?? null;
    }

    *entries(this: { [authorization]?: string }) {
      const value = this[authorization];
      if (value !== undefined) {
        yield ['Authorization', value];
      }
    }
  }
  Object.defineProperty(ForeignHeaders, 'name', { value: 'Headers' });
  Object.defineProperties(ForeignHeaders.prototype, {
    [Symbol.iterator]: { value: ForeignHeaders.prototype.entries },
    [Symbol.toStringTag]: { value: 'Headers' },
  });
  const foreign = Object.assign(Object.create(ForeignHeaders.prototype), {
    [branded]: true,
    [authorization]: 'Bearer foreign',
  });
  let reads = 0;
  Object.defineProperty(foreign, 'get', {
    get() {
      reads += 1;
      throw new Error('Shadowed get must not run');
    },
  });
  vi.stubGlobal('Headers', Headers);
  vi.resetModules();
  try {
    const { getPlatformHeader } = await import('../../src/internal/platform-headers');

    expect(getPlatformHeader(foreign, 'Authorization')).toMatchObject({ value: 'Bearer foreign' });
    expect(reads).toBe(0);
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
