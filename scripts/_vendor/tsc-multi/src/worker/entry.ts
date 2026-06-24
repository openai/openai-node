import { text } from 'stream/consumers';
import debug from './debug';
import { Worker } from './worker';
import { WorkerOptions } from './types';

async function loadWorkerData(): Promise<WorkerOptions> {
  const stdin = await text(process.stdin);
  return JSON.parse(stdin);
}

(async () => {
  debug('Worker started');

  const data = await loadWorkerData();
  debug('Target', data.target);

  const worker = new Worker(data);
  process.exitCode = await worker.run();
})().catch((err) => {
  console.error(err);
  process.exitCode ||= 1;
});
