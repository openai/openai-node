import fs from 'fs/promises';
import execa from 'execa';
import yargs from 'yargs';
import assert from 'assert';
import path from 'path';

const TAR_NAME = 'openai.tgz';
const PACK_FOLDER = '.pack';
const PACK_FILE = `${PACK_FOLDER}/${TAR_NAME}`;
const IS_CI = Boolean(process.env['CI'] && process.env['CI'] !== 'false');

async function defaultNodeRunner() {
  await installPackage();
  await run('npm', ['run', 'tsc']);
  if (state.live) {
    await run('npm', ['test']);
  }
}

const projectRunners = {
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
    // we don't need to explicitly install the package here
    // because our deno setup relies on `rootDir/deno` to exist
    // which is an artifact produced from our build process
    await run('deno', ['task', 'install']);
    await run('deno', ['task', 'check']);

    if (state.live) await run('deno', ['task', 'test']);
  },
};

let projectNames = Object.keys(projectRunners) as Array<keyof typeof projectRunners>;
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
      skip: {
        type: 'array',
        default: [],
        description: 'Skip one or more projects. Separate project names with a space.',
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
        type: 'number',
        default: 0,
        description: 'number of times to retry failing jobs',
      },
      retryDelay: {
        type: 'number',
        default: 1000,
        description: 'delay between retries in ms',
      },
      parallel: {
        type: 'boolean',
        default: false,
        description: 'run all projects in parallel (jobs = # projects)',
      },
      noCleanup: {
        type: 'boolean',
        default: false,
      },
    })
    .help().argv;
}

type Args = Awaited<ReturnType<typeof parseArgs>>;

let state: Args & { rootDir: string };

async function main() {
  if (!process.env['OPENAI_API_KEY']) {
    console.error(`Error: The environment variable OPENAI_API_KEY must be set. Run the command
  $echo 'OPENAI_API_KEY = "'"\${OPENAI_API_KEY}"'"' >> ecosystem-tests/cloudflare-worker/wrangler.toml`);
    process.exit(0);
  }

  const args = (await parseArgs()) as Args;
  console.error(`args:`, args);

  // Some projects, e.g. Deno can be slow to run, so offer the option to skip them. Example:
  //   --skip=deno node-ts-cjs
  if (args.skip.length > 0) {
    args.skip.forEach((projectName, idx) => {
      // Ensure the inputted project name is lower case
      args.skip[idx] = (projectName + '').toLowerCase();
    });

    projectNames = projectNames.filter((projectName) => (args.skip as string[]).indexOf(projectName) < 0);

    args.skip.forEach((projectName) => {
      projectNamesSet.delete(projectName as any);
    });
  }

  const tmpFolderPath = path.resolve(process.cwd(), 'tmp');

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

  let cleanupWasRun = false;

  // Cleanup the various artifacts created as part of executing this script
  async function runCleanup() {
    if (cleanupWasRun) {
      return;
    }
    cleanupWasRun = true;

    // Restore the original files in the ecosystem-tests folders from before
    // npm install was run
    await fileCache.restoreFiles(tmpFolderPath);

    const packFolderPath = path.join(process.cwd(), PACK_FOLDER);

    try {
      // Clean up the .pack folder if this was the process that created it.
      await fs.unlink(PACK_FILE);
      await fs.rmdir(packFolderPath);
    } catch (err) {
      console.log('Failed to delete .pack folder', err);
    }

    for (let i = 0; i < projectNames.length; i++) {
      const projectName = (projectNames as any)[i] as string;

      await defaultNodeCleanup(projectName).catch((err: any) => {
        console.error('Error: Cleanup of file artifacts failed for project', projectName, err);
      });
    }
  }

  async function runCleanupAndExit() {
    await runCleanup();

    process.exit(1);
  }

  if (!(await fileExists(tmpFolderPath))) {
    await fs.mkdir(tmpFolderPath);
  }

  let { jobs } = args;
  if (args.parallel) {
    jobs = projectsToRun.length;
  }

  if (!args.noCleanup) {
    // The cleanup code is only executed from the parent script that runs
    // multiple projects.
    process.on('SIGINT', runCleanupAndExit);
    process.on('SIGTERM', runCleanupAndExit);
    process.on('exit', runCleanup);

    await fileCache.cacheFiles(tmpFolderPath);
  }

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
          if (!project) {
            break;
          }

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
                '--noCleanup',
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

          if (IS_CI) {
            console.log(`::group::${failed.includes(project) ? '❌' : '✅'} ${project}`);
          }

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
      const fn = projectRunners[project];

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

  if (!args.noCleanup) {
    await runCleanup();
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

  if (!(await pathExists(PACK_FOLDER))) {
    await fs.mkdir(PACK_FOLDER);
  }

  // Run our build script to ensure all of our build artifacts are up to date.
  // This matters the most for deno as it directly relies on build artifacts
  // instead of the pack file
  await run('yarn', ['build']);

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

  try {
    // Ensure that there is a clean node_modules folder.
    await run('rm', ['-rf', `./node_modules`]);
  } catch (err) {}

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

// Caches files that are modified by this script, e.g. package.json,
// so that they can be restored when the script either finishes or is
// terminated
const fileCache = (() => {
  const filesToCache: Array<string> = ['package.json', 'package-lock.json', 'deno.lock', 'bun.lockb'];

  return {
    // Copy existing files from each ecosystem-tests project folder to the ./tmp folder
    cacheFiles: async (tmpFolderPath: string) => {
      for (let i = 0; i < projectNames.length; i++) {
        const projectName = (projectNames as any)[i] as string;
        const projectPath = path.resolve(process.cwd(), 'ecosystem-tests', projectName);

        for (let j = 0; j < filesToCache.length; j++) {
          const fileName = filesToCache[j] || '';

          const filePath = path.resolve(projectPath, fileName);
          if (await fileExists(filePath)) {
            const tmpProjectPath = path.resolve(tmpFolderPath, projectName);

            if (!(await fileExists(tmpProjectPath))) {
              await fs.mkdir(tmpProjectPath);
            }
            await fs.copyFile(filePath, path.resolve(tmpProjectPath, fileName));
          }
        }
      }
    },

    // Restore the original files to each ecosystem-tests project folder from the ./tmp folder
    restoreFiles: async (tmpFolderPath: string) => {
      for (let i = 0; i < projectNames.length; i++) {
        const projectName = (projectNames as any)[i] as string;

        const projectPath = path.resolve(process.cwd(), 'ecosystem-tests', projectName);
        const tmpProjectPath = path.resolve(tmpFolderPath, projectName);

        for (let j = 0; j < filesToCache.length; j++) {
          const fileName = filesToCache[j] || '';

          const filePath = path.resolve(tmpProjectPath, fileName);
          if (await fileExists(filePath)) {
            await fs.rename(filePath, path.resolve(projectPath, fileName));
          }
        }
        await fs.rmdir(tmpProjectPath);
      }
    },
  };
})();

async function defaultNodeCleanup(projectName: string) {
  try {
    const projectPath = path.resolve(process.cwd(), 'ecosystem-tests', projectName);

    const packFilePath = path.resolve(projectPath, TAR_NAME);

    if (await fileExists(packFilePath)) {
      await fs.unlink(packFilePath);
    }
  } catch (err) {
    console.error('Cleanup failed for project', projectName, err);
  }
}

async function fileExists(filePath: string) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
