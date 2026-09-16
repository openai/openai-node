# openai-bun-test

After [setting up the repository](../../.github/CONTRIBUTING.md#setting-up-the-environment) and installing Bun,
run this fixture from the repository root:

```sh
pnpm tsn ecosystem-tests/cli.ts bun
```

The runner builds and installs the local SDK, type-checks the fixture, and runs loopback tests without
live API credentials.

Live tests can incur API charges and upload synthetic files that the suite does not delete.
Set `OPENAI_API_KEY` in your environment and add `--live` to run them:

```sh
pnpm tsn ecosystem-tests/cli.ts bun --live
```
