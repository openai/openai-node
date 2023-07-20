import fs from 'fs/promises';
import execa from 'execa';
import yargs from 'yargs';
import assert from 'assert';
import path from 'path';

const TAR_NAME = 'openai.tgz';
const PACK_FILE = `.pack/${TAR_NAME}`;

const projects = {
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

    await run('npm', ['run', 'build']);

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
  'node-ts-cjs': async () => {
    await installPackage();

    await run('npm', ['run', 'tsc']);

    if (state.live) {
      await run('npm', ['test']);
    }
  },
  'node-ts-cjs-dom': async () => {
    await installPackage();
    await run('npm', ['run', 'tsc']);
  },
  'node-ts-esm': async () => {
    await installPackage();

    await run('npm', ['run', 'tsc']);

    if (state.live) {
      await run('npm', ['run', 'test']);
    }
  },
  'node-ts-esm-dom': async () => {
    await installPackage();
    await run('npm', ['run', 'tsc']);
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

  // For some reason `yargs` doesn't pick up the positional args correctly
  const projectsToRun = (
    args.projects?.length ? args.projects
    : args._.length ? args._
    : projectNames) as typeof projectNames;
  console.error(`running projects: ${projectsToRun}`);

  const failed: typeof projectNames = [];

  for (const project of projectsToRun) {
    const fn = projects[project];

    await withChdir(path.join(rootDir, 'ecosystem-tests', project), async () => {
      console.error('\n');
      console.error(banner(project));
      console.error('\n');

      try {
        await fn();
        console.error(`✅ - Successfully ran ${project}`);
      } catch (err) {
        if (err && (err as any).shortMessage) {
          console.error((err as any).shortMessage);
        } else {
          console.error(err);
        }
        failed.push(project);
      }
    });
  }

  if (failed.length) {
    console.error(`${failed.length} project(s) failed - ${failed.join(', ')}`);
    process.exit(1);
  }
  console.error();
  process.exit(0);
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

  await run('yarn', ['build']);

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
