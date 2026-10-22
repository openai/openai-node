# Next CI publisher activation

The bridge publishes through a dedicated GitHub App, never the shared GitHub
Actions identity. The App key must exist only in the existing `ci` environment,
whose deployment branch policy allows exactly branch `main` (no tags or queue
refs). Candidate analysis jobs do not receive it. Do not reuse release credentials
or place the key in repository/organization secrets accessible to candidate jobs.

An administrator must install a dedicated App on this repository with only
Actions read, Contents read, Pull requests read, and Commit statuses write
(metadata read is implicit). Configure these environment-scoped values:

- `NEXT_CI_APP_CLIENT_ID`: the App client ID variable.
- `NEXT_CI_APP_ID`: the numeric App ID variable, not its installation ID.
- `NEXT_CI_APP_PRIVATE_KEY`: its private key secret, entered directly in GitHub.

The pinned token action scopes the token to this repository and revokes it after
the job. Missing credentials fail token creation. Before writing any status, the
bridge checks the authenticated token action's App slug against the configured
App ID and rejects GitHub Actions' ID. There is no GITHUB_TOKEN fallback.

Keep all existing required checks while qualifying the new producer. When no
Next CI contexts are required, the bridge can publish qualification evidence.
Before enabling them, verify actual PR and merge-group executions (including a
failing analysis) show the dedicated App as their source. Pin **all three**
contexts to that App's numeric integration ID in the protected `next` ruleset:

- `Next CI / CodeQL (actions)`
- `Next CI / CodeQL (javascript-typescript)`
- `Next CI / detect-breaking-changes`

The bridge fails closed if any Next CI context is required without the correct
App pin or if only a subset is configured. Do not remove existing protections
until the native required-check source binding and real queue behavior have been
verified. Workflow tests validate the publication guard and credential wiring;
they do not substitute for this hosted qualification or provision infrastructure.

Status identity alone does not restrict access to the App key: the main-only
environment boundary is mandatory. Preserve that policy, the protected main
review requirements, and the bridge's trusted-run/target/policy checks together.
