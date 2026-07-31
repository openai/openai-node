import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import v8Coverage from '@vitest/coverage-v8';
import { V8CoverageProvider } from '@vitest/coverage-v8/dist/provider.js';
import v8ToIstanbul from 'v8-to-istanbul';

class JestCompatibleV8CoverageProvider extends V8CoverageProvider {
  async remapCoverage(filename, wrapperLength, result, functions) {
    const sourcePath = fileURLToPath(filename);
    const originalSource = readFileSync(sourcePath, 'utf8');
    const sources = {
      originalSource,
      source: result.code,
      ...(result.map ? { sourceMap: { sourcemap: { file: sourcePath, ...result.map } } } : {}),
    };
    const converter = v8ToIstanbul(sourcePath, wrapperLength, sources);

    await converter.load();
    converter.applyCoverage(
      functions.length ? functions : (
        [
          {
            functionName: '(empty-report)',
            isBlockCoverage: true,
            ranges: [{ count: 0, startOffset: 0, endOffset: result.code.length }],
          },
        ]
      ),
    );

    return converter.toIstanbul();
  }
}

export default {
  ...v8Coverage,
  getProvider: () => new JestCompatibleV8CoverageProvider(),
};
