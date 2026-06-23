import type ts from 'typescript';
import debug from './debug';
import { createReporter, Reporter } from '../report';
import { mergeCustomTransformers, trimSuffix, isIncrementalCompilation } from '../utils';
import { createTransformer } from '../transformer';
import { WorkerOptions } from './types';
import { dirname, extname, join, resolve } from 'path';
import assert from 'assert';
import { helpers } from '../helpers';

const JS_EXT = '.js';
const MAP_EXT = '.map';
const JS_MAP_EXT = `${JS_EXT}${MAP_EXT}`;
const DTS_EXT = '.d.ts';
const DTS_MAP_EXT = `${DTS_EXT}${MAP_EXT}`;

const extnameDeclMap: Record<string, string> = {
  '.js': '.d.ts',
  '.mjs': '.d.mts',
  '.cjs': '.d.cts',
};

type TS = typeof ts;

function loadCompiler(cwd: string, name = 'typescript'): TS {
  const path = require.resolve(name, { paths: [cwd, __dirname] });
  return require(path);
}

export class Worker {
  private readonly ts: TS;
  private readonly system: ts.System;
  private readonly reporter: Reporter;

  constructor(
    private readonly data: WorkerOptions,
    system?: ts.System,
  ) {
    this.ts = loadCompiler(data.cwd, data.compiler);
    this.system = this.createSystem(system || this.ts.sys);
    this.reporter = createReporter({
      cwd: data.cwd,
      system: this.system,
      formatDiagnostics: this.ts.formatDiagnosticsWithColorAndContext,
      output: process.stderr,
      prefix: data.reportPrefix,
    });
  }

  public run(): number {
    if (this.data.transpileOnly) {
      this.transpile();
      return 0;
    }

    const builder = this.createBuilder();

    if (this.data.clean) {
      return builder.clean();
    }

    return builder.build();
  }

  private getJSPath(path: string): string {
    if (!this.data.extname) return path;

    return trimSuffix(path, JS_EXT) + this.data.extname;
  }

  private getJSMapPath(path: string): string {
    if (!this.data.extname) return path;

    return trimSuffix(path, JS_MAP_EXT) + this.data.extname + MAP_EXT;
  }

  private getDTSPath(path: string): string {
    if (!this.data.extname) return path;

    return trimSuffix(path, DTS_EXT) + extnameDeclMap[this.data.extname];
  }

  private getDTSMapPath(path: string): string {
    if (!this.data.extname) return path;

    return trimSuffix(path, DTS_MAP_EXT) + extnameDeclMap[this.data.extname] + MAP_EXT;
  }

  private rewritePath(path: string): string {
    if (path.endsWith(JS_EXT)) {
      return this.getJSPath(path);
    }

    if (path.endsWith(JS_MAP_EXT)) {
      return this.getJSMapPath(path);
    }

    if (path.endsWith(DTS_EXT)) {
      return this.getDTSPath(path);
    }

    if (path.endsWith(DTS_MAP_EXT)) {
      return this.getDTSMapPath(path);
    }

    return path;
  }

  private rewriteSourceMappingURL(data: string): string {
    return data.replace(
      /\/\/# sourceMappingURL=(.+)/g,
      (_, path) => `//# sourceMappingURL=${this.getJSMapPath(path)}`,
    );
  }

  private rewriteSourceMap(data: string): string {
    const json = JSON.parse(data);
    json.file = this.getJSPath(json.file);
    return JSON.stringify(json);
  }

  private rewriteDTSMappingURL(data: string): string {
    return data.replace(
      /\/\/# sourceMappingURL=(.+)/g,
      (_, path) => `//# sourceMappingURL=${this.getDTSMapPath(path)}`,
    );
  }

  private rewriteDTSMap(data: string): string {
    const json = JSON.parse(data);
    json.file = this.getDTSPath(json.file);
    return JSON.stringify(json);
  }

  private createSystem(sys: Readonly<ts.System>): ts.System {
    const getReadPaths = (path: string) => {
      const inNodeModules = path.includes('/node_modules/');
      const paths = [inNodeModules ? path : this.rewritePath(path)];

      // Source files may be .js files when `allowJs` is enabled. When a .js
      // file with rewritten path doesn't exist, retry again without rewriting
      // the path.
      if (!inNodeModules && (path.endsWith(JS_EXT) || path.endsWith(DTS_EXT))) {
        paths.push(path);
      }

      return paths;
    };

    return {
      ...sys,
      fileExists: (inputPath) => {
        return getReadPaths(inputPath).reduce<boolean>(
          (result, path) => result || sys.fileExists(path),
          false,
        );
      },
      readFile: (inputPath, encoding) => {
        return (
          getReadPaths(inputPath).reduce<string | undefined | null>(
            (result, path) => result ?? sys.readFile(path, encoding),
            null,
          ) ?? undefined
        );
      },
      writeFile: (path, data, writeByteOrderMark) => {
        const newPath = this.rewritePath(path);
        const newData = (() => {
          if (path.endsWith(JS_EXT)) {
            return this.rewriteSourceMappingURL(data);
          }

          if (path.endsWith(JS_MAP_EXT)) {
            return this.rewriteSourceMap(data);
          }

          if (path.endsWith(DTS_EXT)) {
            return this.rewriteDTSMappingURL(data);
          }

          if (path.endsWith(DTS_MAP_EXT)) {
            return this.rewriteDTSMap(data);
          }

          return data;
        })();

        debug('Write file: %s', newPath);
        sys.writeFile(newPath, newData, writeByteOrderMark);
      },
      deleteFile: (path) => {
        const newPath = this.rewritePath(path);
        debug('Delete file: %s', newPath);
        sys.deleteFile?.(newPath);
      },
    };
  }

  private createBuilder() {
    const buildOptions: ts.BuildOptions = {
      verbose: this.data.verbose,
      dry: this.data.dry,
      force: this.data.force,
    };
    const createProgram = this.ts.createSemanticDiagnosticsBuilderProgram;

    if (this.data.watch) {
      const host = this.ts.createSolutionBuilderWithWatchHost(
        this.system,
        createProgram,
        this.reporter.reportDiagnostic,
        this.reporter.reportSolutionBuilderStatus,
        this.reporter.reportWatchStatus,
      );
      this.patchSolutionBuilderHost(host);

      return this.ts.createSolutionBuilderWithWatch(host, this.data.projects, buildOptions);
    }

    const host = this.ts.createSolutionBuilderHost(
      this.system,
      createProgram,
      this.reporter.reportDiagnostic,
      this.reporter.reportSolutionBuilderStatus,
      this.reporter.reportErrorSummary,
    );
    this.patchSolutionBuilderHost(host);

    return this.ts.createSolutionBuilder(host, this.data.projects, buildOptions);
  }

  private patchSolutionBuilderHost<T extends ts.BuilderProgram>(host: ts.SolutionBuilderHostBase<T>) {
    const { createProgram, reportDiagnostic } = host;

    const helpersNeeded = new Set<string>();
    let resolvedShareHelpers: string | undefined;

    const transformers: ts.CustomTransformers = {
      after: [
        createTransformer({
          extname: this.data.extname || JS_EXT,
          pureClassAssignment: this.data.pureClassAssignment || false,
          getResolvedShareHelpers: () => resolvedShareHelpers,
          helpersNeeded,
          system: this.system,
          ts: this.ts,
        }),
      ],
      afterDeclarations: [
        createTransformer({
          extname: this.data.extname || JS_EXT,
          pureClassAssignment: false,
          getResolvedShareHelpers: () => resolvedShareHelpers,
          helpersNeeded,
          system: this.system,
          ts: this.ts,
        }),
      ],
    };

    const parseConfigFileHost: ts.ParseConfigFileHost = {
      ...this.system,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        reportDiagnostic?.(diagnostic);
      },
    };

    host.getParsedCommandLine = (path: string) => {
      const basePath = trimSuffix(path, extname(path));
      const { options } = this.ts.convertCompilerOptionsFromJson(this.data.target, dirname(path), path);

      const config = this.ts.getParsedCommandLineOfConfigFile(path, options, parseConfigFileHost);
      if (!config) return;

      if (this.data.shareHelpers) {
        const root = (this.ts as any).getCommonSourceDirectoryOfConfig(config);
        config.options.importHelpers = true;
        resolvedShareHelpers = resolve(root, this.data.shareHelpers);
      }

      // Set separated tsbuildinfo paths to avoid that multiple workers to
      // access the same tsbuildinfo files and potentially read/write corrupted
      // tsbuildinfo files
      if (this.data.extname && !config.options.tsBuildInfoFile && isIncrementalCompilation(config.options)) {
        config.options.tsBuildInfoFile = `${basePath}${this.data.extname}.tsbuildinfo`;
      }

      return config;
    };

    host.createProgram = (...args) => {
      const program = createProgram(...args);
      const emit = program.emit;

      program.emit = (
        targetSourceFile,
        writeFile,
        cancellationToken,
        emitOnlyDtsFiles,
        customTransformers,
      ) => {
        const result = emit(
          targetSourceFile,
          writeFile,
          cancellationToken,
          emitOnlyDtsFiles,
          mergeCustomTransformers(customTransformers || {}, transformers),
        );

        if (this.data.shareHelpers) {
          const out = program.getCompilerOptions().outDir;
          assert(out, 'outDir must be set when specifying shareHelpers');
          const write = writeFile || this.system.writeFile;
          this.writeHelpers(helpersNeeded, write, out, program.getCompilerOptions());
        }

        return result;
      };

      return program;
    };
  }

  private writeHelpers(
    helpersNeeded: Set<string>,
    write: ts.WriteFileCallback,
    out: string,
    compilerOptions: ts.CompilerOptions,
  ) {
    assert(this.data.shareHelpers);
    const helperDeps = [...helpersNeeded].filter((e) => helpers[e]);
    let helperLength = 0;
    while (helperLength !== helperDeps.length) {
      helperLength = helperDeps.length;
      for (const helper of helperDeps) {
        for (const dep of helpers[helper]?.deps || []) {
          if (!helperDeps.includes(dep)) {
            helperDeps.unshift(dep);
          }
        }
      }
    }
    write(
      resolve(out, this.data.shareHelpers),
      this.ts.transpileModule(
        helperDeps.map((name) => helpers[name].code).join('\n\n') +
          `\n\nexport { ${[...helpersNeeded].join(', ')} };\n`,
        {
          compilerOptions: {
            module: compilerOptions.module,
          },
          fileName: 'helpers.js',
          reportDiagnostics: false,
        },
      ).outputText,
      false,
    );
  }

  private transpile() {
    for (const project of this.data.projects) {
      this.transpileProject(project);
    }
  }

  private transpileProject(projectPath: string) {
    const tsConfigPath =
      this.system.fileExists(projectPath) ? projectPath : join(projectPath, 'tsconfig.json');
    const { options } = this.ts.convertCompilerOptionsFromJson(this.data.target, projectPath, tsConfigPath);

    const parseConfigFileHost: ts.ParseConfigFileHost = {
      ...this.system,
      onUnRecoverableConfigFileDiagnostic: this.reporter.reportDiagnostic,
    };

    const config = this.ts.getParsedCommandLineOfConfigFile(tsConfigPath, options, parseConfigFileHost);
    if (!config) return;

    let resolvedShareHelpers: string | undefined;
    if (this.data.shareHelpers) {
      const root = (this.ts as any).getCommonSourceDirectoryOfConfig(config);
      config.options.importHelpers = true;
      resolvedShareHelpers = resolve(root, this.data.shareHelpers);
    }

    const helpersNeeded = new Set<string>();

    // TODO: Merge custom transformers
    const transformers: ts.CustomTransformers = {
      after: [
        createTransformer({
          extname: this.data.extname || JS_EXT,
          getResolvedShareHelpers: () => resolvedShareHelpers,
          helpersNeeded,
          system: this.system,
          ts: this.ts,
          pureClassAssignment: this.data.pureClassAssignment || false,
        }),
      ],
    };

    for (const inputPath of config.fileNames) {
      // - Ignore if file does not exist
      // - or if file is a declaration file, which will generate an empty file and
      //   throw "Output generation failed" error
      if (!this.system.fileExists(inputPath) || inputPath.endsWith('.d.ts')) {
        continue;
      }

      const content = this.system.readFile(inputPath) || '';
      const [outputPath, sourceMapPath] = this.ts.getOutputFileNames(config, inputPath, false);
      const output = this.ts.transpileModule(content, {
        compilerOptions: config.options,
        fileName: inputPath,
        reportDiagnostics: true,
        transformers,
      });

      for (const diag of output.diagnostics ?? []) {
        this.reporter.reportDiagnostic(diag);
      }

      this.system.writeFile(outputPath, output.outputText);

      if (typeof output.sourceMapText === 'string') {
        this.system.writeFile(sourceMapPath, output.sourceMapText);
      }
    }

    if (this.data.shareHelpers) {
      const out = config.options.outDir;
      assert(out, 'outDir must be set when specifying shareHelpers');
      this.writeHelpers(helpersNeeded, this.system.writeFile, out, config.options);
    }
  }
}
