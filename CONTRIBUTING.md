## Setting up the environment

This repository uses [`pnpm`](https://pnpm.io/) via Corepack.
Other package managers may work but are not officially supported for development.

To set up the repository, run:

```sh
$ corepack pnpm install
$ corepack pnpm build
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

#!/usr/bin/env -S corepack pnpm tsn -T
…
```

```sh
$ chmod +x examples/<your-example>.ts
# run the example against your api
$ corepack pnpm tsn -T examples/<your-example>.ts
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
$ corepack pnpm link --global
$ cd ../my-package
$ corepack pnpm link --global openai
```

## Running tests

Most tests require you to [set up a mock server](https://github.com/dgellow/steady) against the OpenAPI spec to run the tests.

```sh
$ ./scripts/mock
```

```sh
$ corepack pnpm run test
```

## Linting and formatting

This repository uses [prettier](https://www.npmjs.com/package/prettier) and
[eslint](https://www.npmjs.com/package/eslint) to format the code in the repository.

To lint:

```sh
$ corepack pnpm lint
```

To format and fix all lint issues automatically:

```sh
$ corepack pnpm fix
```

## Publishing and releases

Changes made to this repository via the automated release PR pipeline should publish to npm automatically. If
the changes aren't made through the automated pipeline, you may want to make releases manually.

### Publish with a GitHub workflow

You can release to package managers by using [the `Publish NPM` GitHub action](https://www.github.com/openai/openai-node/actions/workflows/publish-npm.yml). This requires a setup organization or repository secret to be set up.

### Publish manually

If you need to manually release a package, you can run the `bin/publish-npm` script with an `NPM_TOKEN` set on
the environment.
