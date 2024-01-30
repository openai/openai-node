import fs from 'fs/promises';
import execa from 'execa';
import yargs from 'yargs';
import assert from 'assert';
import path from 'path';

const TAR_NAME = 'openai.tgz';
const PACK_FILE = `.pack/${TAR_NAME}`;
const IS_CI = Boolean(process.env['CI'] && process.env['CI'] !== 'false');

async function defaultNodeRunner() {
  await installPackage();
  await run('npm', ['run', 'tsc']);
  if (state.live) await run('npm', ['test']);
}

const projects = {
  'node-ts-cjs': defaultNodeRunner,
  'node-ts-cjs-web': defaultNodeRunner,
  'node-ts-cjs-auto': defaultNodeRunner,
  'node-ts4.5-jest27': defaultNodeRunner,
  'node-ts-esm': defaultNodeRunner,
  'node-ts-esm-web': defaultNodeRunner,
  'node-ts-esm-auto': defaultNodeRunner,
  'ts-browser-webpack': async () => {
    await installPackage();

    await run('npm', ['run', 'tsc']);
    await run('npm', ['run', 'build']);

    if (state.live) {
      await run('npm', ['run', 'test:ci']);
    }
  },
  'vercel-edge': async () => {
    await installPackage();

    if (state.live) {
      await run('npm', ['run', 'test:ci:dev']);
    }
    await run('npm', ['run', 'build']);

    if (state.live) {
      await run('npm', ['run', 'test:ci']);
    }
    if (state.deploy) {
      await run('npm', ['run', 'vercel', 'deploy', '--prod', '--force']);
    }
  },
  'cloudflare-worker': async () => {
    await installPackage();

    await run('npm', ['run', 'tsc']);

    if (state.live) {
      await run('npm', ['run', 'test:ci']);
    }
    if (state.deploy) {
      await run('npm', ['run', 'deploy']);
    }
  },
  bun: async () => {
    if (state.fromNpm) {
      await run('bun', ['install', '-D', state.fromNpm]);
      return;
    }

    const packFile = getPackFile();
    await fs.copyFile(packFile, `./${TAR_NAME}`);
    await run('bun', ['install', '-D', `./${TAR_NAME}`]);

    await run('npm', ['run', 'tsc']);

    if (state.live) {
      await run('bun', ['test']);
    }
  },
  deno: async () => {
    await run('deno', ['task', 'install']);
    await installPackage();
    const packFile = getPackFile();

    const openaiDir = path.resolve(
      process.cwd(),
      'node_modules',
      '.deno',
      'openai@3.3.0',
      'node_modules',
      'openai',
    );

    await run('sh', ['-c', 'rm -rf *'], { cwd: openaiDir, stdio: 'inherit' });
    await run('tar', ['xzf', path.resolve(packFile)], { cwd: openaiDir, stdio: 'inherit' });
    await run('sh', ['-c', 'mv package/* .'], { cwd: openaiDir, stdio: 'inherit' });
    await run('sh', ['-c', 'rm -rf package'], { cwd: openaiDir, stdio: 'inherit' });

    await run('deno', ['task', 'check']);
    if (state.live) await run('deno', ['task', 'test']);
  },
};

const projectNames = Object.keys(projects) as Array<keyof typeof projects>;
const projectNamesSet = new Set(projectNames);

function parseArgs() {
  return yargs(process.argv.slice(2))
    .scriptName('ecosystem-tests')
    .usage('run tests using various different project setups')

    .positional('projects', {
      type: 'string',
      array: true,
      choices: projectNames,
    })

    .options({
      verbose: {
        type: 'boolean',
        default: false,
      },
      skipPack: {
        type: 'boolean',
        default: false,
      },
      fromNpm: {
        type: 'string',
        description: 'Test installing from a given NPM package instead of the local package',
      },
      live: {
        type: 'boolean',
        default: false,
        description: 'Make live API requests',
      },
      deploy: {
        type: 'boolean',
        default: false,
        description: 'Push projects to live servers',
      },
      jobs: {
        type: 'number',
        default: 1,
        description: 'number of parallel jobs to run',
      },
      retry: {
        type: 'count',
        default: 0,
        description: 'number of times to retry failing jobs',
      },
      retryDelay: {
        type: 'number',
        default: 100,
        description: 'delay between retries in ms',
      },
      parallel: {
        type: 'boolean',
        default: false,
        description: 'run all projects in parallel (jobs = # projects)',
      },
    })
    .help().argv;
}

type Args = Awaited<ReturnType<typeof parseArgs>>;

let state: Args & { rootDir: string };

async function main() {
  const args = (await parseArgs()) as Args;
  console.error(`args:`, args);

  const rootDir = await packageDir();
  console.error(`rootDir:`, rootDir);

  state = { ...args, rootDir };

  process.chdir(rootDir);

  if (!args.skipPack) {
    await buildPackage();
  }

  const positionalArgs = args._.filter(Boolean);

  // For some reason `yargs` doesn't pick up the positional args correctly
  const projectsToRun = (
    args.projects?.length ? args.projects
    : positionalArgs.length ?
      positionalArgs.filter((n) => typeof n === 'string' && (projectNamesSet as Set<string>).has(n))
    : projectNames) as typeof projectNames;
  console.error(`running projects: ${projectsToRun}`);

  const failed: typeof projectNames = [];

  let { jobs } = args;
  if (args.parallel) jobs = projectsToRun.length;
  if (jobs > 1) {
    const queue = [...projectsToRun];
    const runningProjects = new Set();

    const cursorLeft = '\x1B[G';
    const eraseLine = '\x1B[2K';

    let progressDisplayed = false;
    function clearProgress() {
      if (progressDisplayed) {
        process.stderr.write(cursorLeft + eraseLine);
        progressDisplayed = false;
      }
    }
    const spinner = ['|', '/', '-', '\\'];

    function showProgress() {
      clearProgress();
      progressDisplayed = true;
      const spin = spinner[Math.floor(Date.now() / 500) % spinner.length];
      process.stderr.write(
        `${spin} Running ${[...runningProjects].join(', ')}`.substring(0, process.stdout.columns - 3) + '...',
      );
    }

    const progressInterval = setInterval(showProgress, process.stdout.isTTY ? 500 : 5000);
    showProgress();

    await Promise.all(
      [...Array(jobs).keys()].map(async () => {
        while (queue.length) {
          const project = queue.shift();
          if (!project) break;

          // preserve interleaved ordering of writes to stdout/stderr
          const chunks: { dest: 'stdout' | 'stderr'; data: string | Buffer }[] = [];
          try {
            runningProjects.add(project);
            const child = execa(
              'yarn',
              [
                'tsn',
                __filename,
                project,
                '--skip-pack',
                `--retry=${args.retry}`,
                ...(args.live ? ['--live'] : []),
                ...(args.verbose ? ['--verbose'] : []),
                ...(args.deploy ? ['--deploy'] : []),
                ...(args.fromNpm ? ['--from-npm'] : []),
              ],
              { stdio: 'pipe', encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
            );
            child.stdout?.on('data', (data) => chunks.push({ dest: 'stdout', data }));
            child.stderr?.on('data', (data) => chunks.push({ dest: 'stderr', data }));
            await child;
          } catch (error) {
            failed.push(project);
          } finally {
            runningProjects.delete(project);
          }

          if (IS_CI) console.log(`::group::${failed.includes(project) ? '❌' : '✅'} ${project}`);
          for (const { data } of chunks) {
            process.stdout.write(data);
          }
          if (IS_CI) console.log('::endgroup::');
        }
      }),
    );

    clearInterval(progressInterval);
    clearProgress();
  } else {
    for (const project of projectsToRun) {
      const fn = projects[project];

      await withChdir(path.join(rootDir, 'ecosystem-tests', project), async () => {
        console.error('\n');
        console.error(banner(`▶️ ${project}`));
        console.error('\n');

        try {
          await withRetry(fn, project, state.retry, state.retryDelay);
          console.error('\n');
          console.error(`✅ ${project}`);
        } catch (err) {
          if (err && (err as any).shortMessage) {
            console.error((err as any).shortMessage);
          } else {
            console.error(err);
          }
          console.error('\n');
          console.error(`❌ ${project}`);
          failed.push(project);
        }
        console.error('\n');
      });
    }
  }

  if (failed.length) {
    console.error(`${failed.length} project(s) failed - ${failed.join(', ')}`);
    process.exit(1);
  }
  console.error();
  process.exit(0);
}

async function withRetry(
  fn: () => Promise<void>,
  identifier: string,
  retryAmount: number,
  retryDelayMs: number,
): Promise<void> {
  do {
    try {
      return await fn();
    } catch (err) {
      if (--retryAmount <= 0) throw err;
      console.error(
        `${identifier} failed due to ${err}; retries left ${retryAmount}, next retry in ${retryDelayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  } while (retryAmount > 0);
}

function centerPad(text: string, width = text.length, char = ' '): string {
  return text.padStart(Math.floor((width + text.length) / 2), char).padEnd(width, char);
}

function banner(name: string, width = 80): string {
  function line(text = ''): string {
    if (text) text = centerPad(text, width - 40);
    return centerPad(text, width, '/');
  }
  return [line(), line(), line(' '), line(name), line(' '), line(), line()].join('\n');
}

module.exports = banner;

async function buildPackage() {
  if (state.fromNpm) {
    return;
  }

  if (!(await pathExists('.pack'))) {
    await fs.mkdir('.pack');
  }

  const proc = await run('npm', ['pack', '--ignore-scripts', '--json'], {
    cwd: path.join(process.cwd(), 'dist'),
    alwaysPipe: true,
  });

  const pack = JSON.parse(proc.stdout);
  assert(Array.isArray(pack), `Expected pack output to be an array but got ${typeof pack}`);
  assert(pack.length === 1, `Expected pack output to be an array of length 1 but got ${pack.length}`);

  const filename = path.join('dist', (pack[0] as any).filename);
  console.error({ filename });

  await fs.rename(filename, PACK_FILE);
  console.error(`Successfully created tarball at ${PACK_FILE}`);
}

async function installPackage() {
  if (state.fromNpm) {
    await run('npm', ['install', '-D', state.fromNpm]);
    return;
  }

  const packFile = getPackFile();
  await fs.copyFile(packFile, `./${TAR_NAME}`);
  return await run('npm', ['install', '-D', `./${TAR_NAME}`]);
}

function getPackFile() {
  return path.relative(process.cwd(), path.join(state.rootDir, PACK_FILE));
}

// ------------------ helpers ------------------

interface RunOpts extends execa.Options {
  alwaysPipe?: boolean;
}

async function run(command: string, args: string[], config?: RunOpts): Promise<execa.ExecaReturnValue> {
  if (state.verbose && !config?.alwaysPipe) {
    config = { ...config, stdio: 'inherit' };
  }

  console.debug('[run]:', command, ...args);
  try {
    return await execa(command, args, config);
  } catch (error) {
    if (error instanceof Object && !state.verbose) {
      const { stderr } = error as any;
      if (stderr) process.stderr.write(stderr);
    }
    throw error;
  }
}

async function withChdir<R>(newDir: string, fn: () => Promise<R>): Promise<R> {
  const oldDir = process.cwd();

  try {
    process.chdir(newDir);
    return await fn();
  } finally {
    process.chdir(oldDir);
  }
}

function checkNever(x: never, detail: any = x): never {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  throw new Error(`checkNever: impossible to call: ${detail}`);
}

async function pathExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Find closest parent directory that contains a file `package.json`
 */
export const packageDir = async (): Promise<string> => {
  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;
  while (currentDir !== root) {
    const filepath = path.resolve(currentDir, 'package.json');
    if (await pathExists(filepath)) {
      return currentDir;
    }
    currentDir = path.resolve(currentDir, '..');
  }

  throw new Error('Package directory not found');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
