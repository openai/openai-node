import { fork } from 'child_process';
import { join } from 'path';
import { Config, Target } from './config';
import { WorkerOptions } from './worker/types';
import { Stream } from 'stream';
import { trimPrefix } from './utils';
import { getReportStyles } from './report';
import onExit from 'signal-exit';
import pAll from 'p-all';
import debug from './debug';

const WORKER_PATH = join(__dirname, 'worker/entry.ts');
const TS_NODE_REGISTER = require.resolve('ts-node/register/transpile-only');
const WORKER_TS_NODE_ENV = {
  TS_NODE_SKIP_PROJECT: 'true',
  TS_NODE_COMPILER_OPTIONS: JSON.stringify({
    esModuleInterop: true,
    module: 'commonjs',
    moduleResolution: 'node',
    target: 'es2020',
  }),
};
const DEFAULT_EXTNAME = '.js';

type Stdio = 'ignore' | 'inherit' | Stream;

function validateTargets(targets: readonly Target[]) {
  const extnames = targets.map((target) => target.extname || DEFAULT_EXTNAME);
  const extMap = new Map<string, number>();

  for (let i = 0; i < extnames.length; i++) {
    const ext = extnames[i];

    if (!ext.startsWith('.')) {
      throw new Error(`targets[${i}].extname must be started with ".".`);
    }

    const existedIndex = extMap.get(ext);

    if (existedIndex != null) {
      throw new Error(`targets[${i}].extname is already used in targets[${existedIndex}].extname`);
    }

    extMap.set(ext, i);
  }
}

async function runWorker({
  stdout,
  stderr,
  ...options
}: WorkerOptions & Pick<BuildOptions, 'stdout' | 'stderr'>): Promise<number> {
  const worker = fork(WORKER_PATH, [], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...WORKER_TS_NODE_ENV,
    },
    execArgv: ['--require', TS_NODE_REGISTER],
    stdio: ['pipe', stdout, stderr, 'ipc'],
  });

  if (worker.stdin) {
    worker.stdin.end(JSON.stringify(options));
  }

  const removeExitHandler = onExit((code, signal) => {
    debug(`Killing worker ${worker.pid} because parent process received ${signal || code || 0}`);

    worker.kill(code || 'SIGTERM');
  });

  try {
    return await new Promise<number>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('exit', resolve);
    });
  } finally {
    removeExitHandler();
  }
}

export interface BuildOptions extends Config {
  watch?: boolean;
  clean?: boolean;
  verbose?: boolean;
  dry?: boolean;
  force?: boolean;
  stdout?: Stdio;
  stderr?: Stdio;
  maxWorkers?: number;
}

export async function build({
  targets: inputTargets,
  stdout = 'inherit',
  stderr = 'inherit',
  projects,
  maxWorkers,
  ...options
}: BuildOptions): Promise<number> {
  if (!projects.length) {
    throw new Error('At least one project is required');
  }

  const targets: readonly Target[] = inputTargets && inputTargets.length ? inputTargets : [{}];

  validateTargets(targets);

  const reportStyles = getReportStyles();

  const codes = await pAll(
    targets.map(({ extname, transpileOnly, shareHelpers, pureClassAssignment, ...target }, i) => {
      const prefix = `[${trimPrefix(extname || DEFAULT_EXTNAME, '.')}]: `;
      const prefixStyle = reportStyles[i % reportStyles.length];

      return () => {
        return runWorker({
          ...options,
          projects,
          stdout,
          stderr,
          extname,
          shareHelpers,
          pureClassAssignment,
          target,
          reportPrefix: prefixStyle(prefix),
          transpileOnly,
        });
      };
    }),
    { concurrency: maxWorkers },
  );

  return codes.find((code) => code !== 0) || 0;
}
