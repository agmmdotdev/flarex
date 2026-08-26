# Private Standard Edge-Action Vertical

## Status And Decision

**Status:** AAV-A1, AAV-A2, and SAP07 are accepted and complete privately. The
later Application migration retained their single durable action/effect
lifecycle while replacing candidate-bound execution authority with the current
`application_v1` authority. The unversioned `ApplicationActionSystem` and thin
Standard consumer now compose issuer-backed active Application selection,
generation-aware durable request/outcome authority, the scoped
`ApplicationActionHostComposition`, authenticated Source Artifact V2 loading,
fresh `ApplicationExecutionHost` execution, and R2 argument/result ownership.
The displaced candidate-bound service is explicitly
`LegacyApplicationActionSystemV1` and is reachable only through retained
migration/system-test owners; it is not a fallback or comparison runtime.

No current action owner adds a production route, binding, trigger, scheduler,
or public caller. `@flarex/durable-task` separately owns task run/attempt
lifecycle and sequenced orchestration requests; it does not turn direct actions
into tasks and does not own action external-effect dispatch evidence. The one
action lifecycle still distinguishes confirmed pre-dispatch failure from an
external effect that may have succeeded before its response was lost without
creating task lifecycle.

The current direct Action contract is foreground request/response external I/O
only. Durable Tasks are the sole engine for background, queued, delayed,
retryable, and scheduled work. `ApplicationActionSystem` is therefore not a
scheduler target and may not be invoked inside a Task attempt. Query/mutation
callbacks, outbound policy, source/runtime loading, fresh Worker isolation,
RPC cleanup, and external-effect evidence may converge at their existing
runtime owners; Action request/outcome authority and Task run/attempt authority
remain separate. DTE06-F0A/F0B completed that bounded runtime/provider and
authenticated-callback convergence without nesting Action lifecycle inside a
Task; the real-Cloudflare DTE06-F3/F4 proof remains separately gated.

A connected system-test preflight on 2026-08-26 identified one current-
Application composition gap in the advertised Action callback surface. The
Action host correctly retains the parent's exact `ApplicationActiveSelection`,
and `ApplicationQuerySystem` exposes a selection-bound query port, but
`ApplicationMutationSystem` exposes no corresponding selection-bound mutation
port and re-reads the active head inside its current invocation path. Therefore
the existing synthetic callback proofs do not yet establish a real generated
Action -> current Standard mutation callback. This does not invalidate the
accepted action request/effect authority, Worker, outbound, settlement, or
replay owners, but it blocks a connected `ctx.runMutation` completion claim
until [`ST-CORE-029`](../packages/system-test/CORE-ISSUES.md) is resolved. A
system-test adapter must not reproduce mutation authority or substitute a stub.
The first bounded correction now exposes the missing selection-bound operation
from the existing `ApplicationMutationSystem` owner. Direct current-System
PGlite and genuine-PostgreSQL proofs publish public and internal mutations under
one authenticated selection, replay the internal mutation without another
Worker execution, and prove the external root rejects that internal entry. They
then reject that stale selection after head movement without Worker execution
or retargeting. The Action host now forwards its verified user or anonymous
identity through the callback bridge, and invalid root input retains pre-
activation failure precedence. The separately bounded generated Cooking Action
consumer now resolves `ST-CORE-029`: it passes current analysis and Source
Artifact loading, executes one fresh Action Worker, performs two real query
callbacks, one real internal mutation callback, and one controlled outbound
request, then replays its durable result without another Worker or effect.
PGlite and fresh genuine PostgreSQL 18 prove identical authoritative commit,
feed, outbox, runtime, and effect state for the generated consumer. No route,
trigger, scheduler, or production caller was added by either correction.

Exact-final review of that consumer also exposed and resolved
[`ST-CORE-030`](../packages/system-test/CORE-ISSUES.md): concatenating an
already-maximal parent request key could exceed the transaction request-key
limit after child dispatch declaration. Child mutations now derive a bounded
protocol-owned request key from a domain-separated digest of the parent,
ordinal, callee, and canonical arguments before evidence preparation. The
maximum-length proof pins stable replay spelling and rejects false uncertainty;
it does not change mutation execution or transaction ownership.

The generated Cooking consumer now also covers three negative Action outcomes
through the same current Application path. A denied origin fails terminally
before any outbound host dispatch or effect row, a response lost after an
allowed dispatch persists `uncertain`, and a return value rejected by the
declared validator persists `failed`. Reusing each request key replays the same
invocation and terminal code without another Worker execution or outbound
request. Database-side evidence pins four invocation rows as one completed,
two failed, and one uncertain, with exactly one confirmed child mutation, one
confirmed outbound effect, one uncertain outbound effect, and no
failed-before-dispatch effect row. This is generated-application simulation
coverage only; it adds no route, trigger, scheduler, redrive, production
caller, or Action-to-Task authority.

The generated Cooking consumer now also pins child-mutation ordering across a
parent failure. One Action confirms an independently committed internal
mutation and then fails its own return validator; the application commit,
feed, outbox, child-effect outcome, and mutated recipe survive while the parent
persists `failed`. A second Action invokes a mutation whose attempted write
rolls back and whose callback rejects after dispatch declaration; the child
effect and parent persist `uncertain` rather than inventing success, rollback
authority, or a retry. Exact request replay performs no second Worker or child
mutation execution in either case. The richer Cooking definition remains
inside the existing semantic-artifact budget and adds no cross-call
transaction, Action-owned commit, redrive, route, trigger, or scheduler.

The implemented private gate is:

> **`SAP07 - Private Route-Independent Standard Edge Action`**

[`47-aav-a1-direct-action-and-shared-effect-authority.md`](./47-aav-a1-direct-action-and-shared-effect-authority.md)
now records AAV-A1 as a private protocol, R2 reference, persistence, and
transaction-owner implementation with exactly two tables. It proves that
direct action request/outcome authority does not duplicate task run/attempt
authority and that external-effect uncertainty has one narrow execution-
evidence owner reusable by direct actions and future durable-task execution
adapters. Implementation must not add action-shaped task runs, task-shaped
action attempts, dual writes, or a second retry/lease/cancellation state
machine. An in-memory Dynamic Worker proof cannot substitute for it.

[`48-aav-a2-candidate-bound-edge-action-runtime.md`](./48-aav-a2-candidate-bound-edge-action-runtime.md)
pins the exact original AAV-A2 target/profile/ABI, host-owned policy, ceilings,
Worker isolation, callback/outbound bridges, and cleanup boundary. That
candidate-bound runtime is now the retained Legacy branch; the current
Application branch reuses its admitted host policy and capability semantics
through the Application authority and execution host recorded in Roadmap 49.
The final private Standard gate
is named `SAP07` only in this roadmap and means **one route-independent public
edge action**; it does not mean FSV07 production routing or a public SDK.

SAP07 adds no schema, migration, generated runtime identity, route, binding,
trigger, or production behavior. It does not authorize FSV07 or durable-task
host integration.

## SAP07 Implementation Receipt

The private implementation adds:

- `ApplicationActionSystem`, whose scoped operation admits the exact public
  Application action request, issues one scoped host bundle and one opaque
  settlement capability, and publishes or replays the durable action outcome;
- `invokeStandardApplicationActionV1`, a compatibility-named thin consumer of
  the unversioned System service;
- `ApplicationActionHostComposition`, which owns claim, argument loading,
  callback/outbound capability sequencing, close-and-drain, and settlement
  admission; and
- the backend Application action runner, which validates the Application
  authority and calls the fresh-load `ApplicationExecutionHost` with the
  authority-pinned Source Artifact V2 runtime.

The current private PGlite and genuine-PostgreSQL proofs select a real activated
Application action, store canonical arguments and result bodies only in the R2
adapter, persist one generation-aware invocation row, and replay the completed
result without a second Worker execution. They also prove database-time expiry
recovery and durable outbound uncertainty. Request-key inspection precedes new
active Application selection, so a completed pinned outcome remains replayable
after head movement, while an admitted retry executes only when the current
issuer reproduces the exact stored Application authority. The Worker/runtime
tests remain the sandbox/global-fetch/fixed-time/deterministic-random proof;
the accepted analyzer capability matrix remains unchanged and continues to
forbid action database access and to expose only authenticated query/mutation
nested calls. SAP07 does not add `runAction`, timers, scheduler, storage,
nondeterministic crypto, or an internal-action root.

## Sources Of Truth

Read this plan with:

- [`42-standard-application-apis.md`](./42-standard-application-apis.md), which
  owns Standard API placement and sequencing;
- [`47-aav-a1-direct-action-and-shared-effect-authority.md`](./47-aav-a1-direct-action-and-shared-effect-authority.md),
  which owns the implementation-bearing AAV-A1 protocol, R2, storage,
  transaction, and validation receipt;
- [`40-host-neutral-function-runtime.md`](./40-host-neutral-function-runtime.md),
  which owns portable runtime and host-capability boundaries;
- [`41-private-standard-application-composition-and-real-system-harness.md`](./41-private-standard-application-composition-and-real-system-harness.md),
  which owns private real-system composition and truthfully records that an
  assembled action host is absent;
- [`45-private-internal-user-code-calls.md`](./45-private-internal-user-code-calls.md),
  which freezes the completed query and mutation internal-call profiles;
- [`../design-notes/flarexdb-system-apis-proposal.md`](../design-notes/flarexdb-system-apis-proposal.md),
  which owns the System/Standard authority direction;
- [`../design-notes/flarex-dynamic-worker-bundle-partitioning.md`](../design-notes/flarex-dynamic-worker-bundle-partitioning.md),
  which owns the accepted `action-edge`/`action-node` placement distinction;
- [`../packages/declarative-program/src/v1.ts`](../packages/declarative-program/src/v1.ts)
  and [`../packages/flarex/src/server.ts`](../packages/flarex/src/server.ts),
  which own the canonical function and current `ActionCtx` shapes;
- [`../packages/analysis/src/declarativeV2VerifierV1.contract.ts`](../packages/analysis/src/declarativeV2VerifierV1.contract.ts),
  which owns the current analyzer capability matrix and syscall catalog;
- [`../packages/persistence-postgres/src/candidateRuntimeProjectionV1.ts`](../packages/persistence-postgres/src/candidateRuntimeProjectionV1.ts),
  [`../packages/persistence-postgres/src/candidateRuntimePublicationRepositoryV1.ts`](../packages/persistence-postgres/src/candidateRuntimePublicationRepositoryV1.ts),
  and
  [`../packages/flarex-backend/src/artifactRuntime/DeclarativeV2ColdMaterializationProbe.ts`](../packages/flarex-backend/src/artifactRuntime/DeclarativeV2ColdMaterializationProbe.ts),
  which own `edge_action` publication references, relationships, and verified R2
  loading;
- [`../packages/persistence-postgres/src/applicationRevisionActivationV1.ts`](../packages/persistence-postgres/src/applicationRevisionActivationV1.ts),
  which owns coherent Scope-revoked active selection; and
- the current query and mutation System composers under
  [`../packages/standard-application-invocation/src/`](../packages/standard-application-invocation/src/),
  which remain unchanged callback owners rather than action durability owners.

Current Cloudflare limits remain deployment facts rather than Flarex protocol
defaults. An implementation preflight must verify the current
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Dynamic Workers custom limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/),
and
[Workers for Platforms binding model](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/)
before accepting a host policy.

## Current Evidence

### Existing owners that already compose

The canonical function model already admits `kind=action` with public or
internal visibility. The current `ActionCtx` exposes `auth`, `runQuery`, and
`runMutation`; it does not expose a database, `runAction`, scheduler, storage,
or workflow authority.

The analyzer already marks an action as database-read/write forbidden and
nested-query/mutation capable. Its current syscall catalog ends with
`runQuery` and `runMutation`; it has no authenticated outbound-I/O or
`runAction` operation. Existing exact query and mutation Workers also disable
ambient `fetch`. This is useful fail-closed evidence, not an action runtime.

Candidate publication already maps action functions to the separately named
`edge_action` execution group. PostgreSQL stores candidate relationships,
content-addressed object references, codecs, lengths, digests, and evidence;
R2 remains the sole store for module, projection, and manifest bodies. The
cold-materialization and FSV04 readiness owners already verify both transaction
and edge-action groups. No parallel artifact representation is needed.

FSV05's active reader already returns one opaque Scope-owned selection and the
registered candidate, function metadata, publication manifest, readiness, and
activation evidence needed to authenticate an action target. That authority
must be retained and revalidated; an action must never accept a caller-authored
candidate, target, R2 reference, or active-revision token.

### Missing owner

There is no current target-native action-invocation or action-effect-attempt
record, no action outcome repository, and no service that settles the following
states durably:

```text
admitted
  -> prepared
  -> effect dispatched
  -> completed | failed before effect | uncertain after possible effect
```

Mutation idempotency, OCC rerun, C07 commit recovery, mutation outcomes, feed,
and outbox are not this owner. They may settle an action's child mutation, but
cannot prove whether an arbitrary HTTP effect occurred. The legacy executor and
generated runtimes are compatibility evidence only and must not be selected as
a fallback.

This is the implementation blocker. Retrying an action after a Worker crash or
lost response could repeat a payment, email, webhook, or other external effect.
Declaring the action “at most once” without durable pre-dispatch authority would
lose admitted work on crash; declaring it “at least once” would permit duplicate
effects. Exactly-once arbitrary remote effects cannot be promised by a local
database record.

## Ordered Capability Gates

### `AAV-A1` — direct invocation and shared uncertainty authority

The completed roadmap 47 preflight admits the smallest two-table append-only
schema addition and these exact private identities:

- `flarex.system/application-action-invocation-request/v1`;
- `flarex.system/application-action-invocation-outcome/v1`;
- `flarex.system/external-effect-execution-subject/v1`; and
- `flarex.system/external-effect-attempt/v1`.

The earlier proposed
`flarex.system/application-action-effect-attempt/v1` is rejected before
implementation and receives no decoder, table, alias, or compatibility path.

The implementation must cover:

- a bounded action invocation request bound to scope, active revision,
  candidate, readiness, activation, exact action entry, canonical arguments,
  authenticated identity, compatibility date, and host-policy identity;
- request-key exact replay and contradictory-reuse rejection;
- a durable terminal validated result or a typed terminal failure;
- an immutable, monotonically numbered external-effect attempt recorded before
  dispatch, including its exact request digest and stable effect key;
- confirmed pre-dispatch rollback and retry of the exact captured request;
- “may have succeeded” uncertainty after dispatch, timeout, host crash,
  cancellation, or response loss;
- database-authoritative timestamps, fencing, decision observation, cold
  reload, and corruption behavior; and
- one short transaction owner for each state transition, never a transaction
  held across user code or external I/O.

The external-effect-attempt portion is execution evidence, not action or task
lifecycle. Its preflight must define one subject binding that can identify a
direct action invocation now and a fenced durable-task attempt later without
making either identity an alias of the other. A task attempt continues to own
its run version, execution fence, lease, heartbeat, retry, cancellation, and
terminal transition through `@flarex/durable-task` and the Task System API. A
direct action continues to own its request key, request lifetime, validated
result, and typed non-completed result. The shared evidence owner may record an
exact outbound request and its dispatch uncertainty; it may not schedule,
retry, claim, cancel, or complete either parent lifecycle.

The durable-task domain's `flarex.task-requested-effect.v1` values are internal
orchestration requests such as attempt dispatch, wakeup, cancellation, event
publication, and notification. They are not user HTTP/payment/email effect
attempts and must not be reused or widened as the external-effect evidence
protocol merely because both use the word `effect`.

The required semantic posture is:

- exact completed-request replay returns the stored validated result;
- a confirmed failure before user code or effect dispatch may retry the exact
  request;
- after any external or child-mutation dispatch that may have succeeded, the
  action is not automatically re-executed;
- uncertain state is durable and visible as a typed result, never normalized to
  success or ordinary retryable failure; and
- a stable effect key permits remote idempotency only when the destination
  explicitly honors that contract. It does not create exactly-once delivery.

Direct action invocation remains separate from durable-task identity,
definition, scheduling, run/attempt lifecycle, and retry policy. The shared
external-effect evidence boundary must nevertheless be compatible with and
reusable by the durable-task compute path rather than duplicated behind a
second private API. It remains separate from mutation outcomes and the commit
outbox. If the first direct action needs redrive, background orchestration, or
task creation, that is another gate.

### `AAV-A2` — candidate-bound edge-action exact runtime

After `AAV-A1`, assemble one Cloudflare-compatible Dynamic Worker/Worker Loader
equivalent for the `edge_action` group. This runtime is independently invokable
by SAP07. A durable task may later reuse its lower-level sandbox, outbound,
callback, and materialization mechanics through a narrow compute/execution
port, but it retains a separate `durable_task` target, task context, and task
runtime identity. The expected private action identities are:

- `flarex.system/candidate-bound-edge-action-runtime-target/v1`;
- `edge-action-exact-runtime-v1`; and
- `flarex.system/edge-action-syscall-abi/v1`.

The implementation preflight in
[`48-aav-a2-candidate-bound-edge-action-runtime.md`](./48-aav-a2-candidate-bound-edge-action-runtime.md)
now pins these spellings, the separate runtime-format/entrypoint and host-policy
identities, their canonical preimages, bounds, cleanup semantics, and generated
closure. Implementation remains separately gated. The accepted query,
mutation, and internal-call identities are not widened.

The target must bind the live active selection, registered revision/candidate,
readiness and activation receipts, public action entry, `edge_action`
projection, manifest membership, function metadata and validators, module and
export, exact R2 references/codec/length/digests, compatibility date, outbound
allowlist, callback policy, and host-policy identity. The Worker receives only
explicitly bound capabilities.

The first host is Worker-compatible `action-edge`. `action-node`, Node built-ins,
provider adapters, and heavy/job execution remain separate. There is no silent
spill, legacy runtime, dual profile, or fallback.

The first host-policy proposal to pressure-test is deliberately bounded:

- 1,000 ms configured CPU and 30 seconds wall time;
- the platform's 128 MiB memory ceiling, with Flarex byte/object/module budgets
  staying below it;
- 64 total action syscalls, at most 16 outbound requests, at most 4 concurrent
  outbound requests, and a Dynamic Worker subrequest ceiling of 64;
- 1 MiB canonical arguments, 1 MiB canonical result, 1 MiB per outbound request
  body, 8 MiB per outbound response body, and 16 MiB cumulative outbound bytes;
- no redirects, unbounded streaming, `waitUntil`, timers, scheduler, storage,
  ambient credentials, uncontrolled platform `fetch`, or raw service bindings;
- a database-authoritative invocation timestamp exposed as fixed `Date.now`, a
  durable request-owned seed exposed through deterministic `Math.random`, and
  no nondeterministic `crypto.getRandomValues` or `randomUUID` in the first
  slice; and
- bounded cancellation/drain that does not return the host resource until the
  Worker and every owned subrequest have settled or produced typed cleanup
  uncertainty.

Roadmap 48 verified and pins these as the first private implementation
constants, including a 5,000 ms post-cancellation tracked-capability drain.
They live in one canonical
`flarex.system/edge-action-host-policy/v1` frame owned by trusted host
configuration. The current policy digest must match the AAV-A1 request and
runtime target or execution is stale/invalidated. A configuration or
generated-source identity refresh is not a protocol-version change unless
canonical wire semantics change.

### `SAP07` — one private Standard public edge action

Only after `AAV-A1` and `AAV-A2` may the final vertical implement:

```text
invokeApplicationActionV1(
  activeRevision,
  functionRef,
  args,
  requestKey,
) -> durable completed validated action value | typed non-completed result

invokeStandardApplicationActionV1(
  functionRef,
  args,
  requestKey,
) -> same System result
```

The root is one externally admitted `kind=action`, `visibility=public` function.
Direct selection of an internal action is forbidden. `runAction` and internal
actions remain a later gate.

The developer-visible first-slice surface is exact: `ctx.auth`, `ctx.runQuery`,
`ctx.runMutation`, fixed invocation time, deterministic request-owned
`Math.random`, and the ordinary global `fetch` spelling backed by the narrow
record-before-dispatch host capability. It does not expose `ctx.db`,
`ctx.runAction`, timers, scheduler, storage, `waitUntil`, uncontrolled bindings,
or nondeterministic crypto randomness. The analyzer and generated Worker must
reject or remove every unavailable surface; importing a global name is not
authority.

`ApplicationActionSystem` owns shared private composition through a Layer. Each
invocation's active Application selection, durable claim, runtime target,
callback capability, outbound adapter, Worker, cancellation, and cleanup state
remain Scope-owned. The System Effect requires
`ApplicationActionSystem | Scope.Scope`; the thin Standard consumer delegates
selection, admission, execution, and settlement to that service and preserves
its Scope requirement.
Neither service may expose raw persistence, R2 administration, database,
transaction, Worker Loader, binding, or provider credentials.

## Exact First-Slice Call Matrix

| Caller | Callee/operation | First action vertical |
| --- | --- | --- |
| External private System/Standard caller | public action | Allowed after all three gates |
| External caller | internal action | Forbidden |
| Action | authenticated query, public or internal | Allowed only as a separate callback invocation |
| Action | authenticated mutation, public or internal | Allowed only as a separate SAP04/C07 invocation |
| Action | action | Forbidden; no `runAction` |
| Query or mutation | action | Forbidden; existing runtimes gain no action authority |
| Action | direct app database, index, journal, or transaction | Forbidden |
| Action | controlled outbound HTTP | Allowed only through `AAV-A1` effect-attempt authority and `AAV-A2` host capability |
| Action | scheduler, storage, workflow, durable/background task | Forbidden |

Action callbacks are not inline shared transactions:

- every `runQuery` opens a fresh coherent read through the accepted active
  selection and PQV-A1/SAP05 owners; it shares no action snapshot;
- every `runMutation` obtains its own child request key derived from the durable
  action invocation, monotonic callback ordinal, exact callee, and canonical
  arguments, then enters the existing SAP04/C07 path with its own grant,
  attempt, transaction, outcome, feed, and outbox;
- callbacks stay on the action's exact active revision/candidate and cannot
  re-resolve to a newer head mid-invocation;
- awaited callbacks order naturally; dropped or overlapping calls are rejected
  by analysis where possible and drained defensively by the host;
- there is no cross-call transaction, savepoint, rollback, journal, or child
  outcome owned by the action runtime; and
- a query response loss or a child mutation whose outcome cannot yet be
  observed leaves the parent action non-completed/uncertain. User code is not
  restarted merely to reconstruct its continuation.

The child callback port is private and authenticated. It may select public or
internal query/mutation entries from the exact candidate catalog, but caller
code supplies only the canonical function reference and arguments. It cannot
author metadata, target identity, active selection, request key, grant, or
database authority.

## Failure And Result Ownership

The durable System result is not merely a Worker return value. It is one of:

- a completed, durably stored, validator-checked canonical action value;
- a typed not-admitted or contradictory-request result;
- a typed application/argument/result-validation failure;
- a retryable integration failure proven to precede user-code/effect dispatch;
- a durable uncertain result after possible external or child-mutation effect;
- stale/superseded authority or host-policy invalidation;
- corruption or evidence mismatch; or
- cancellation before dispatch versus cancellation/cleanup uncertainty after
  dispatch.

Expected typed failures remain in the Effect error channel. Defects and full
Cause, including unexpected host/runtime defects and interruption, are not
flattened into ordinary action errors. Foreign Promise/Worker/fetch failures
are mapped once at their owning adapter. Cleanup uses scoped acquisition and
release; release failure combines with the original Cause rather than replacing
it.

Application code may catch only declared application errors and deterministic
argument/result validator failures from authenticated callbacks. Stale
authority, callback/target mismatch, R2 corruption, host protocol failure,
resource exhaustion, timeout, cancellation, uncertainty, cleanup failure, and
defects remain terminal outside the user Promise chain.

## Implementation Order And Owned Paths

### `AAV-A1` implementation allowlist

- one private direct-action invocation protocol plus one narrowly shared
  external-effect evidence protocol and vectors under
  `packages/flarex-protocol/src/`;
- one R2 execution-evidence body adapter/reference closure without PostgreSQL
  body storage;
- one append-only migration plus matching Drizzle schema/meta closure under
  `packages/persistence-postgres/`;
- one private repository/facade with PGlite and genuine-PostgreSQL tests;
- the smallest backend coordinator port needed to claim/observe direct-action
  state plus an execution-evidence port that is not an orchestration API;
  and
- this roadmap, roadmap 42, the System API proposal, and the roadmap registry.

Roadmap 47 owns the exact operations, two-table ceiling, body ownership,
transaction rules, hostile cases, and validation matrix.

It must stop if proposed rows duplicate task run/attempt/effect-sequence state,
if the subject binding cannot preserve distinct direct-action and task-attempt
identities, if effect redrive is required, or if mutation outcome/outbox
identities would change.

### `AAV-A2` likely allowlist

- private protocol target/profile/ABI and vectors;
- function-runtime action kernel;
- backend R2 target derivation, Dynamic Worker core/host, generated closure,
  outbound and callback adapters;
- persistence authority claiming through narrow existing active-selection and
  publication owners; and
- focused unit, Workerd, PGlite/PostgreSQL, and roadmap updates.

### `SAP07` implementation allowlist

- private System action service and thin Standard consumer beside the current
  query/mutation composers;
- one private backend coordinator as first consumer;
- focused complete-vertical tests; and
- directly owning roadmap reconciliation.

Package extraction is not preapproved. Keep the first composition beside its
existing private owners unless a separate package-boundary gate proves a real
cycle or second consumer.

## Acceptance Matrix

### Analyzer and protocol

- public action root admitted; internal root, query/mutation-to-action,
  `runAction`, database, scheduler, storage, timers, uncontrolled fetch, and
  nondeterministic crypto rejected; capability-backed global fetch, fixed time,
  and deterministic request-owned random admitted only for the action profile;
- exact static callback references admitted and dynamic/forged/wrong-kind,
  visibility, group, module, export, and candidate references rejected;
- canonical request, outcome, effect-attempt, target, and syscall vectors;
- hostile decoding, field perturbation, ordering, bounds, clone/alias safety,
  and deterministic generated identities.

### Direct invocation and shared uncertainty

- exact request replay, contradictory reuse, concurrent admission winner,
  rollback at every write boundary, cold reload, fence/epoch invalidation, and
  corruption rejection;
- confirmed pre-dispatch failure retries exact captured bytes;
- dispatched external effect plus lost response becomes durable uncertain and
  does not re-execute user code;
- completed validated result replays without Worker execution;
- cancellation before dispatch versus after possible dispatch; and
- PGlite plus genuine PostgreSQL fresh/upgrade/concurrency/rollback/decision-
  uncertainty evidence with server version and zero skips.

### R2 and Workerd

- warm/cold/reload/replay materialization of exact `edge_action` projection,
  manifest, modules, and public action entry;
- missing/corrupt/codec/length/digest/reference/module/export/candidate/host-
  policy mismatch rejection;
- controlled outbound stub with request/response byte budgets, allowlist,
  concurrency, cancellation, timeout, partial success, response loss, and
  resource return;
- no ambient bindings or PostgreSQL bodies; and
- no legacy runtime fallback or dual profile.

### Callback and regression proof

- action-to-query uses a fresh coherent read and publishes no mutation fact;
- action-to-mutation uses one separate SAP04 request/outcome and publishes only
  its existing authoritative row/feed/outbox facts;
- callback ordering, stale active selection, contradictory child request,
  typed catchability, terminal poisoning, cancellation, and uncertainty;
- no shared journal, snapshot, SQL transaction, savepoint, or action-owned child
  commit;
- SAP04/SAP05/SAP06, PQV-A1/PQV-A2, C03/C07, FSV04/FSV05, readiness,
  activation, R2, generated identity, Effect-boundary, database metadata, and
  diff regressions; and
- both mandatory exact-final reviewers for every later significant
  implementation diff.

## Explicit Exclusions

This plan does not authorize:

- FSV07, production routing, caller switches, bindings, triggers, public SDK
  stabilization, or legacy removal;
- schedules, cron, actions calling actions, workflows, workflow mutations,
  background/durable-task creation or orchestration, Trigger.dev runtime
  integration, or effect redrive;
- Node actions, Node host extraction, provider-specific callbacks, containers,
  heavy jobs, or automatic platform spill;
- relations, Payload, Medusa, generic queries, index scans, SQL batches, or
  storage APIs;
- activation/readiness expansion, another active reader, alternate OCC/commit,
  cross-call transactions, dual writes/acceptance, fallback, or PostgreSQL
  artifact bodies; or
- schema/migration work outside the exact two-table AAV-A1 shape in roadmap 47.

## Next Gate

SAP07 is accepted and complete privately. Stop at this
checkpoint. Do not start FSV07, routes, schedules, or durable-task host
integration from SAP07 completion; each requires its own current roadmap gate.
