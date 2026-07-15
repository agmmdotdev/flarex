# P08 Production Deployment Preflight

Status: local evidence complete; external target identification pending.

This record freezes the production target, budget, run order, evidence path,
and teardown requirements for the isolated runtime-topology experiment. It is
not an active Flarex architecture decision and authorizes no production Flarex
binding or data access.

## Current External Target Evidence

As checked on 2026-07-15:

- `wrangler whoami` reports that this machine is not authenticated;
- no `CLOUDFLARE_*`, `CF_*`, `WRANGLER_*`, or
  `RUNTIME_TOPOLOGY_PROBE_*` environment variable is present;
- the configs intentionally contain no `account_id` or named environment; and
- therefore the exact account, Workers Paid-plan eligibility, workers.dev
  subdomain, existing-name collisions, secret state, and account cost ceiling
  are not yet proven.

This is the one P08 stop condition. It is an external target ambiguity, not a
request for per-gate implementation permission. After interactive Wrangler
authentication, record the selected account and collision checks in the task
receipt; do not commit account IDs, tokens, or secret values.

## Frozen Isolated Resource Graph

| Deployment order | Worker | Exposure | Owned Durable Objects and bindings |
| --- | --- | --- | --- |
| 1 | `flarex-runtime-topology-probe-sync` | private (`workers_dev: false`) | SQLite `ProbeSyncDO` via `PROBE_SYNC` |
| 2 | `flarex-runtime-topology-probe-mock` | private (`workers_dev: false`) | external `PROBE_SYNC` binding to the sync Worker |
| 3 | `flarex-runtime-topology-probe-gateway` | workers.dev, bearer protected | SQLite `ProbeSessionDO`, `ProbeRunDO`, and singleton `ProbeCampaignDO`; service bindings to the mock Worker; Worker Loader binding `LOADER` |

Every name has the `flarex-runtime-topology-probe-` prefix. No config name,
binding, import, or route references a production Flarex Worker, database,
namespace, queue, tenant, or secret.

The gateway must fail closed while `RUNTIME_TOPOLOGY_PROBE_TOKEN` is absent.
Supply the same high-entropy value to the gateway as a Wrangler secret and to
the local collector only through its environment. Never place it in a command
argument, config, checkpoint, artifact, log, or committed file.

## Revalidated Cloudflare Constraints

- [Durable Object facets](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/)
  run a Dynamic Worker Durable Object class as a supervisor-owned child with a
  separate SQLite database. `abort()` preserves that database; `delete()` is
  required to remove it. This matches the app's explicit facet purge journal.
- [Dynamic Worker pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)
  currently requires Workers Paid and bills unique daily workers by stable ID
  and code. `.get()` with a stable code ID avoids the per-invocation identity
  behavior of `.load()`. Requests and CPU reuse Workers Standard pricing.
- [Dynamic Worker custom limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/)
  support per-invocation CPU and subrequest ceilings. The fixed source packages
  set 50 ms CPU limits and at most one or two subrequests.
- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
  are private Worker-to-Worker calls. Each call is a subrequest and the platform
  permits at most 32 Worker invocations in one request; every frozen topology is
  well below that ceiling.
- [Durable Object migrations](https://developers.cloudflare.com/workers/wrangler/configuration/#durable-objects)
  require `new_sqlite_classes` for these new namespaces and
  `deleted_classes` before final class removal. The checked-in creation tags are
  gateway `v1` through `v3` and sync `v1`.
- [Workers tracing](https://developers.cloudflare.com/workers/observability/traces/)
  at sampling rate 1 records the bounded experiment but consumes observability
  events. Tracing is diagnostic: documented limitations include zero-duration
  non-I/O spans and evolving attributes, so the probe's own `performance.now()`
  spans remain the latency evidence.

## Frozen Run And Cost Budget

The immutable manifest remains `PROBE_LOCAL_REHEARSAL_MATRIX_V1` despite its
historical name. Its production use is exactly:

- 12 run/dimension cells across 8 scenarios;
- 32 total samples: 8 warmups and 24 measurements;
- collector concurrency 4;
- 12 stable Dynamic Worker code IDs, below the currently included 1,000 unique
  Dynamic Workers per month;
- 960 configured payload bytes and 20 configured journal entries in aggregate;
- 13 SessionDO identities, 18 facet identities, 5 sync scopes, and 12 RunDO
  identities; and
- 30 ordered purge targets: SessionDO first, sync second, RunDO last.

A one-shot full runner remains a 103-request baseline before purge: 1 campaign
registration, 24 run-status reads, 32 sample calls, 32 external-duration
acknowledgements, 1 reconciliation, 1 evidence seal, and 12 evidence-page
reads. The approved staged production flow instead makes 137 clean pre-purge
gateway requests:

- P09 smoke makes 42: 1 registration, 24 run-status reads, 8 sample calls,
  8 external-duration acknowledgements, and 1 final campaign-status read; and
- P10 resume makes 95: 1 registration, 8 checkpoint-completion replays,
  24 run-status reads, 24 remaining sample calls, 24 new external-duration
  acknowledgements, 1 reconciliation, 1 evidence seal, and 12 evidence-page
  reads.

One optional smoke replay makes 34 more idempotent requests and is the only
pre-purge retry included in the frozen budget. Any further pre-purge retry must
stop for renewed cost review. Every cleanup command invocation must use the
fixed 4-task purge batch and enforces a 256-control-step ceiling; that ceiling
is not a durable total across process restarts. The operational budget permits
at most two cleanup invocations, or 512 purge-control requests, before stopping
for diagnosis and proceeding only through the explicit teardown plan. Including
one unauthenticated gateway check, the staged path therefore has a 684-request
operational ceiling: 137 clean pre-purge + 34 one-time smoke replay + 512
cleanup + 1 auth failure. Do not use the runner's larger library fallback for
this frozen matrix.

Before deployment, the selected account owner must confirm that Workers Paid,
12 unique Dynamic Workers, 32 sample executions, 100% tracing for this bounded
run, and the 684-request operational ceiling fit the accepted cost ceiling.

## Corrected Production Sequence

P09 and P10 use one campaign and one set of namespaces. A purged campaign
retains a terminal tombstone and cannot reopen, so P09 must not purge a
successful smoke campaign.

1. Authenticate Wrangler and prove the exact account, plan, workers.dev
   subdomain, resource-name ownership, and absence of production bindings.
2. Deploy sync, then mock, then the fail-closed gateway. Install the gateway
   bearer secret without placing it on the command line.
3. Verify an unauthenticated request fails. Run one ordinal for the first cell
   of each of the eight scenarios, recording external completions in the normal
   checkpoint. Confirm all eight controlled results and that the campaign stays
   `running` and resumable. Do not reconcile, seal, or purge.
4. P10 resumes the same immutable campaign, runs the remaining ordinals,
   reconciles, seals, writes verified raw and summary artifacts, then performs
   the single application-level purge.
5. If smoke fails, do not run the remaining matrix. Use the explicit
   reconcile/seal/export/purge abort path when the protocol remains reachable;
   otherwise continue directly to namespace deletion migrations and teardown.

The local P07B rehearsal remains the pre-production proof that successful
application purge is restart-safe. Production proves that path once, after the
only evidence collection, rather than destroying the campaign between smoke
and measurement.

## Commands After Target Identification

Run from this package through the workspace-pinned Wrangler version:

```sh
corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler whoami
corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deployments list --config wrangler.sync.jsonc
corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deployments list --config wrangler.mock.jsonc
corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deployments list --config wrangler.gateway.jsonc
corepack pnpm --filter @flarex/runtime-topology-probe deploy:sync:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe deploy:mock:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe deploy:gateway:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deploy --config wrangler.sync.jsonc
corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deploy --config wrangler.mock.jsonc
corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deploy --config wrangler.gateway.jsonc
corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler secret put RUNTIME_TOPOLOGY_PROBE_TOKEN --config wrangler.gateway.jsonc
```

Do not execute the deploy or secret commands until `whoami` identifies exactly
one intended account and the three Worker names are confirmed absent or owned
by this experiment.

The teardown configurations and deletion commands can be validated locally
without authentication or an external state change:

```sh
corepack pnpm --filter @flarex/runtime-topology-probe deploy:gateway:teardown:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe deploy:sync:teardown:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe teardown:gateway:delete:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe teardown:mock:delete:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe teardown:sync:delete:dry-run
```

The two teardown deployment configs preserve the exact Worker names and prior
migration tags, switch to `src/teardownWorker.ts`, disable the gateway's
workers.dev exposure, remove every Durable Object, service, and Worker Loader
binding, and append only the deletion migration. The teardown Worker exports
no Durable Object class and returns `410 Gone` if it is reached during the
short migration-to-deletion window. The ordinary deployment configs remain
unchanged.

## Evidence And Success Criteria

- `.probe-state/` is the ignored, resumable external-duration checkpoint.
- `.probe-output/` is the ignored destination for strict raw and derived JSON.
- No checkpoint or artifact may contain the bearer token, claim token, request
  payload, tenant identifier, or production Flarex data.
- P09 succeeds only when authentication behavior, eight scenario results,
  trace availability, fixed identities, budget counters, and resumability are
  proven.
- P10 succeeds only when all 32 classifications match the manifest, persisted
  digests verify, evidence is publishable, and application purge completes.
- P11 records only sanitized conclusions and aggregate measurements in Git.

## Teardown Order

1. Verify raw and summary evidence, then complete or replay application purge.
2. Deploy a gateway teardown migration that removes its three bindings and adds
   a new `deleted_classes` tag for `ProbeSessionDO`, `ProbeRunDO`, and
   `ProbeCampaignDO`; verify the namespaces are gone, then delete the gateway.
3. Delete the mock Worker, removing the only external binding to the sync
   Worker.
4. Deploy a sync teardown migration that removes its binding and adds a new
   `deleted_classes` tag for `ProbeSyncDO`; verify the namespace is gone, then
   delete the sync Worker.
5. Verify all three scripts, the gateway secret, workers.dev route, Durable
   Object namespaces, known facets, local token environment, checkpoints, and
   raw evidence are absent or intentionally retained according to the final
   P11 receipt.

The destructive P11 sequence is fail-closed. Run each command as a separate
shell invocation after authenticated target re-verification. Never paste these
commands into one shell block. A command must exit zero and its following
remote-state check must pass before the next numbered step begins.

1. Deploy only the gateway deletion migration:

   ```sh
   corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deploy --config wrangler.gateway.teardown.jsonc
   ```

   Then list gateway deployments and inspect the authenticated Cloudflare
   binding inventory. Confirm the newest deployment is the binding-free
   teardown Worker, `workers_dev` is disabled, and `PROBE_SESSIONS`,
   `PROBE_RUNS`, `PROBE_CAMPAIGN`, `MOCK_*`, and `LOADER` are all absent.
   Use the dashboard or authenticated Durable Object Namespace List API to
   confirm that no namespace owned by the gateway script remains for
   `ProbeSessionDO`, `ProbeRunDO`, or `ProbeCampaignDO`. Stop if any check is
   missing or fails.

   ```sh
   corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deployments list --config wrangler.gateway.teardown.jsonc
   ```

2. Only after step 1 is proven, delete the gateway:

   ```sh
   corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler delete --config wrangler.gateway.teardown.jsonc
   ```

   Confirm that the gateway script, workers.dev route, and gateway secret are
   absent before continuing.

3. Delete the mock Worker, then confirm that the script and its external
   `PROBE_SYNC` binding are absent:

   ```sh
   corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler delete --config wrangler.mock.jsonc
   ```

4. Only after the mock is absent, deploy the sync deletion migration:

   ```sh
   corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deploy --config wrangler.sync.teardown.jsonc
   ```

   Then list sync deployments, confirm the newest deployment is the
   binding-free teardown Worker, and use the dashboard or authenticated
   namespace API to confirm that no namespace owned by the sync script remains
   for `ProbeSyncDO`. Stop if any check is missing or fails.

   ```sh
   corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler deployments list --config wrangler.sync.teardown.jsonc
   ```

5. Only after step 4 is proven, delete the sync Worker and verify final account
   absence:

   ```sh
   corepack pnpm --filter @flarex/runtime-topology-probe exec wrangler delete --config wrangler.sync.teardown.jsonc
   ```

For either namespace check, a first-page API response is never proof of
absence. Request the maximum supported `per_page=1000`, require
`success === true`, and inspect every page from 1 through
`result_info.total_pages`. Stop if pagination metadata is absent or
inconsistent, any page fails, or the combined result cannot be checked. Only
the fully concatenated result may prove that the exact Worker `script` plus
class pairs are absent:

- `flarex-runtime-topology-probe-gateway` with `ProbeSessionDO`, `ProbeRunDO`,
  and `ProbeCampaignDO`; and
- `flarex-runtime-topology-probe-sync` with `ProbeSyncDO`.

Do not log or commit the account identifier, API token, or full account
namespace inventory. Record only the sanitized P11 absence conclusion and the
number of pages checked.

Do not run those commands before evidence preservation and the application
purge attempt. A `deleted_classes` migration irreversibly deletes every object
and all stored data for the named class. If a Worker was never deployed, verify
its absence instead of deploying the teardown configuration merely to create a
cleanup receipt. If an earlier teardown step fails, stop and inspect the exact
remote state; do not skip ahead and strand a live external binding.

Cloudflare's [`wrangler delete`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#delete)
removes a Worker and associated platform resources, but the explicit
`deleted_classes` deployments make Durable Object class/data deletion visible
and auditable before script removal. Cloudflare's
[Durable Object migration reference](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/#delete-migration)
requires removing the binding and class reference before applying that
deletion migration; the checked-in teardown configs encode that precondition.
The authenticated
[Namespace List API](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/methods/list/)
is the machine-readable account-level check when the dashboard is not used.
