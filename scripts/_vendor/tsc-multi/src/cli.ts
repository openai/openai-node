import yargs from 'yargs';
import { build } from './build';
import { loadConfig, resolveProjectPath } from './config';

yargs(process.argv.slice(2))
  .options({
    watch: {
      type: 'boolean',
      alias: 'w',
      description: 'Watch input files and rebuild when they are changed.',
    },
    clean: {
      type: 'boolean',
      description: 'Delete built files. Only available when rootDir is set.',
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug logs.',
    },
    dry: {
      type: 'boolean',
      description: "Show what would be done but doesn't actually build anything.",
    },
    force: {
      type: 'boolean',
      description: 'Rebuild all projects.',
    },
    cwd: {
      type: 'string',
      description: 'Current working directory.',
    },
    config: {
      type: 'string',
      description: 'Path of the config file. Default to $CWD/tsc-multi.json.',
    },
    compiler: {
      type: 'string',
      description: 'Set a custom TypeScript compiler.',
    },
    maxWorkers: {
      type: 'number',
      description: 'Specify the maximum number of concurrent workers.',
    },
  })
  .command(
    '$0 [projects..]',
    'Build multiple TypeScript projects to multiple targets.',
    (cmd) => {
      return cmd
        .positional('projects', {
          array: true,
          type: 'string',
          description: 'Path of TypeScript projects or tsconfig.json files. Default to $CWD.',
        })
        .example([
          ['$0', 'Build current folder.'],
          ['$0 --watch', 'Watch files and rebuild when changed.'],
          ['$0 --clean', 'Delete built files.'],
          ['$0 --config ./conf.json', 'Custom config path.'],
          ['$0 ./pkg-a ./pkg-b', 'Build multiple projects.'],
        ]);
    },
    async (args) => {
      const projects = args.projects || [];
      const config = await loadConfig({
        cwd: args.cwd,
        path: args.config,
      });
      if (projects.length) {
        config.projects = await resolveProjectPath(config.cwd, projects);
      }
      if (!config.projects.length) {
        config.projects = [config.cwd];
      }
      if (args.compiler) {
        config.compiler = args.compiler;
      }

      process.exitCode = await build({
        ...config,
        verbose: args.verbose,
        dry: args.dry,
        force: args.force,
        watch: args.watch,
        clean: args.clean,
        maxWorkers: args.maxWorkers,
      });
    },
  )
  .showHelpOnFail(false)
  .parse();
