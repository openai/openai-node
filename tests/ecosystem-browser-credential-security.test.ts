import { readFileSync } from 'node:fs';
import path from 'node:path';

const browserSuites = [
  ['browser-direct-import', 'src/test.ts', 'public/index.js', 'http://localhost:8081'],
  ['ts-browser-webpack', 'src/test.ts', 'src/index.ts', 'http://localhost:8080'],
] as const;

describe.each(browserSuites)('%s browser credential security', (suite, driver, fixture, origin) => {
  const driverSource = readFileSync(path.join(process.cwd(), 'ecosystem-tests', suite, driver), 'utf-8');
  const fixtureSource = readFileSync(path.join(process.cwd(), 'ecosystem-tests', suite, fixture), 'utf-8');

  test('preloads an immutable, nonenumerable credential only on the exact expected origin', () => {
    expect(driverSource).toContain(`const origin = '${origin}'`);
    expect(driverSource).toMatch(/if\s*\(location\.origin !== expectedOrigin\)\s*\{\s*return;/u);
    expect(driverSource).toContain("Object.defineProperty(globalThis, '__OPENAI_ECOSYSTEM_TEST_API_KEY__'");
    expect(driverSource).toContain('value: key');
    expect(driverSource).toContain('configurable: false');
    expect(driverSource).toContain('enumerable: false');
    expect(driverSource).toContain('writable: false');
    expect(driverSource).toMatch(/\},\s*apiKey,\s*origin,\s*\);/u);
  });

  test('installs the preload before navigating without a credential in the URL', () => {
    const preload = driverSource.indexOf('await page.evaluateOnNewDocument(');
    const navigation = driverSource.indexOf('await page.goto(');

    expect(preload).toBeGreaterThanOrEqual(0);
    expect(navigation).toBeGreaterThan(preload);
    expect(driverSource).toMatch(/await page\.goto\(`\$\{origin\}\/index\.html`\);/u);
    expect(driverSource).not.toMatch(/(?:\?|&)apiKey=/u);
  });

  test('reads the same preloaded credential in the real browser fixture', () => {
    expect(fixtureSource).toContain(').__OPENAI_ECOSYSTEM_TEST_API_KEY__');
    expect(fixtureSource).toContain('new OpenAI({ apiKey, dangerouslyAllowBrowser: true })');
    expect(fixtureSource).not.toMatch(/URLSearchParams|location\.search/u);
  });
});
