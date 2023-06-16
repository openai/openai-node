import fs from 'fs';

const main = () => {
  const pkg = JSON.parse(fs.readFileSync('package.json').toString()) as Record<string, unknown>;
  const version = pkg['version'];
  if (!version) throw 'The version property is not set in the package.json file';
  if (typeof version !== 'string') {
    throw `Unexpected type for the package.json version field; got ${typeof version}, expected string`;
  }

  const contents = fs.readFileSync('version.ts', 'utf8');
  const output = contents.replace(/(export const VERSION = ')(.*)(')/g, `$1${version}$3`);
  fs.writeFileSync('version.ts', output);
};

if (require.main === module) {
  main();
}
