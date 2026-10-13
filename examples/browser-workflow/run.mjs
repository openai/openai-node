import { parseArgs } from 'node:util';
import { main } from './workflow.mjs';

const args = parseArgs({
  options: {
    mode: { type: 'string', default: 'run' },
    api: { type: 'string', default: 'responses' },
    fixture: { type: 'string', default: 'A' },
    data: { type: 'string' },
    receipt: { type: 'string' },
    headed: { type: 'boolean', default: false },
  },
});
if (!['run', 'serve'].includes(args.values.mode) || !['responses', 'decisions'].includes(args.values.api)) {
  throw new Error('Use --mode run|serve and --api responses|decisions.');
}
await main(args);
