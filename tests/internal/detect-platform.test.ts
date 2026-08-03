import { vi } from 'vitest';

type PlatformModule = typeof import('openai/internal/detect-platform');

type PlatformGlobals = {
  Deno?: unknown;
  EdgeRuntime?: unknown;
  navigator?: unknown;
  process?: unknown;
  window?: unknown;
};

async function withGlobals<T>(overrides: PlatformGlobals, run: (detection: PlatformModule) => T): Promise<T> {
  vi.resetModules();
  const detection = await import('openai/internal/detect-platform');
  const descriptors = new Map<string, PropertyDescriptor | undefined>();

  try {
    for (const [name, value] of Object.entries(overrides)) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      if (value === undefined) {
        delete (globalThis as Record<string, unknown>)[name];
      } else {
        Object.defineProperty(globalThis, name, { configurable: true, value });
      }
    }

    return run(detection);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
}

describe('platform detection', () => {
  test('memoizes platform headers for repeated calls', async () => {
    await withGlobals({}, ({ getPlatformHeaders }) => {
      expect(getPlatformHeaders()).toBe(getPlatformHeaders());
    });
  });

  test.each([
    ['linux', 'x86_64', 'Linux', 'x64'],
    ['darwin', 'x64', 'MacOS', 'x64'],
    ['win32', 'x32', 'Windows', 'x32'],
    ['ios-device', 'arm64', 'iOS', 'arm64'],
    ['android', 'aarch64', 'Android', 'arm64'],
    ['freebsd', 'arm', 'FreeBSD', 'arm'],
    ['openbsd', 'riscv64', 'OpenBSD', 'other:riscv64'],
    ['custom', 'mips', 'Other:custom', 'other:mips'],
    ['', '', 'Unknown', 'unknown'],
  ])(
    'normalizes Deno operating system %s and architecture %s',
    async (os, arch, expectedOS, expectedArch) => {
      const headers = await withGlobals(
        { Deno: { build: { os, arch }, version: { deno: '2.0.0' } } },
        ({ getPlatformHeaders }) => getPlatformHeaders(),
      );

      expect(headers).toMatchObject({
        'X-Stainless-Lang': 'js',
        'X-Stainless-OS': expectedOS,
        'X-Stainless-Arch': expectedArch,
        'X-Stainless-Runtime': 'deno',
        'X-Stainless-Runtime-Version': '2.0.0',
      });
    },
  );

  test.each([
    ['2.1.0', '2.1.0'],
    [undefined, 'unknown'],
  ])('accepts string or missing Deno runtime version metadata', async (version, expected) => {
    const headers = await withGlobals(
      { Deno: { build: { os: 'linux', arch: 'x64' }, version } },
      ({ getPlatformHeaders }) => getPlatformHeaders(),
    );

    expect(headers['X-Stainless-Runtime-Version']).toBe(expected);
  });

  test('detects edge runtimes and retains their runtime versions', async () => {
    const headers = await withGlobals({ EdgeRuntime: 'vercel' }, ({ getPlatformHeaders }) =>
      getPlatformHeaders(),
    );

    expect(headers).toMatchObject({
      'X-Stainless-OS': 'Unknown',
      'X-Stainless-Arch': 'other:vercel',
      'X-Stainless-Runtime': 'edge',
      'X-Stainless-Runtime-Version': process.version,
    });
  });

  test('detects Node.js platforms and handles missing process metadata', async () => {
    const fakeProcess = {
      [Symbol.toStringTag]: 'process',
      platform: undefined,
      arch: undefined,
      version: undefined,
    };
    const headers = await withGlobals({ process: fakeProcess }, ({ getPlatformHeaders }) =>
      getPlatformHeaders(),
    );

    expect(headers).toMatchObject({
      'X-Stainless-OS': 'Other:unknown',
      'X-Stainless-Arch': 'other:unknown',
      'X-Stainless-Runtime': 'node',
      'X-Stainless-Runtime-Version': 'unknown',
    });
  });

  test.each([
    ['Edge/105.3.1', 'edge', '105.3.1'],
    ['MSIE 11.0', 'ie', '11.0.0'],
    ['Trident/7.0; rv:11.2', 'ie', '11.2.0'],
    ['Chrome/126.5.2', 'chrome', '126.5.2'],
    ['Firefox/127.4', 'firefox', '127.4.0'],
    ['Version/17.3 Safari/605', 'safari', '17.3.0'],
    ['Mozilla Safari', 'safari', '0.0.0'],
  ])('identifies %s browser user agents', async (userAgent, browser, version) => {
    const headers = await withGlobals(
      { process: undefined, navigator: { userAgent } },
      ({ getPlatformHeaders }) => getPlatformHeaders(),
    );

    expect(headers).toMatchObject({
      'X-Stainless-OS': 'Unknown',
      'X-Stainless-Arch': 'unknown',
      'X-Stainless-Runtime': `browser:${browser}`,
      'X-Stainless-Runtime-Version': version,
    });
  });

  test.each([{ userAgent: 'unrecognized browser' }, null, undefined])(
    'returns unknown runtime information when no platform is recognizable',
    async (navigator) => {
      const headers = await withGlobals({ process: undefined, navigator }, ({ getPlatformHeaders }) =>
        getPlatformHeaders(),
      );

      expect(headers).toMatchObject({
        'X-Stainless-OS': 'Unknown',
        'X-Stainless-Arch': 'unknown',
        'X-Stainless-Runtime': 'unknown',
        'X-Stainless-Runtime-Version': 'unknown',
      });
    },
  );

  test.each([
    [{ document: {} }, { userAgent: 'browser' }, true],
    [undefined, { userAgent: 'browser' }, false],
    [{}, { userAgent: 'browser' }, false],
    [{ document: {} }, undefined, false],
  ])(
    'detects browser globals only when document and navigator are available',
    async (window, navigator, expected) => {
      expect(await withGlobals({ window, navigator }, ({ isRunningInBrowser }) => isRunningInBrowser())).toBe(
        expected,
      );
    },
  );
});
