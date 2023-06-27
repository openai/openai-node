#!/usr/bin/env node

import fs from 'node:fs/promises';

// add the following line back to index.ts if necessary:
// + exports = module.exports = OpenAI
// export default OpenAI
const code = await fs.readFile('index.ts', 'utf8');
if (!/^\s*exports\s*=\s*module.exports\s*=\s*(\w+)/m.test(code)) {
  await fs.writeFile(
    'index.ts',
    code.replace(/\n?\s*export\s+default\s+(\w+)/m, '\nexports = module.exports = $1;\nexport default $1'),
    'utf8',
  );
}
