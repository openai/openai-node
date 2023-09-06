// strip out `unknown extends RequestInit ? never :` from dist/src/_shims;
// these cause problems when viewing the .ts source files in go to definition
const fs = require('fs');
for (const file of process.argv.slice(2)) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(
    new RegExp('unknown extends (typeof )?\\S+ \\? \\S+ :\\s*'.replace(/\s+/, '\\s+'), 'gm'),
    '',
  );
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    console.error('wrote', file);
  }
}
