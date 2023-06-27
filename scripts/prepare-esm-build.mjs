#!/usr/bin/env node

import fs from 'node:fs/promises';

// remove the following line from index.ts if present:
// - exports = module.exports = OpenAI
// export default OpenAI
const code = await fs.readFile('index.ts', 'utf8');
const transformed = code.replace(/^\s*exports\s*=\s*module.exports\s*=\s*(\w+)\s*;?\s*\n?/m, '');
if (transformed !== code) {
  await fs.writeFile('index.ts', transformed, 'utf8');
}
