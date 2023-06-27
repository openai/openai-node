import fs from 'fs/promises';
import execa from 'execa';
import yargs from 'yargs';
import assert from 'assert';
import path from 'path';

const TAR_NAME = 'openai.tgz';
const PACK_FILE = `.pack/${TAR_NAME}`;

const projects = {
  'ts-browser-webpack': async () => {
    await run('yarn', ['install']);
    await installPackage();

    await run('yarn', ['build']);
  },
  'vercel-edge': async () => {
    await run('yarn', ['install']);
    await installPackage({ method: 'copy' });

    await run('yarn', ['build']);

    if (state.deploy) {
      await run('yarn', ['vercel', 'deploy', '--prod', '--force']);
    }
  },
  'cloudflare-worker': async () => {
    await run('yarn', ['install']);
    await installPackage();

    await run('yarn', ['tsc']);

    if (state.live) {
      await run('yarn', ['test:ci']);
    }
    if (state.deploy) {
      await run('yarn', ['deploy']);
    }
  },
  'node-ts-cjs': async () => {
    await run('yarn', ['install']);
    await installPackage();

    await run('yarn', ['tsc']);

    if (state.live) {
      await run('yarn', ['test']);
    }
  },
  'node-ts-esm': async () => {
    await run('yarn', ['install']);
    await installPackage();

    await run('yarn', ['tsc']);

    if (state.live) {
      await run('yarn', ['test']);
    }
  },
  deno: async () => {
    await run('deno', ['task', 'install']);
    await run('yarn', ['install']);
    await installPackage();
    const openaiDir = path.resolve(
      process.cwd(),
      'node_modules',
      '.deno',
      'openai@3.3.0',
      'node_modules',
      'openai',
    );

    await run('sh', ['-c', 'rm -rf *'], { cwd: openaiDir, stdio: 'inherit' });
    const packFile = getPackFile();
    await run('tar', ['xzf', path.resolve(packFile)], { cwd: openaiDir, stdio: 'inherit' });
    await run('sh', ['-c', 'mv package/* .'], { cwd: openaiDir, stdio: 'inherit' });
    await run('sh', ['-c', 'rm -rf package'], { cwd: openaiDir, stdio: 'inherit' });

    await run('deno', ['lint']);
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
  console.log(`args:`, args);

  const rootDir = await packageDir();
  console.log(`rootDir:`, rootDir);

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
  console.log(`running projects: ${projectsToRun}`);

  const failed: typeof projectNames = [];

  for (const project of projectsToRun) {
    const fn = projects[project];

    await withChdir(path.join(rootDir, 'ecosystem-tests', project), async () => {
      console.log('\n');
      console.log(`----------- ${project} -----------`);

      try {
        await fn();
        console.log(`✅ - Successfully ran ${project}`);
      } catch (err) {
        console.error(err);
        failed.push(project);
      }
    });
  }

  if (failed.length) {
    throw new Error(`${failed.length} project(s) failed - ${failed.join(', ')}`);
  }
}

async function buildPackage() {
  await run('yarn', ['build']);

  if (!(await pathExists('.pack'))) {
    await fs.mkdir('.pack');
  }

  const proc = await run('npm', ['pack', '--json'], { alwaysPipe: true });
  const pack = JSON.parse(proc.stdout);
  assert(Array.isArray(pack), `Expected pack output to be an array but got ${typeof pack}`);
  assert(pack.length === 1, `Expected pack output to be an array of length 1 but got ${pack.length}`);

  const filename = pack[0].filename;
  console.log({ filename });

  await fs.rename(filename, PACK_FILE);
  console.log(`Successfully created tarball at ${PACK_FILE}`);
}

async function installPackage({ method }: { method: 'reference' | 'copy' } = { method: 'reference' }) {
  // TODO: this won't always install, sometimes it will read from a cache

  const packFile = getPackFile();

  switch (method) {
    case 'reference': {
      return await run('yarn', ['add', '-D', '--force', packFile]);
    }
    case 'copy':
      await fs.copyFile(packFile, TAR_NAME);
      return await run('yarn', ['add', '-D', '--force', './' + TAR_NAME]);
    default:
      throw checkNever(method);
  }
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
  return await execa(command, args, config);
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
