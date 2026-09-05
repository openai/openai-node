// @ts-check
const fs = require('node:fs');
const path = require('node:path');

const distDir = process.env['DIST_PATH']
  ? path.resolve(process.env['DIST_PATH'])
  : path.resolve(__dirname, '..', '..', 'dist');
const packageJsonPath = path.join(distDir, 'package.json');

async function* walk(dir) {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) {
      yield* walk(entry);
    } else if (d.isFile()) {
      yield entry;
    }
  }
}

// Jest 28 does not resolve package imports from CommonJS modules, so keep emitted
// CJS on the same relative private state module used by the ESM wrapper.
function rewriteX509TransportStateImport(file, code) {
  if (!file.endsWith('.mjs') && !file.endsWith('.js')) {
    return;
  }

  const isModule = file.endsWith('.mjs');
  const statePath = path.join(distDir, 'internal/auth', `x509-transport-state.${isModule ? 'mjs' : 'js'}`);
  const relativeStatePath = path.relative(path.dirname(file), statePath).split(path.sep).join('/');
  const stateSpecifier = relativeStatePath.startsWith('.') ? relativeStatePath : `./${relativeStatePath}`;

  return isModule
    ? code.replaceAll(/from (['"])#x509-transport-state\1/g, `from '${stateSpecifier}'`)
    : code.replaceAll(/require\((['"])#x509-transport-state\1\)/g, `require('${stateSpecifier}')`);
}

async function postprocess() {
  const stateDirectory = path.join(distDir, 'internal/auth');
  const canonicalState = await fs.promises.readFile(
    path.join(stateDirectory, 'x509-transport-state.cjs'),
    'utf-8',
  );
  const strictDirective = '"use strict";';
  const sourceMapComment = '//# sourceMappingURL=';
  if (!canonicalState.startsWith(strictDirective) || !canonicalState.includes(sourceMapComment)) {
    throw new Error('The generated X.509 transport state no longer has its expected CommonJS format.');
  }
  const browserCompatibleState = canonicalState
    .replace(
      strictDirective,
      `${strictDirective} if (typeof module !== 'undefined' && module !== globalThis.module && typeof exports !== 'undefined' && module.exports === exports) {`,
    )
    .replace(sourceMapComment, `}\n${sourceMapComment}`);
  await fs.promises.writeFile(path.join(stateDirectory, 'x509-transport-state.js'), browserCompatibleState);

  for await (const file of walk(distDir)) {
    if (!/(\.d)?[cm]?ts$|\.m?js$/.test(file)) {
      continue;
    }

    const code = await fs.promises.readFile(file, 'utf-8');

    const rewrittenStateImport = rewriteX509TransportStateImport(file, code);
    if (rewrittenStateImport !== undefined) {
      if (rewrittenStateImport !== code) {
        await fs.promises.writeFile(file, rewrittenStateImport, 'utf-8');
      }
      continue;
    }

    // strip out lib="dom", types="node", and types="react" references; these
    // are needed at build time, but would pollute the user's TS environment
    let transformed = code.replaceAll(
      /^ *\/\/\/ *<reference +(lib="dom"|types="(node|react)").*?\n/gm,
      // replace with same number of characters to avoid breaking source maps
      (match) => ' '.repeat(match.length - 1) + '\n',
    );

    if (/\.d\.[cm]?ts$/.test(file)) {
      transformed = transformed.replaceAll(
        /\/\*\* @ts-ignore ([^*]+?) \*\/ type /g,
        '// @ts-ignore $1\ntype ',
      );
    }

    if (transformed !== code) {
      console.error(`wrote ${path.relative(process.cwd(), file)}`);
      await fs.promises.writeFile(file, transformed, 'utf-8');
    }
  }

  const newExports = {
    '.': {
      require: {
        types: './index.d.ts',
        default: './index.js',
      },
      types: './index.d.mts',
      default: './index.mjs',
    },
    './auth': {
      require: {
        types: './auth/index.d.ts',
        default: './auth/index.js',
      },
      types: './auth/index.d.mts',
      default: './auth/index.mjs',
    },
  };

  for (const entry of await fs.promises.readdir(distDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'src' && entry.name !== 'internal' && entry.name !== 'bin') {
      const subpath = './' + entry.name;
      newExports[subpath + '/*.mjs'] = {
        default: subpath + '/*.mjs',
      };
      newExports[subpath + '/*.js'] = {
        default: subpath + '/*.js',
      };
      newExports[subpath + '/*'] = {
        import: subpath + '/*.mjs',
        require: subpath + '/*.js',
      };
    } else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
      const { name, ext } = path.parse(entry.name);
      const subpathWithoutExt = './' + name;
      const subpath = './' + entry.name;
      newExports[subpathWithoutExt] ||= { import: undefined, require: undefined };
      const isModule = ext[1] === 'm';
      if (isModule) {
        newExports[subpathWithoutExt].import = subpath;
      } else {
        newExports[subpathWithoutExt].require = subpath;
      }
      newExports[subpath] = {
        default: subpath,
      };
    }
  }
  await fs.promises.writeFile(
    packageJsonPath,
    JSON.stringify(
      Object.assign(
        /** @type {Record<String, unknown>} */ (
          JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'))
        ),
        {
          exports: newExports,
        },
      ),
      null,
      2,
    ),
  );
}
postprocess();
