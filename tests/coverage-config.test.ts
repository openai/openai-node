import { join } from 'node:path';
import jestConfig from '../jest.config';
import coverageConfig from '../jest.coverage.config';
import generatedTestPatterns from '../scripts/generated-test-patterns.json';

const coverageTransformer = require('../scripts/jest-coverage-transformer.cjs') as {
  process: (source: string, filename: string, options: Record<string, unknown>) => { code: string };
};

describe('Jest suite boundaries and coverage', () => {
  test('keeps the ordinary Jest configuration limited to canonical generated suites', () => {
    expect(jestConfig.testMatch).toEqual(
      generatedTestPatterns.map(
        (pattern) => `<rootDir>/${pattern}${pattern.endsWith('.test.ts') ? '' : '/**/*.test.ts'}`,
      ),
    );
    expect(jestConfig.moduleNameMapper).not.toHaveProperty('^vitest$');
  });

  test('collects every suite through a single V8 instrumenter only in coverage mode', () => {
    expect(coverageConfig.testMatch).toEqual(['<rootDir>/tests/**/*.test.ts']);
    expect(coverageConfig.coverageProvider).toBe('v8');
    expect(coverageConfig.collectCoverageFrom).toEqual(jestConfig.collectCoverageFrom);
    expect(coverageConfig.coverageThreshold).toEqual({
      global: {
        branches: 90,
        functions: 93,
        lines: 98,
        statements: 98,
      },
    });
    expect(coverageConfig.moduleNameMapper).toMatchObject({
      '^vitest$': '<rootDir>/scripts/vitest-jest-compat.cjs',
    });
    expect(coverageConfig.coverageReporters).toEqual(['text-summary', 'json-summary', 'lcov', 'json']);
  });

  test('hoists Vitest-compatible module mocks before transformed imports', () => {
    const vitestModule = ['vi', 'test'].join('');
    const mockMethod = ['vi', '.mock'].join('');
    const source = `import { vi } from '${vitestModule}';\n${mockMethod}('dependency', () => ({ value: vi.fn() }));`;
    const transformed = coverageTransformer.process(
      source,
      join(process.cwd(), 'tests/coverage-transformer.test.ts'),
      {
        cacheFS: new Map(),
        config: { cwd: process.cwd(), rootDir: process.cwd() },
        configString: '{}',
        instrument: false,
        supportsDynamicImport: false,
        supportsExportNamespaceFrom: false,
        supportsStaticESM: false,
        supportsTopLevelAwait: false,
      },
    );

    const mockIndex = transformed.code.indexOf('jest.mock(');
    const importIndex = transformed.code.indexOf('require("vitest")');

    expect(mockIndex).toBeGreaterThanOrEqual(0);
    expect(importIndex).toBeGreaterThan(mockIndex);
  });
});
