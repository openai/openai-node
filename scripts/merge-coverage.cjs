const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { createContext } = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const coverageDirectory = join(__dirname, '..', 'coverage');
const coverageMap = createCoverageMap({});

for (const suite of ['unit', 'generated']) {
  const coveragePath = join(coverageDirectory, suite, 'coverage-final.json');
  const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'));
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
