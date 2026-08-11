# Node.js Version Support Policy

The OpenAI Node.js SDK supports every Node.js major release in Active LTS or
Maintenance LTS. The oldest supported release is declared by
`package.json#engines`, documented in the README, and tested in required CI.

New Node.js majors enter the supported matrix within 30 days after official
LTS promotion. Current and Alpha releases are forward-compatibility targets,
not production support promises. This policy follows lifecycle state rather
than even or odd version numbers because every annual Node.js release beginning
with Node.js 27 is planned to become LTS.

OpenAI publishes a retirement notice at least six months before removing a
supported Node.js line. The notice belongs in the README or support matrix,
release notes, and a pinned GitHub issue. Social-media announcements are not
required. Support ends at upstream EOL by default.

The SDK and Security teams may approve up to six months of post-EOL grace when
migration risk justifies it. The exception must be recorded below with its
owner, reason, and end date. It provides only feasible SDK fixes and migration
help; OpenAI cannot provide missing upstream runtime security fixes, and the
exception may end early.

## Release and packaging rules

- Raising `engines.node`, emitted JavaScript syntax, or required runtime APIs
  ships in an SDK major release by default. An urgent minor-release exception
  requires SDK and Security approval. Never hide a runtime-floor change in a
  patch.
- Adding a newly promoted LTS without raising the minimum is an SDK minor.
- `engines.node` states the technical floor. The README support matrix is
  authoritative for lifecycle status because npm engine ranges cannot express
  only the currently supported LTS lines.
- Repository tooling may use a newer Node.js version than SDK consumers.
- Node.js lifecycle changes do not silently redefine TypeScript, Deno, Bun,
  browser, Workers, edge-runtime, Jest, or Nitro support.
- Required CI runs the SDK test suite on every supported Node.js line.
- Required CI builds and installs the packed npm artifact on supported lines,
  exercising CommonJS, ESM, and published engine metadata.

## Current compatibility

| Node.js line | Upstream status on 2026-07-27      | OpenAI status             | Treatment                                                                                                                   |
| ------------ | ---------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 20           | EOL since 2026-04-30               | Unsupported               | Remove from required CI. Previously published SDK releases remain available without guaranteed fixes or security backports. |
| 22           | Maintenance LTS through 2027-04-30 | Supported minimum         | Blocking CI. Publish retirement notice by 2026-10-30.                                                                       |
| 24           | Active LTS; EOL 2028-04-30         | Supported and recommended | Blocking CI and preferred repository toolchain.                                                                             |
| 26           | Current; LTS planned 2026-10-28    | Forward-tested only       | Non-blocking CI on the latest patch; admit within 30 days after LTS promotion.                                              |

The next SDK major requires Node.js 22 or later. The final Node.js
20-compatible SDK release is the last release published before that major; the
exact version must be named in its release notes.

## Automation

This document is the sole lifecycle and release policy. The README,
`package.json#engines.node`, and `.nvmrc` are projections of it. Required CI
derives its runtime matrix directly from the compatibility table. The
type-checked `scripts/check-node-version-policy.ts` fails when those projections
drift and emits the matrix consumed by CI.

Each month, `.github/workflows/node-version-review.yml` asks Codex to research
the official Node.js schedule, reconcile the policy artifacts, run repository
validation, and open or update one draft pull request. Generated changes never
merge automatically.

For upstream dates and lifecycle definitions, see the
[Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)
and [Node.js release policy](https://nodejs.org/en/about/previous-releases).
