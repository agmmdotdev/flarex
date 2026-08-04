# DTE01-G Receipt: Final Package Admission

## Decision

**Outcome: ADMIT one bounded transformed source slice.**

The admitted slice is `run-attempt-lifecycle-v1`: a private, host-neutral
Flarex domain package that reuses Trigger.dev run-attempt transition, retry,
failure, cancellation, lease, recovery, evidence, and requested-effect logic
while replacing Trigger storage, queue, clock, identity, product, and host
authority at explicit seams.

This is not blanket permission to copy Trigger's run engine. It admits exactly
the 25 non-discarded entries in
[`source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json), at their
recorded target paths and semantic-change budgets. The four discarded entries
remain excluded.

No source or package is created by this receipt. The implementation checkpoint
has the start condition and stop boundary below.

## Why The Outcome Is Admit

The other outcomes are rejected for this decision:

- **narrow** is unnecessary: the connected closure is already bounded to one
  complete run-attempt lifecycle and its direct behavioral tests. Removing
  start, completion, retry, cancellation, or lease recovery would make the
  first package incapable of proving its own orchestration invariants.
- **defer** is unnecessary as a source/package decision: the lifecycle closure,
  authority seams, package direction, provenance, and gates are known. Task
  identity/scope remains an implementation sequencing prerequisite, not an
  unresolved reason to select a different source slice.
- **reject** would discard mature Trigger behavior without evidence that seam
  adaptation or port translation is unsafe. The preflight found no such
  evidence.

The result follows the roadmap's reuse order: reuse and seam adaptation first,
adapter translation later, reimplementation only for the four explicitly
discarded product/out-of-scope owners.

## First Product Outcome

The first package checkpoint must provide one internally callable capability:

> Given a validated run-attempt command, expected fence, accepted private
> identity/scope references, and deterministic policy inputs, use a semantic
> Task System store port that obtains current authoritative state and database
> time inside its owning transaction, then decide and persist one transition.
> Return accepted, idempotent-already-accepted, or current-authoritative
> successes plus ordered durable requested-effect intents; retain invalid,
> stale/conflicting fence, corruption, and store failures in the typed Effect
> error channel.

The package itself decides lifecycle meaning. It does not execute SQL, deliver
effects, schedule a queue message, call a Worker, or expose an HTTP/API shape.

The accepted operations are:

```text
startAttempt
heartbeatAttempt
completeAttempt
requestCancellation
handleLeaseExpiry
inspectCurrentAttempt
```

The complete behavior includes:

- legal and illegal phase transitions;
- monotonic attempt numbers and expected fences;
- successful, retryable, exhausted, and non-retryable completion;
- deterministic backoff from supplied jitter;
- immediate versus durable retry intent;
- OOM/compute-class escalation policy without Trigger machine pricing;
- cancellation request, acknowledgement, generation, and completion races;
- worker loss, pending-start timeout, heartbeat/lease expiry, and stale wake;
- idempotent duplicate completion versus conflicting/stale completion;
- typed corruption, absence/non-disclosure, conflict, transient-store, and
  terminal-store failures; and
- ordered evidence and durable effect-intent data committed with the accepted
  transition by the future store implementation.

## Implementation Start Condition

Package creation starts only after the focused task-identity preflight fixes
the private Flarex contract for:

- tenant/customer administration versus concrete task data scope;
- task definition and immutable definition revision;
- application revision and runtime artifact binding;
- trusted environment/deployment resolution; and
- the opaque identifiers the run-attempt service may accept without becoming
  their authority.

Roadmap 02 now supplies those names and boundaries through
[`11-final-identity-admission.md`](./11-final-identity-admission.md). DTE01 does
not invent placeholder `organizationId`, `tenantId`, `environmentId`, or
generic string fields merely to start copying code. Roadmap 03 must still
confirm the internal lifecycle model names before DTE-IP01 starts.

This is a start condition, not a reopening of source admission. Reopen DTE01-B/C
only if Roadmap 02 proves that task identity requires a new package dependency,
public protocol export, different authority owner, or a change to the admitted
run-attempt semantics.

## Exact Source And Test Closure

The admitted map has 29 entries:

| Reuse class | Count | Admission result |
| --- | ---: | --- |
| `U` unchanged | 0 | No selected owner was honestly portable without a type, randomness, decoder, storage, or authority seam. |
| `S` seam-adapted | 13 | Retain control flow and behavior while replacing authority-bearing inputs/types. |
| `T` adapter-translated | 12 | Preserve semantic receipts while replacing persistence, wake/event, snapshot, and Trigger fixture mechanisms. |
| `D` discarded | 4 | Do not copy out-of-scope or wrong-authority behavior. |

The admitted source owners are:

- `run-engine/statuses.ts` lifecycle predicates;
- `run-engine/retrying.ts` retry and OOM decisions;
- core retry options/backoff, retry Schema meaning, and execution error
  classification/sanitization;
- run-engine error classification;
- selected `RunAttemptSystem` start, completion, failure, cancellation,
  heartbeat, worker-loss, and recovery orchestration semantics;
- selected `ExecutionSnapshotSystem` evidence/finalization semantics;
- run-engine construction ordering;
- run-store transactional/read-your-writes requirements; and
- event-bus fetch-current-state notification ordering.

The translated direct test owners are:

- `runAttemptSystem.test.ts`;
- `executionSnapshotSystem.test.ts`;
- `retryDecisionReadAfterWrite.replicaLag.test.ts`;
- `attemptFailures.test.ts`;
- `startRunAttemptReadResidency.test.ts`;
- `runAttemptSystemReplicaLag.guard.test.ts`;
- `cancelling.test.ts`; and
- `heartbeats.test.ts`.

Every selected symbol, file hash, target path, test path, semantic change, and
license group remains owned by the machine-readable source map. This summary
does not create an additional copy list.

## Semantic-Change Budget

The implementation may make only the semantic changes already classified in
the source map and consolidated here:

1. replace Prisma/Trigger-generated status and model owners with internal
   readonly Flarex domain types;
2. replace Zod parsing with installed Effect Schema while preserving field
   meanings and making finite/safe bounds explicit;
3. supply deterministic jitter instead of reading `Math.random`;
4. return retry durations instead of host-clock timestamps;
5. replace Trigger machine names/pricing with an opaque compute class policy;
6. replace Trigger IDs/product metadata with the accepted private task
   identity/scope references;
7. replace snapshot/Redis lock authority with a monotonic execution fence and
   database-time lease semantics;
8. replace direct Prisma/store calls with the semantic
   `TaskSystemRunAttemptStore` capability;
9. replace queue/event/waitpoint side effects with ordered durable requested
   effects; and
10. translate Trigger fixtures into deterministic domain/service receipts.

The implementation may refactor composition to the accepted Effect service and
Layer shape. It may not change transition order, attempt numbering, retry
rounding, first-failure order, terminal classification, cancellation race
meaning, or retained event/effect order without a new map entry and explicit
compatibility divergence.

## Exact Package Contract

The package is:

```text
@flarex/durable-task
packages/durable-task/
private: true
only export: ./internal/run-attempt-v1
only runtime dependency: effect@catalog:
```

Its manifest is fixed by the
[`package-boundary receipt`](./02-source-map-and-package-boundary.md), including
root-catalog TypeScript/Vitest development dependencies and no independent
versions.

Its `tsconfig.json` is also exact:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": [],
    "noUncheckedIndexedAccess": true
  },
  "include": ["src", "test"]
}
```

This deliberately removes the root base's DOM and Cloudflare ambient globals.
The domain cannot acquire HTTP, cache, host clock, random-ID, Worker, or Node
authority merely because those names would otherwise typecheck.

Its complete admitted checkpoint shape is:

```text
packages/durable-task/
  package.json
  tsconfig.json
  THIRD_PARTY_NOTICES.md
  trigger-source-map.json
  licenses/
    trigger-apache-2.0.txt
    trigger-core-mit.txt
  src/runAttempt/
    Model.ts
    Schema.ts
    Errors.ts
    Policy.ts
    Services/RunAttemptLifecycle.ts
    Services/TaskSystemRunAttemptStore.ts
    Layers/RunAttemptLifecycleLive.ts
    v1.ts
  test/runAttempt/
    policy.test.ts
    lifecycle.test.ts
    compatibility-receipts.test.ts
    trigger-store-routing.compat.test.ts
    execution-evidence.compat.test.ts
    retry-authority.compat.test.ts
    failure-retry.compat.test.ts
    start-authority.compat.test.ts
    completion-authority.compat.test.ts
    cancellation.compat.test.ts
    lease-recovery.compat.test.ts
```

The source-map target paths are mandatory even where this display groups the
same behavior into a broader test suite. No root export, second subpath,
protocol export, SDK type, adapter export, or compatibility metadata export is
admitted.

## Service, Port, And Adapter Ownership

The admitted package owns:

- pure readonly run-attempt models, Schema decoders, typed errors, and policy;
- the `RunAttemptLifecycle` Effect service contract and implementation;
- the `TaskSystemRunAttemptStore` Effect service contract;
- immutable requested-effect intent data; and
- `RunAttemptLifecycleLive`, which requires the store and immutable policy
  configuration.

The store port is semantic, not repository/CRUD access. One accepted operation
must let the later adapter open its transaction, get database time, load and
decode state, run a synchronous pure decision, compare the fence, atomically
persist state/evidence/result/effect intents, and return the commit receipt.
No Drizzle transaction or query builder escapes the adapter.

Later owners are fixed:

| Capability | Later owner |
| --- | --- |
| task identity/scope/revision/artifact inputs | Roadmap 02 private Flarex contract |
| Postgres/PGlite `TaskSystemRunAttemptStore` implementation | `@flarex/persistence-postgres` under the Task System/Postgres roadmap |
| durable requested-effect delivery | `flarex-backend` host composition |
| wake, retry, alarm, queue, runtime dispatch | owning Cloudflare/runtime roadmaps and backend adapters |
| observability read models/live invalidation/UI APIs | observability roadmap, never the lifecycle write authority |

The first package checkpoint uses a deterministic test store Layer only. It
does not include a production or reusable in-memory persistence implementation.

## Explicitly Excluded Trigger Behavior

The admission excludes:

- Trigger organization, membership, project, environment, deployment, auth,
  billing, pricing, and public SDK/management payload ownership;
- Prisma clients, Prisma-generated types, schema, migrations, and transactions;
- Redis cache, queue, pub/sub, Lua/keyspace protocols, Redlock, and worker
  heartbeat scheduling;
- waitpoints, checkpoints, child runs, batch propagation, delayed runs,
  concurrency/fair queue policy, debounce, and broad scheduling;
- Node supervisor, Docker, Kubernetes, registry, and Trigger compute-provider
  lifecycle;
- Trigger event payloads, telemetry exporters, dashboard projections, and live
  UI APIs;
- host wall-clock/random/ID authority;
- HTTP, Fetch, Cloudflare, workerd, Wrangler, Durable Object, Worker Loader,
  and deployable app dependencies; and
- any modification to Flarex application-row OCC, commit compiler, transaction
  journal, commit/change feeds, outbox, or authoritative application rows.

These exclusions are not TODOs inside `@flarex/durable-task`. Each requires its
own later owner and preflight.

## Provenance And License Admission

Every transformed source/test file must start with the exact leading
attribution header defined by
[`DTE01-D/E`](./03-provenance-and-compatibility-harness.md). Multi-origin files
use the exact multi-source marker and retain their detailed origins in
`trigger-source-map.json`.

The package distributes:

- `THIRD_PARTY_NOTICES.md` with Trigger.dev, repository, pinned commit, license
  groups, core copyright, source-map reference, and changed-source statement;
- the exact pinned Apache 2.0 repository license;
- the exact pinned Trigger core MIT license; and
- the active source map with accepted fields plus target hashes,
  transformation revision, and focused change receipts.

The initial mechanical projection and semantic adaptations must remain
separately reviewable. A future Trigger refresh cannot overwrite the package;
it follows the isolated, hash-pinned, three-way review procedure already
accepted by DTE01-D.

Release legal/trademark review remains a release gate. Package admission is not
a legal determination.

## Compatibility Admission

The first checkpoint translates the retained Trigger tests into deterministic
Flarex domain/service scenarios and canonical candidate receipts. It must cover:

- success, immediate retry, durable retry, non-retryable failure, retry
  exhaustion, and global attempt ceiling;
- cancellation before/during execution and acknowledged cancellation;
- worker loss, pending-start timeout, stale heartbeat, lease expiry, and OOM
  escalation/exhaustion; and
- duplicate/conflicting start/completion, lost completion response, stale
  fence, cancellation/lease races, durable effect intents, corruption versus
  unavailability, and database-time authority.

Upstream parity scenarios require exact normalized receipt equality when the
separate Trigger runner exists. Flarex-authority scenarios use exact JSON
Pointer divergences for:

- database fence replacing Redis lock authority;
- database time replacing host time;
- idempotent identical duplicate completion;
- atomic durable requested-effect intents;
- cancellation generation and race handling;
- corruption/unavailability separation; and
- opaque compute escalation replacing Trigger machine/pricing identity.

The package checkpoint does not fabricate a green Trigger oracle. The full
two-process differential command activates only when both runners and the
comparator exist. Until then, translated source tests and candidate receipts
are evidence, not a claim of complete cross-engine parity.

## Static, Test, And Bundle Gates

The checkpoint must pass:

```text
pnpm install --frozen-lockfile
pnpm trigger:source:verify
pnpm check:durable-task-source-map
pnpm check:trigger-compatibility-boundary
pnpm typecheck:scripts
pnpm --filter @flarex/durable-task typecheck
pnpm --filter @flarex/durable-task test
pnpm test:scripts
```

The root lockfile may change only by adding the reviewed workspace importer;
no new catalog version or Trigger dependency is admitted.

Once `packages/durable-task/` exists, the source-map command must report
`admitted-package`, validate every target hash/header/change receipt, exact
license copy, notice, export target, and distribution manifest, and fail on any
unmapped adapted file.

The production boundary must prove:

- only `effect` and contained `src` relative imports in package production
  source;
- no host time/random/process/network/cache/crypto authority and no inherited
  DOM or Cloudflare ambient types;
- no other workspace manifest or production module activates the package; and
- compatibility runners remain test-only.

No Worker bundle proof is claimed while no deployable owner imports the
package. The first host import activates the exact Wrangler/metafile gates in
DTE01-F in the same checkpoint as its allowlist.

## Rollback And Removal

Before a production adapter or consumer exists, rollback is source-only and
complete:

1. remove `packages/durable-task/` and its root-lockfile importer;
2. remove only package-checkpoint scripts added specifically for its tests, if
   any;
3. retain the frozen Trigger island and DTE01 receipts as rejected/withdrawn
   evidence unless a new roadmap explicitly supersedes them; and
4. rerun root source, boundary, typecheck, and test gates.

No database migration, deployed resource, route, queue consumer, alarm, durable
state, dual write, or external API needs rollback because none is authorized in
the checkpoint. Once a later owner creates persistent or hosted state, its own
roadmap must define forward/rollback semantics; this admission cannot be used
as that authority.

## Exact Next Implementation Checkpoint

After Roadmap 02 supplies the accepted private identity/scope inputs and the
run-attempt roadmap confirms the internal lifecycle model names, execute one
coherent checkpoint named:

> **DTE-IP01: Run-Attempt Domain Package Transplant**

DTE-IP01 must, in one reviewed change:

1. add the complete package/notice/license/map structure above;
2. materialize every admitted target file with auditable traceability for all
   25 non-discarded source-map entries;
3. apply only the ten admitted semantic-change categories;
4. implement pure models, Schema, errors, policies, both Effect services, and
   the live domain Layer;
5. add the deterministic test store Layer and all mapped/Flarex-added focused
   tests;
6. produce candidate compatibility receipts without claiming an unavailable
   Trigger oracle result;
7. update the root lockfile only for the new workspace importer; and
8. pass every package-creation gate above.

This is a medium implementation checkpoint, not a package shell or one-helper
experiment. It is also not the database vertical.

## DTE-IP01 Stop Boundary

Stop and return to roadmap review when the package and its deterministic tests
are green. DTE-IP01 must not:

- add tables, SQL, Drizzle schema, migrations, or a Postgres/PGlite adapter;
- edit `@flarex/persistence-postgres` or `flarex-backend`;
- add an app/package dependency on `@flarex/durable-task`;
- weaken the pre-host activation gate or add a host allowlist;
- implement queue, alarm, cron, Durable Object, service binding, HTTP, compute,
  observability, or UI adapters;
- add public protocol, SDK, management API, or package-root exports;
- add the Trigger workspace to the root lockfile/workspace;
- create a dual engine, shadow execution, dual writes, fallback, or production
  route; or
- change existing Flarex OCC/commit/feed/outbox owners.

Any required step beyond that boundary stops DTE-IP01 and returns to the owning
roadmap instead of being treated as incidental integration work.

## DTE01 Completion Receipt

DTE01 is complete because:

1. the first product outcome and connected source/test closure are exact;
2. all 29 entries have one reuse class and all four discards justify rejecting
   unchanged reuse, seam adaptation, and translation;
3. the private package, paths, export, dependencies, service/Layer, and adapter
   direction are fixed;
4. wrong Trigger product/infrastructure authority is explicitly excluded;
5. provenance, notices, licenses, refresh, scenarios, receipts, and divergences
   are fixed;
6. pre-admission gates are executable and admitted-package/host gates activate
   fail-closed with their owners;
7. rollback is complete before persistence or host integration; and
8. DTE-IP01 is substantial, bounded, production-inert, and has an exact stop
   boundary.

The decision is **admit**. The private task definition/identity/scope
prerequisite is complete through DTE02-G, and Roadmap 03 admits the internal
run-attempt model through DTE03-G. The next implementation action is now
exactly DTE-IP01 under this receipt's package and stop boundaries.
