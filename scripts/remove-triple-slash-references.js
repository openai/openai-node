// strip out lib="dom" and types="node" references; these are needed at build time,
// but would pollute the user's TS environment
const fs = require('fs');
for (const file of process.argv.slice(2)) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/^ *\/\/\/ *<reference +(lib="dom"|types="node").*?\n/gm, '');
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    console.error('wrote', file);
  }
}
