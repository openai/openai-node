const { assertCompatibleCoverageMaps } = require('../scripts/merge-coverage.cjs') as {
  assertCompatibleCoverageMaps: (
    suiteCoverage: { suite: string; coverage: Record<string, unknown> }[],
  ) => void;
};

const filename = '/src/example.ts';

function createFileCoverage() {
  const location = {
    start: { line: 1, column: 0 },
    end: { line: 1, column: 1 },
  };

  return {
    path: filename,
    statementMap: { 0: location },
    fnMap: { 0: { name: 'example', decl: location, loc: location } },
    branchMap: { 0: { type: 'if', loc: location, locations: [location, location] } },
    s: { 0: 1 },
    f: { 0: 1 },
    b: { 0: [1, 0] },
  };
}

describe('scripts/merge-coverage', () => {
  test('accepts coverage maps emitted from the same function and branch instrumentation', () => {
    expect(() =>
      assertCompatibleCoverageMaps([
        { suite: 'unit', coverage: { [filename]: createFileCoverage() } },
        { suite: 'generated', coverage: { [filename]: createFileCoverage() } },
      ]),
    ).not.toThrow();
  });

  test.each(['fnMap', 'branchMap'] as const)('rejects incompatible %s shapes before merging', (metric) => {
    const generatedCoverage = createFileCoverage();
    delete (generatedCoverage[metric] as Record<string, unknown>)['0'];

    expect(() =>
      assertCompatibleCoverageMaps([
        { suite: 'unit', coverage: { [filename]: createFileCoverage() } },
        { suite: 'generated', coverage: { [filename]: generatedCoverage } },
      ]),
    ).toThrow(
      `Incompatible ${metric} coverage maps for ${filename}: unit has 1 entries and generated has 0 entries.`,
    );
  });

  test('rejects equal-sized maps that identify different source locations', () => {
    const generatedCoverage = createFileCoverage();
    generatedCoverage.fnMap[0].loc.start.line = 2;

    expect(() =>
      assertCompatibleCoverageMaps([
        { suite: 'unit', coverage: { [filename]: createFileCoverage() } },
        { suite: 'generated', coverage: { [filename]: generatedCoverage } },
      ]),
    ).toThrow('Incompatible fnMap coverage maps');
  });

  test('allows files collected by only one suite', () => {
    expect(() =>
      assertCompatibleCoverageMaps([
        { suite: 'unit', coverage: { [filename]: createFileCoverage() } },
        { suite: 'generated', coverage: {} },
      ]),
    ).not.toThrow();
  });
});
