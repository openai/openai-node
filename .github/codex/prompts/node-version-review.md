# Monthly Node.js version review

Review this repository's Node.js support policy and make a focused update only
when the checked-in repository has drifted.

Use web search to read the official Node.js release schedule and release-policy
pages. Treat those official sources, rather than model memory, as authoritative
for current dates and lifecycle states.

Read `AGENTS.md`, `NODE_VERSION_POLICY.md`, `package.json`, the README,
contributor documentation, and CI workflows before changing anything.

Apply `NODE_VERSION_POLICY.md` directly. Do not restate, reinterpret, or add
lifecycle and release rules in this prompt.

If the repository already matches policy, make no file changes.

If it has drifted, prepare one focused change:

1. Update the policy's current compatibility data.
2. Update only `package.json#engines.node`; do not alter package scripts,
   dependencies, peer dependencies, exports, package-manager metadata, or the
   lockfile.
3. Update `.nvmrc` when the recommended repository toolchain changes.
4. Update `README.md`. Update `.github/CONTRIBUTING.md` only if its toolchain guidance
   changed.
5. Do not edit GitHub Actions workflows. CI derives its Node.js test matrix
   from the policy table through `scripts/check-node-version-policy.ts`.
6. Preserve the public SDK API, CommonJS and ESM exports, emitted `es2020`
   target, TypeScript support, and Deno, Bun, browser, Workers, edge, Jest, and
   Nitro behavior. Do not edit generated SDK source.
7. Do not make dependency, lockfile, refactoring, formatting, or unrelated
   documentation changes.

Do not commit, push, open a pull request, call GitHub, or modify repository
secrets. You may run the fast policy checker while editing, but do not spend
this run repeating the full lint and test suites; the workflow owns validation
and opens the draft pull request after you finish.

Your final response becomes the draft pull request body. Write concise Markdown
with these sections:

- `## Summary`
- `## User impact`
- `## Validation`
- `## Release note`

In the release note, summarize the user-visible compatibility change and apply
the release classification and compatibility-boundary requirements from
`NODE_VERSION_POLICY.md`. Flag any fact that repository history cannot
establish so a maintainer can fill it in before marking the pull request ready.
