import { createRequire } from 'node:module';

export interface CoverageDeclaration {
  file: string;
  line: number;
  column: number;
  kind: string;
  name: string;
  documented: boolean;
}

const loadCoverageChecker = createRequire(`${process.cwd()}/package.json`);

export const { collectCoverage, inspectSource } = loadCoverageChecker(
  './scripts/check-jsdoc-coverage.cjs',
) as {
  collectCoverage: () => {
    files: number;
    declarations: CoverageDeclaration[];
    undocumented: CoverageDeclaration[];
  };
  inspectSource: (
    file: string,
    source: string,
    dependencies?: Record<string, string>,
  ) => CoverageDeclaration[];
};

export function missing(source: string): string[] {
  return inspectSource('src/fixture.ts', source)
    .filter((declaration) => !declaration.documented)
    .map((declaration) => declaration.name);
}
