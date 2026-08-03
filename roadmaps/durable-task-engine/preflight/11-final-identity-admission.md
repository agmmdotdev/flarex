# DTE02-G: Final Task Identity And Scope Admission

## Decision

**Outcome: ADMIT the DTE02 private identity and authority contract.**

DTE02-A through DTE02-F now form one coherent prerequisite for the admitted
`@flarex/durable-task` package. The contract gives every task-definition,
scope, revision, runtime, run, attempt, lease, cancellation, and store input an
explicit owner without importing Trigger product identity, Flarex persistence
types, or a public protocol into the domain package.

The decision is not blanket implementation authorization. Roadmap 03 is now
active because DTE01's original package start condition also requires exact
lifecycle phase, outcome, failure, retry, evidence, and effect unions. DTE03-A
through DTE03-D have completed the source inventory, aggregate, failure/retry
policy, and cancellation/heartbeat/lease/race checkpoints; DTE03-E's closed
operation-result contract is next. Only after the complete focused contract is
accepted may DTE-IP01 create
the production-inert domain package under DTE01's existing stop boundary.

No schema, migration, Postgres adapter, backend composition, runtime dispatch,
public API, queue, scheduler, observability UI, or production route is admitted
by this receipt.

## Why The Outcome Is Admit

The alternative outcomes are rejected:

- **revise** is unnecessary because the one audit correction—making
  `heartbeatAttempt` explicit—was incorporated by DTE02-F. Heartbeat source,
  semantics, and tests were already admitted by DTE01, so this did not widen
  the source closure.
- **defer** is unnecessary for identity/scope. Every identity and authority
  needed by DTE-IP01 has an exact owner and representation. Active Roadmap 03
  remains a sequenced lifecycle-model prerequisite, not an unresolved identity
  defect.
- **reject** would discard a contract that reuses current Flarex application,
  activation, runtime, and scope authorities while preserving Trigger's useful
  task/run/attempt semantics. The audit found no conflicting owner or unsafe
  dependency.

The accepted result follows the roadmap's reuse order: retain Trigger domain
semantics, seam-adapt authority-bearing inputs, translate persistence behind a
narrow port, and reimplement only Trigger ID mechanics whose region,
residency, partition, Kubernetes, or legacy-routing meanings conflict with
Flarex authority.

## Consolidated Contract

### Logical Definition

The logical task key is:

```text
(trusted scope, TaskIdV1)
```

`TaskIdV1` is a stable developer-owned key in the canonical Standard
Application task catalog. It is not a function path, action alias, module,
export, artifact, deployment, or global identifier. Duplicate IDs in one
application fail during analysis. The accepted spelling is exact and remains
stable across application revisions.

The current action/internal-action prototype does not own task identity,
definition, runtime group, context, or lifecycle. A future public Trigger-style
producer must lower into the private task catalog rather than create another
definition model.

### Immutable Definition Revision And Runtime Binding

`TaskDefinitionRevisionIdV1` is a storage-issued
`taskdef_<canonical-lowercase-UUIDv4>` identity for one accepted immutable
`TaskDefinitionRuntimeBindingV1` under scope. It is not content-derived and is
not an application revision, task ID, manifest digest, artifact ID, or runtime
target digest.

Identical binding registration converges through a scope-local unique semantic
binding key. Different task manifest, handler, validator, application
revision, artifact, projection, runtime specification, retry, duration,
compute, or queue evidence cannot converge.

The binding is a child of the existing application revision and activation
chain. It uses a separate `durable_task` projection and materialization
evidence, not the action or `edge_action` prototype. A new run begins from an
issuer-backed active selection and records the activation receipt that
authorized it. Existing runs recover from their stored definition revision
and immutable objects without consulting `latest` or the current active head.

### Durable Run And Attempt

`TaskRunIdV1` is `run_<canonical-lowercase-UUIDv4>` and is issued by the
separate idempotent new-run Task System operation. DTE-IP01 consumes an
already-created run and never accepts a caller-chosen run ID for creation.

`TaskAttemptIdV1` is `attempt_<canonical-lowercase-UUIDv4>` and names attempt
history. `TaskAttemptNumberV1` is a positive safe-integer retry-policy ordinal.
`TaskExecutionFenceV1` is a positive signed-64-bit bigint that authorizes the
current execution ownership generation. These values are nominally and
semantically distinct.

The persistence operation allocates attempt ID and fence inside the same
authoritative transaction in which lifecycle policy accepts the grant. An
attempt ID or number alone cannot heartbeat, complete, acknowledge
cancellation, or commit a retry.

### Monotonic Lifecycle Evidence

DTE-IP01 additionally owns:

- `TaskRunVersionV1` for every accepted run-attempt mutation;
- `TaskLeaseVersionV1` for each lease grant or renewal;
- `TaskCancellationGenerationV1` for accepted cancellation requests;
- `TaskHeartbeatSequenceV1` for idempotent attempt-local heartbeat delivery;
  and
- `TaskRequestedEffectSequenceV1` for persisted run-local effect order.

Run, lease, cancellation, and effect versions are bounded signed-64-bit bigint
values encoded as canonical decimal text. Heartbeat sequence is a positive
safe integer. No value wraps or resets at exhaustion.

An execution fence proves ownership. A run version detects stale lifecycle
work. A lease version invalidates an old expiry wake after renewal. A heartbeat
sequence prevents duplicate delivery from extending a lease twice. A
cancellation generation identifies the request an execution acknowledges.
None substitutes for another.

### Time, Retry, Result, And Completion Evidence

Authoritative time is `TaskDatabaseTimeMsV1`, observed inside the Task System
transaction. Commands do not contain a host timestamp, absolute retry time, or
requested lease expiry.

The host supplies a bounded `TaskRetryJitterV1` when an attempt starts; the
accepted attempt stores it so completion replay cannot recalculate another
backoff. Bound policy retains retry eligibility, attempt limits, compute
escalation, and terminal classification.

The first domain package receives only `TaskResultCommitmentV1`: codec, bounded
byte length, and an owned 32-byte SHA-256 digest. It does not receive raw output
or an object-store locator. Completion identity is the attempt/fence composite
plus canonical completion value. Identical redelivery reconstructs the stored
receipt; a different completion for that composite is a conflict.

## Closed Identity And Authority Inventory

### Control Plane And Scope

| Authority/value | Owner | Serializable into DTE-IP01 command? | Admission result |
| --- | --- | --- | --- |
| tenant/customer | backend control plane | no | administration only; not data-plane routing |
| project/environment/deployment | backend resolution | no | authenticated route inputs, not task identity |
| issuer-backed active application selection | current application activation owner | no | reused for new-run binding only |
| trusted scope capability | persistence-owned factory plus backend composition | no | dynamically supplied operation capability |
| scope ID, epoch, storage generation/fence, locator | persistence | no | captured and transaction-revalidated out of band |
| database time | Task System transaction | no as input; yes as returned evidence | sole lease/retry/event time authority |

### Definition And Runtime

| Value | Owner | DTE-IP01 use |
| --- | --- | --- |
| `TaskIdV1` | Standard Application task catalog | absent; host resolves before run creation |
| application revision ID | existing registration/activation chain | absent from lifecycle command |
| `TaskDefinitionRevisionIdV1` | Task System binding registration | loaded from stored run; returned in accepted dispatch intent |
| `TaskDefinitionRuntimeBindingV1` | application/runtime binding owner plus Task System persistence | opaque to domain package |
| `TaskRunCreationAuthorityReceiptV1` | new-run Task System operation | audit/idempotency evidence outside DTE-IP01 |
| artifact/object/runtime target identities | application/runtime/compute owners | resolved after accepted attempt; never caller target input |

### Run-Attempt Domain

| Value | Owner | Authority meaning |
| --- | --- | --- |
| `TaskRunIdV1` | new-run Task System operation | scope-local durable run locator |
| `TaskAttemptIdV1` | attempt grant transaction | attempt history locator |
| `TaskAttemptNumberV1` | lifecycle retry policy | descriptive policy ordinal |
| `TaskExecutionFenceV1` | attempt grant transaction | current execution ownership generation |
| `TaskRunVersionV1` | lifecycle transition | optimistic run-attempt mutation version |
| `TaskLeaseVersionV1` | grant/heartbeat transition | current lease generation |
| `TaskCancellationGenerationV1` | cancellation transition | current accepted cancellation request |
| `TaskHeartbeatSequenceV1` | trusted runtime adapter plus store state | idempotent heartbeat delivery; not authority alone |
| completion identity | attempt/fence plus canonical completion | identical replay versus conflicting redelivery |
| requested-effect identity | scope-bound run ID plus effect sequence | idempotent post-commit delivery |

### Deliberately Deferred Identities

The inventory is closed for DTE-IP01, but later capabilities need independent
owners:

- new-run idempotency key/request digest and retention belong to Roadmaps 03
  and 04's new-run operation;
- due-run discovery cursor and scheduler/wake delivery identity belong to
  Roadmaps 04 and 05;
- compute execution/provider instance identity belongs to Roadmap 06 and never
  replaces the execution fence;
- result-body/object reference identity belongs to the runtime/result-storage
  owner;
- observability event, trace, log, live cursor, and user-stream identities
  belong to Roadmap 07; and
- waitpoint, checkpoint, batch, debounce, cron, child-run, and schedule
  identities require their later capability roadmaps.

These deferrals do not become generic strings inside DTE-IP01. The first
package omits the fields entirely.

## Trust-Boundary Review

### New Run

```text
authenticated control-plane request
  -> trusted deployment/environment resolution
  -> issuer-backed active application selection
  -> fresh located scope authority matched to selection
  -> canonical TaskIdV1 lookup in the selected task catalog
  -> validate immutable task/runtime binding
  -> find or insert TaskDefinitionRevisionIdV1
  -> idempotently create TaskRunIdV1 and creation receipt
```

The caller cannot provide scope, definition revision, artifact, active head,
or run ID as proof of authority.

### Existing Run Operation

```text
authenticated internal request or wake
  -> reacquire scope-bound Task System store
  -> decode one closed lifecycle command
  -> open transaction on captured target
  -> validate target-local scope clock first
  -> load/decode run state under captured scope
  -> obtain database time and operation-owned allocation candidate
  -> invoke pure lifecycle decision
  -> atomically persist state/evidence/completion/effects
  -> return detached accepted/idempotent/current receipt
```

The domain package never receives scope authority, locator, database client,
transaction, clock port, random-ID port, queue handle, Worker, or runtime
artifact loader.

### Runtime And Effect Delivery

An accepted dispatch intent carries definition revision, run, attempt, number,
fence, lease version, and compute-class reference. The host separately resolves
the immutable runtime binding and supplies only restricted user-code
capabilities. Compute identity and provider credentials remain outside the
lifecycle command.

Requested effects are persisted with the transition and delivered
idempotently after commit. Their loss or duplication cannot erase or replace
durable task state. Queue/alarm delivery is a wake hint, not authority.

### Observability

Run and attempt IDs may later become authorized UI/API locators. Definition
revision ID remains internal for the first vertical. Execution fence is absent
from ordinary URLs, read models, logs, traces, and user code. Every read begins
from authenticated scope authorization; there is no global run lookup.

## Repository-Consistency Audit

### Standard Application

Current code still separates private definition, analysis, registration, and
invocation owners. `@flarex/standard-application-definition` exposes only its
versioned private definition surface and has no durable-task implementation.
The current function vocabulary still does not make a task catalog or task
runtime group authoritative.

DTE02 therefore extends the existing chain rather than bypassing it. It does
not treat the action prototype as shipped task behavior or add an implementation
before the task-catalog preflight.

### Registration, Activation, And Runtime

Current application revision registration remains content-derived from the
candidate digest and uses its existing revision identity. Current active
selection state remains issuer-backed and carries trusted scope/runtime
evidence. Current candidate runtime projection remains function-oriented.

DTE02's storage-issued task-definition revision is therefore distinct rather
than a duplicate. The proposed `durable_task` child projection is not claimed
to exist in current code and cannot be activated by this receipt.

### Scope And Persistence

Current `TrustedScopeAuthority` continues to carry deployment, scope, physical
location, storage generation/fence, epoch, and sequence evidence. Current
application operations demonstrate scope-clock-first transaction validation
and same-authority checks. Current persistence operations also provide the
established injectable `crypto.randomUUID()` generation pattern used as the
future ID-generation mechanic.

DTE02 narrows these owners behind a scope-bound port. It does not duplicate
their types in `@flarex/durable-task`, and it does not claim the current
persistence package already has task tables or an adapter.

### Protocol And Transaction Authority

`flarex-protocol` continues to own application-data transaction session and
attempt-fence contracts. Task run and execution-fence values have different
lifecycles and authority. Sharing a safe encoded representation does not make
the types substitutable or justify a protocol dependency.

The durable-task domain also does not alter application-row OCC, commit
compiler/execution, transaction journals, idempotency outcomes, feeds, outbox,
or authoritative application rows.

### Trigger Boundary

The frozen Trigger workspace remains outside the root workspace/runtime graph.
The active boundary checker rejects direct Trigger package/source imports.
DTE02 field mappings retain selected semantics without admitting Trigger
organizations, runtime environments, deployments, Prisma types, Redis locks,
queue identities, region/residency routing, worker IDs, or public result
shapes.

**Audit conclusion:** no current owner conflicts with the admitted DTE02
contract. Proposed task surfaces remain clearly labeled as future/private and
production-inert.

## DTE01 Reopening Audit

| Reopening condition | DTE02 result | Verdict |
| --- | --- | --- |
| runtime dependency beyond root-catalog `effect` | schemas, Result, services, Layers, and errors use only `effect`; ID generation stays in adapter | not triggered |
| public protocol or package-root export | only `./internal/run-attempt-v1` remains admitted | not triggered |
| persistence/backend/app/Trigger/source-island import | domain package owns opaque values and a port; all adapters stay later | not triggered |
| different lifecycle behavior/error ordering/service semantics | retained behavior is unchanged; explicit heartbeat exposes already-selected behavior | not triggered |
| host/runtime API inside domain | commands contain bounded values only; runtime binding and effect delivery stay outside | not triggered |

The DTE02-F heartbeat correction does not reopen the source map. The selected
Trigger heartbeat symbols, stale-wake semantics, durable wake translation, and
tests were already present. Omitting the method would have violated the
admission; naming it restores agreement.

The two-method store port also remains within DTE01's semantic-port budget. It
does not expose a database transaction or move lifecycle decisions into the
adapter.

## Executable Gate Contract

### Current Pre-Admission Gates

The existing commands remain mandatory and pass with no active durable-task
package:

```text
pnpm check:durable-task-source-map
pnpm check:trigger-compatibility-boundary
pnpm check:standard-application-definition-boundaries
```

They prove the frozen source map, Trigger import boundary, and current Standard
Application definition boundary. They do not falsely claim that future task
types, schemas, or runtime projections already compile.

### Roadmap 03 Gate Before Package Creation

Roadmap 03 must fix, at minimum:

- `RunAttemptPhaseV1` and terminal phase/outcome unions;
- `RunAttemptPolicyV1`, attempt ceiling, retry/OOM decisions, and error order;
- `TaskExecutionFailureV1` and terminal classification;
- the five mutation-operation outcome unions plus `RunAttemptInspectionV1`;
- `TaskRunAttemptAggregateV1` and stored replay evidence;
- `TaskRunAttemptEvidenceV1`, `TaskRequestedEffectV1`, and exact effect order;
- cancellation request/acknowledgement and lease-expiry transition tables; and
- accepted/idempotent/current versus typed failure behavior for every command.

DTE-IP01 must not invent temporary variants before that gate.

### DTE-IP01 Compile-Time Gates

When `packages/durable-task/` is created, focused compile-time assertions must
prove:

1. all identity/version/counter brands are mutually non-assignable;
2. `RunAttemptCommandV1` has exactly six closed variants;
3. each command contains only its approved fields;
4. `RunAttemptLifecycleShape` has exactly six methods;
5. `TaskSystemRunAttemptStoreShape` has exactly two methods;
6. no method exposes scope, transaction, row, clock, random, host, or Trigger
   types;
7. every service operation has the exact `RunAttemptLifecycleErrorV1` channel;
8. decision, requested-effect, phase, outcome, and error matching is
   exhaustive; and
9. the only package runtime dependency and requirement graph dependency is the
   admitted Effect/domain store relationship.

### DTE-IP01 Runtime Tests

Focused tests must prove the DTE02-E/F schema and authority matrix, including:

- canonical identity acceptance/rejection and no legacy fallback;
- unknown command-field rejection;
- duplicate/competing start behavior;
- heartbeat loss, gap, duplicate, stale fence, and stale lease wake behavior;
- identical versus conflicting completion redelivery;
- cancellation generation/completion races;
- database-time retry and lease decisions under deterministic test input;
- pure decision re-invocation;
- atomic candidate receipts and ordered evidence/effects in the test store;
- corruption/absence/stale scope/transient/terminal error distinctions; and
- forbidden import/export/dependency checks in admitted-package mode.

The full DTE01 package-creation command matrix remains authoritative. Missing
package files, tests, notices, licenses, target hashes, or activated boundary
checks fail the checkpoint; no placeholder test command may return success.

## Exact Handoff

### Current Design Action: Roadmap 03

[`../03-run-attempt-engine.md`](../03-run-attempt-engine.md) is active.
[`12-current-lifecycle-and-transition-inventory.md`](./12-current-lifecycle-and-transition-inventory.md)
completes DTE03-A's source inventory, and
[`13-phase-terminal-and-aggregate-model.md`](./13-phase-terminal-and-aggregate-model.md)
completes DTE03-B's exact five-phase aggregate, and
[`14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md)
completes DTE03-C's policy, and
[`15-cancellation-heartbeat-lease-and-race-tables.md`](./15-cancellation-heartbeat-lease-and-race-tables.md)
completes DTE03-D's transition/race tables. DTE03-E's evidence/effect/outcome/
error contract is next, followed by compatibility and final admission
checkpoints.

Roadmap 03 continues to reuse the admitted Trigger status/retry/failure/
cancellation/lease behavior and compatibility scenarios rather than redesign
from a blank state machine.

Roadmap 03 may refine lifecycle model and outcome names. It may not reopen
DTE02 identity, scope, application/runtime binding, command authority, or
store-port fields incidentally. A real conflict must explicitly return to the
owning DTE02 receipt.

### Next Implementation Action: DTE-IP01 After Roadmap 03 Gate

Once Roadmap 03 accepts the internal lifecycle model, execute DTE-IP01 exactly
as DTE01-G defines:

1. create the complete private package, notice, licenses, and active source
   map in one coherent change;
2. transform all 25 admitted non-discarded source entries;
3. implement the complete models, schemas, errors, policies, two services,
   live Layer, and deterministic test store;
4. implement all six DTE02-F service operations;
5. add translated and Flarex-specific deterministic tests and candidate
   compatibility receipts;
6. update only the workspace importer/lockfile needed by the package; and
7. pass all DTE01/DTE02/Roadmap03 package gates.

Stop when the production-inert package and deterministic tests are green. Do
not add persistence, backend, app, runtime, queue, observability, or public API
integration in DTE-IP01.

### Later Design/Implementation Actions

Roadmap 04 owns Task System run creation, schema, Drizzle/Postgres adapter,
idempotency, transactions, discovery, corruption, effect persistence, PGlite,
and real-Postgres proof. Roadmaps 05 through 10 retain their existing wake,
compute, observability, parity, private vertical, and public activation owners.

## Rollback And Reopening

DTE02 is documentation/contract admission only. Before DTE-IP01, rollback is
removal or revision of these roadmap receipts; there is no package, schema,
state, route, or deployed resource to undo.

After DTE-IP01 begins, stop and reopen the owning roadmap if implementation
requires:

- another dependency or export;
- raw scope, persistence, host, runtime, or Trigger values in commands;
- a third store-port method or generic CRUD access;
- a new identity alias, global lookup, or caller-generated authority;
- changed retained transition/error/effect ordering;
- a task-definition/runtime loader in the domain package; or
- any persistence or production integration inside DTE-IP01.

Rollback of a failed production-inert package follows DTE01-G: remove the
package importer/files and lockfile importer together, verify no app/deployable
depends on it, and rerun root boundary checks. Later roadmaps must define their
own stateful rollback before creating state.

## Explicit Non-Goals

DTE02-G does not authorize:

- implementing task definitions or the `durable_task` projection now;
- creating `@flarex/durable-task` before Roadmap 03's lifecycle-model gate;
- a partial package shell, placeholder types, or one-helper extraction;
- task tables, SQL, Drizzle schemas, migrations, or adapters;
- merging Trigger's workspace or lockfile;
- public protocol/SDK/management APIs;
- runtime execution, queue/alarm/cron handlers, Durable Objects, or Workers;
- logs, traces, metrics, live API, dashboard, or user streams;
- waitpoints, checkpoints, batches, debounce, child runs, TTL, or scheduling;
- application-data OCC/commit/feed/outbox changes; or
- production activation, dual execution, shadowing, fallback, or cutover.

## Final Receipt

DTE02 is complete with these conclusions:

1. first-class task identity belongs to the Standard Application task catalog,
   not action/function prototypes;
2. tenant administration and concrete scope authority are separate, and the
   domain receives a dynamic scope-bound capability rather than scope text;
3. task runtime evidence is bound into the existing application revision and
   activation chain through a separate `durable_task` projection;
4. each run captures one immutable task-definition revision and never follows
   a later active head;
5. definition revision, run, and attempt identities have canonical distinct
   storage-issued formats and persistence-owned generation;
6. attempt identity/number, execution fence, run version, lease version,
   heartbeat sequence, and cancellation generation have non-overlapping
   meanings;
7. DTE-IP01 commands and its two-method store port contain no raw Trigger,
   scope, persistence, clock, queue, lock, or runtime authority;
8. every retained Trigger identity field has an explicit mapping or removal;
9. current Standard Application, activation, scope, persistence, protocol,
   transaction, and Trigger-boundary owners remain consistent and unchanged;
10. no DTE01 reopening condition is triggered;
11. Roadmap 03 is active, DTE03-A through DTE03-D are complete, DTE03-E is
    next, and the full lifecycle-model gate remains the current design
    prerequisite; and
12. DTE-IP01 may start only after that gate, remains substantial and
    production-inert, and stops before persistence or host integration.

## Authority And Evidence

This final decision consolidates:

- [`../01-source-reuse-and-package-admission.md`](../01-source-reuse-and-package-admission.md)
  and DTE01's five focused preflight receipts;
- [`../02-task-definition-identity-and-scope.md`](../02-task-definition-identity-and-scope.md);
- [`06-task-target-and-definition-contract.md`](./06-task-target-and-definition-contract.md);
- [`07-scope-capability-contract.md`](./07-scope-capability-contract.md);
- [`08-application-revision-and-runtime-binding.md`](./08-application-revision-and-runtime-binding.md);
- [`09-domain-identity-types-and-ownership.md`](./09-domain-identity-types-and-ownership.md);
- [`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md);
- current Standard Application definition/invocation package manifests and
  source;
- current application registration, active-selection, scope-authority,
  transaction-session, UUID-generation, and runtime-target source/tests;
- the executable durable-task source-map, Trigger-boundary, and Standard
  Application definition-boundary checks; and
- the frozen Trigger source at the DTE01 pinned commit as compatibility
  evidence only.
