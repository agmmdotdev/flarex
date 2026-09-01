# FX02-B Hosted Catch-Up Probe

This private app proves the deployed restart gate for the production-inert
query-sync catch-up host. It is evidence tooling, not a production sync API.

The hosted runner owns exactly two temporary Cloudflare Workers:

- `flarex-query-sync-fx02b-source-probe`, a private deterministic source
  reachable only through a service binding; and
- `flarex-query-sync-fx02b-host-probe`, a bearer-protected gateway owning one
  SQLite-backed `DeploymentSyncProbeDO` namespace.

`DeploymentSyncProbeDO` subclasses the real backend `DeploymentSyncDO` only to
attach a per-constructor boot ID to its private RPC receipt. Catch-up, source,
state, capability, budget, and failure behavior remain owned by the real host.

The run is fail-closed. It refuses to reuse either Worker name, generates three
distinct ephemeral bearer values, sends them to Wrangler through a scoped
temporary directory, gives every hosted request and the complete campaign a
deadline, and retries only classified transient non-mutating identity
observations. Its strict
phase-discriminated receipt requires the exact Durable Object name and rejects
excess fields.

After the code-distinct redeploy, the runner first observes a new constructor
boot ID and Worker version through a read-only Durable Object identity RPC.
Only then does it issue one resume command and require that response to come
from the exact observed boot/version at cursor `2`; an old release cannot
advance the cursor while the runner is waiting for restart visibility.

Each deployment is marked attempted before Wrangler starts. If local command
completion is ambiguous, the runner reconciles the remote version annotation
containing the unique run ID and deletes only a Worker proven to belong to that
run. Namespace deletion precedes host deletion, source deletion runs last, and
the final success receipt is emitted only after both Worker absences are
verified. Cleanup or unknown ownership is a failed run, never a passing proof.
If host namespace teardown or deletion cannot be proven, the private source is
retained so the remaining host binding is diagnosable and not silently broken.

Local validation:

```text
pnpm --filter @flarex/query-sync-hosted-probe typecheck
pnpm --filter @flarex/query-sync-hosted-probe test
pnpm --filter @flarex/query-sync-hosted-probe deploy:source:dry-run
pnpm --filter @flarex/query-sync-hosted-probe deploy:host:dry-run
pnpm --filter @flarex/query-sync-hosted-probe deploy:host:teardown:dry-run
```

The hosted run creates and then permanently deletes its isolated Durable
Object namespace:

```text
pnpm --filter @flarex/query-sync-hosted-probe hosted:run
```

Do not run it when either fixed Worker name already exists or when the selected
Cloudflare account is not the intended isolated target.
