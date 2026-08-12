const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../../package.json');

const main = () => {
  const version = pkg['version'];
  if (!version) {
    throw new Error('The version property is not set in the package.json file');
  }
  if (typeof version !== 'string') {
    throw new TypeError(
      `Unexpected type for the package.json version field; got ${typeof version}, expected string`,
    );
  }

  const versionFile = path.resolve(__dirname, '..', '..', 'src', 'version.ts');
  const contents = fs.readFileSync(versionFile, 'utf-8');
  const output = contents.replaceAll(/(export const VERSION = ')(.*)(')/g, `$1${version}$3`);
  fs.writeFileSync(versionFile, output);
};

if (require.main === module) {
  main();
}
