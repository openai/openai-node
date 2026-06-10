const fs = require('fs');
const reportPath = '.attw-report.json';
const problems = Object.values(JSON.parse(fs.readFileSync(reportPath, 'utf-8')).problems)
  .flat()
  .filter(
    (problem) =>
      !(
        // This is intentional, if the user specifies .mjs they get ESM.
        (
          (problem.kind === 'CJSResolvesToESM' && problem.entrypoint.endsWith('.mjs')) ||
          // This is intentional for backwards compat reasons.
          (problem.kind === 'MissingExportEquals' && problem.implementationFileName.endsWith('/index.js')) ||
          // this is intentional, we deliberately attempt to import types that may not exist from parent node_modules
          // folders to better support various runtimes without triggering automatic type acquisition.
          (problem.kind === 'InternalResolutionError' && problem.moduleSpecifier.includes('node_modules'))
        )
      ),
  );
fs.unlinkSync(reportPath);
if (problems.length) {
  process.stdout.write('The types are wrong!\n' + JSON.stringify(problems, null, 2) + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Types ok!\n');
}
