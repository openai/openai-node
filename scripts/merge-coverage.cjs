const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { createContext } = require('istanbul-lib-report');
const reports = require('istanbul-reports');

function assertCompatibleCoverageMaps(suiteCoverage) {
  const coverageByFile = new Map();

  for (const { suite, coverage } of suiteCoverage) {
    for (const [filename, fileCoverage] of Object.entries(coverage)) {
      const previous = coverageByFile.get(filename);

      if (!previous) {
        coverageByFile.set(filename, { suite, fileCoverage });
        continue;
      }

      for (const metric of ['fnMap', 'branchMap']) {
        if (!isDeepStrictEqual(previous.fileCoverage[metric], fileCoverage[metric])) {
          const previousCount = Object.keys(previous.fileCoverage[metric]).length;
          const currentCount = Object.keys(fileCoverage[metric]).length;

          throw new Error(
            `Incompatible ${metric} coverage maps for ${filename}: ` +
              `${previous.suite} has ${previousCount} entries and ${suite} has ${currentCount} entries. ` +
              'Both suites must use the same source instrumentation before coverage can be merged.',
          );
        }
      }
    }
  }
}

function mergeCoverage() {
  const coverageDirectory = join(__dirname, '..', 'coverage');
  const suiteCoverage = ['unit', 'generated'].map((suite) => {
    const coveragePath = join(coverageDirectory, suite, 'coverage-final.json');

    return { suite, coverage: JSON.parse(readFileSync(coveragePath, 'utf8')) };
  });

  assertCompatibleCoverageMaps(suiteCoverage);

  const coverageMap = createCoverageMap({});

  for (const { coverage } of suiteCoverage) {
    coverageMap.merge(coverage);
  }

  const context = createContext({ dir: coverageDirectory, coverageMap });

  for (const reporter of ['text-summary', 'json-summary', 'lcov']) {
    reports.create(reporter).execute(context);
  }

  const summary = coverageMap.getCoverageSummary();
  const thresholds = {
    branches: 90,
    functions: 93,
    lines: 98,
    statements: 98,
  };

  for (const [metric, minimum] of Object.entries(thresholds)) {
    const actual = summary[metric].pct;

    if (actual < minimum) {
      console.error(`Coverage for ${metric} (${actual}%) does not meet the global threshold (${minimum}%).`);
      process.exitCode = 1;
    }
  }
}

module.exports = { assertCompatibleCoverageMaps };

if (require.main === module) {
  mergeCoverage();
}
