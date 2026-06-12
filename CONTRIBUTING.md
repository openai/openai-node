## Setting up the environment

This repository uses the [`pnpm`](https://pnpm.io/installation) version pinned by `package.json`.
Other package managers may work but are not officially supported for development.
Use a Node.js version supported by that pinned pnpm release.
Do not rely on Corepack being available; install pnpm explicitly if needed:

```sh
$ PNPM_VERSION=$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")
$ npm install --global "pnpm@$PNPM_VERSION"
```

To set up the repository, run:

```sh
$ pnpm install
$ pnpm build
```

This will install all the required dependencies and build output files to `dist/`.

## Modifying/Adding code

Most of the SDK is generated code. Modifications to code will be persisted between generations, but may
result in merge conflicts between manual patches and changes from the generator. The generator will never
modify the contents of the `src/lib/` and `examples/` directories.

## Adding and running examples

All files in the `examples/` directory are not modified by the generator and can be freely edited or added to.

```ts
// add an example to examples/<your-example>.ts

#!/usr/bin/env -S npm run tsn -- -T
…
```

```sh
$ chmod +x examples/<your-example>.ts
# run the example against your api
$ npm run tsn -- -T examples/<your-example>.ts
```

## Using the repository from source

If you’d like to use the repository from source, you can either install from git or link to a cloned repository:

To install via git:

```sh
$ npm install git+ssh://git@github.com:openai/openai-node.git
```

Alternatively, to link a local copy of the repo:

```sh
# Clone
$ git clone https://www.github.com/openai/openai-node
$ cd openai-node

# With pnpm
$ pnpm link --global
$ cd ../my-package
$ pnpm link --global openai
```

## Running tests

Most tests require you to [set up a mock server](https://github.com/dgellow/steady) against the OpenAPI spec to run the tests.

```sh
$ ./scripts/mock
```

```sh
$ pnpm test
```

## Linting and formatting

This repository uses [prettier](https://www.npmjs.com/package/prettier) and
[eslint](https://www.npmjs.com/package/eslint) to format the code in the repository.

To lint:

```sh
$ pnpm lint
```

To format and fix all lint issues automatically:

```sh
$ pnpm fix
```

## Publishing and releases

Changes made to this repository via the automated release PR pipeline should publish to npm automatically. If
the changes aren't made through the automated pipeline, you may want to make releases manually.

### Publish with a GitHub workflow

You can release to package managers by using [the `Publish NPM` GitHub action](https://www.github.com/openai/openai-node/actions/workflows/publish-npm.yml). This requires a setup organization or repository secret to be set up.

### Publish manually

If you need to manually release a package, you can run the `bin/publish-npm` script with an `NPM_TOKEN` set on
the environment.
