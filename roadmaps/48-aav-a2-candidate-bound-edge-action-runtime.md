# AAV-A2 Candidate-Bound Edge-Action Exact Runtime

## Status And Decision

**Status:** Implementation preflight complete; implementation is not yet
authorized. This record pins one private, production-inert runtime capability
that may be implemented only after explicit approval. It does not implement
SAP07, expose a route, activate a caller, or change a public SDK.

AAV-A2 is the exact `action-edge` execution substrate between the accepted
AAV-A1 direct-action/effect authority and the later SAP07 Standard System
operation. It owns candidate-bound R2 materialization, one fresh Dynamic Worker
execution, a controlled outbound gateway, authenticated query/mutation callback
ports, resource accounting, and cleanup. It owns no invocation, effect,
transaction, commit, task, readiness, activation, or routing state.

The preflight admits no schema or migration. Canonical user code, runtime
projection, manifest, arguments, results, and HTTP bodies remain in R2.
PostgreSQL remains limited to the accepted candidate relationships and AAV-A1
authority/evidence rows.

## Sources Of Truth

This record refines, but does not replace:

- [`46-private-standard-edge-action-vertical.md`](./46-private-standard-edge-action-vertical.md)
  for the ordered AAV-A1, AAV-A2, and SAP07 gates;
- [`47-aav-a1-direct-action-and-shared-effect-authority.md`](./47-aav-a1-direct-action-and-shared-effect-authority.md)
  for direct invocation, external-effect uncertainty, R2 body ownership, and
  the exact two-table ceiling;
- [`42-standard-application-apis.md`](./42-standard-application-apis.md) for
  Standard API placement and route-independent sequencing;
- [`40-host-neutral-function-runtime.md`](./40-host-neutral-function-runtime.md)
  and
  [`../design-notes/flarex-dynamic-worker-bundle-partitioning.md`](../design-notes/flarex-dynamic-worker-bundle-partitioning.md)
  for host/runtime separation and the `action-edge` placement;
- the current candidate publication, cold-materialization, readiness,
  activation, active-selection, SAP04, SAP05, C07, R2, and Worker Loader owners;
  and
- [`durable-task-engine/README.md`](./durable-task-engine/README.md) for the
  separately owned task definition, run/attempt, lease, retry, and orchestration
  lifecycle.

Cloudflare deployment facts were rechecked on 2026-08-04 against the official
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Dynamic Workers custom limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/),
[Dynamic Workers egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/),
[Dynamic Workers bindings](https://developers.cloudflare.com/dynamic-workers/usage/bindings/),
and [Dynamic Workers API](https://developers.cloudflare.com/dynamic-workers/api-reference/).
They are host facts, not permission to widen the Flarex contract.

## Accepted Private Identities

The AAV-A2 implementation may introduce exactly these private identities:

- target: `flarex.system/candidate-bound-edge-action-runtime-target/v1`;
- runtime format: `flarex.edge-action-exact-runtime`;
- runtime profile: `edge-action-exact-runtime-v1`;
- syscall ABI: `flarex.system/edge-action-syscall-abi/v1`; and
- host-policy frame: `flarex.system/edge-action-host-policy/v1`.

The first Dynamic Worker entrypoint is
`FlarexEdgeActionExactRuntimeV1`. These spellings receive canonical protocol
vectors and generated-source identity closure. There is no V0 alias, second
profile, compatibility decoder, dual acceptance, or legacy fallback.

The target/profile/ABI are action-specific. Existing query, mutation,
internal-query, and internal-call identities remain byte-for-byte unchanged.
The host-policy identity versions the frame shape and semantics; changing only
one trusted deployment value produces a new frame digest, not a new protocol
version.

## Exact Target Authority

The target is constructed only from authenticated existing owners. It binds:

- Scope authority, located scope epoch, storage generation fence, and the
  Scope-owned active-selection evidence;
- registered application revision, immutable candidate and physical build,
  readiness receipt, activation receipt, and active-head identity;
- one public `kind=action` function in the `edge_action` group;
- exact function metadata, argument/result validators, execution module,
  export name, projection membership, and function-group manifest entry;
- every content-addressed R2 store/codec/key/length/digest reference needed to
  cold-materialize that exact candidate;
- compatibility date, runtime format/profile, syscall ABI, generated Worker
  graph identity, and host-policy digest; and
- the admitted AAV-A1 invocation request identity, action binding, candidate,
  execution generation, deadline, and execution subject capability.

Caller code supplies none of those facts. The host revalidates that the AAV-A1
request, current Scope authority, exact candidate target, action function, and
host-policy digest agree before user code starts. A stale head, revoked scope,
superseded fence, policy change, wrong action, wrong candidate, or mismatched R2
claim fails closed before dispatch.

The implementation reuses
`claimApplicationRevisionActionRuntimeTargetAuthorityV1` and the existing
publication/activation owners. It does not add another active reader, target
table, readiness receipt, activation state, or caller-authored target token.

## R2 And Worker Materialization

R2 is the sole body store. AAV-A2 fetches and verifies the exact `edge_action`
projection, manifest, function entry, modules, validators, and execution graph
from their existing content-addressed references. Missing objects, wrong
store/codec/key/length/digest, noncanonical frames, wrong group, wrong
module/export, wrong validator, or graph-identity drift is corruption.

The first implementation uses Worker Loader `load`, not `get`, for one fresh
Dynamic Worker per action invocation. This deliberately avoids isolate-global
state reuse and cross-invocation leakage. Warm evidence may reuse only
backend-owned immutable R2 verification/materialization caches whose keys
include every target and graph commitment; it may not reuse user global state
or an invocation capability.

The Dynamic Worker receives only:

- the exact verified code graph;
- immutable invocation arguments and authenticated identity projections;
- fixed invocation time and deterministic request-owned random seed;
- one outbound gateway Service Binding; and
- one authenticated callback Service Binding.

It receives no raw R2 bucket, PostgreSQL/Hyperdrive handle, executor, active
reader, Worker Loader, deployment administration, provider credentials,
storage, scheduler, task service, route, or arbitrary host binding.

## Host Policy Ownership And Invalidation

The canonical host-policy frame is trusted deployment configuration owned by
the private artifact-runtime composition root. It is not developer-authored
Standard metadata and is not candidate source. Its digest is the
`hostPolicySha256` already captured by AAV-A1 and is also bound into the exact
runtime target and Worker graph identity.

The frame contains only canonical policy values:

- runtime profile and syscall ABI identity;
- exact sorted, unique HTTPS origin allowlist;
- callback matrix (`runQuery`, `runMutation`, and no `runAction`);
- CPU, wall, syscall, concurrency, subrequest, byte, and cleanup ceilings;
- redirect, streaming, time, randomness, credential, and binding policy; and
- outbound gateway and callback bridge identities.

The first implementation does not persist the policy body in PostgreSQL or add
a second R2 policy registry. The trusted host compiles the current canonical
frame and its digest. An admitted invocation whose stored digest differs from
the current frame is typed stale/invalidated and is not silently reinterpreted
or executed under a new policy. Completed AAV-A1 outcomes remain replayable
without rerunning user code.

Origins are exact normalized HTTPS origins; wildcards, inherited network
access, caller-added origins, URL credentials, non-HTTPS schemes, WebSockets,
raw TCP, and redirects are forbidden. Paths and query strings remain part of
the request rather than authority. A later need for wildcard policy, secret
injection, provider adapters, private network access, or candidate-authored
egress declarations is a separate trust-boundary preflight.

## Pinned First Host Ceilings

The first private host policy pins:

| Limit | Value |
| --- | ---: |
| Dynamic Worker configured CPU | 1,000 ms |
| User-code wall deadline | 30,000 ms |
| Platform isolate memory | 128 MiB platform ceiling |
| Total action host syscalls | 64 |
| Outbound requests | 16 |
| Concurrent outbound requests | 4 |
| Dynamic Worker subrequests | 64 |
| Canonical arguments | 1 MiB |
| Canonical completed result | 1 MiB |
| Callback arguments/result per call | 1 MiB / 1 MiB |
| Outbound request body | 1 MiB |
| Outbound response body | 8 MiB |
| Cumulative outbound request plus response bodies | 16 MiB |
| Post-cancellation tracked-capability drain | 5,000 ms |

The 64-subrequest value is a deliberately smaller Flarex policy, not a current
Cloudflare platform default. Four concurrent outbound operations stays below
Cloudflare's current six simultaneous outgoing-connection ceiling. The host
must enforce both the Flarex counters and Worker Loader custom limits; the
smaller effective limit wins.

Headers, URLs, methods, status, and body framing must also be bounded by the
canonical HTTP codec and current platform request limits. The implementation
preflight does not authorize unbounded headers merely because body bytes are
bounded.

## Outbound Gateway Semantics

The action Worker definition must always set `globalOutbound` explicitly to the
private gateway Service Binding. Omitting it would inherit ambient network;
`null` would prove deny-all but could not prove the admitted controlled fetch.
The gateway is the only owner allowed to use host network access.

For every accepted outbound request the gateway:

1. canonicalizes and bounds the request, verifies the exact policy origin, and
   rejects redirects/streaming/unsupported transport before dispatch;
2. derives the stable effect key from the authenticated invocation, monotonic
   syscall ordinal, and exact request identity rather than accepting one from
   user code;
3. publishes and cold-verifies the canonical request in R2 and calls the
   accepted AAV-A1 prepare operation;
4. durably declares the possible-dispatch boundary before issuing network I/O;
5. performs one non-redirecting bounded host fetch;
6. fully buffers and bounds the response, publishes and cold-verifies its
   canonical body in R2, and confirms the AAV-A1 effect evidence; and
7. returns only the detached bounded response projection to the Worker.

A proven rejection or transport failure before step 4 may be confirmed as
pre-dispatch failure. Timeout, cancellation, connection loss, response loss,
gateway crash, or any failure after step 4 is durable uncertainty unless exact
confirmed response evidence already exists. The runtime never automatically
replays user code or the network request to reconstruct a continuation.

AAV-A2 proves this gateway and ABI below the eventual developer surface. It
does not, by itself, add `fetch` to the public `ActionCtx`, stabilize the full
WHATWG Fetch API, or amend the analyzer contract. SAP07 owns the separately
reviewed developer-visible global-fetch lowering and end-to-end analyzer proof.
This separation prevents an AAV-A2 host test from silently becoming public API
authority.

## Authenticated Callback Semantics

The callback bridge exposes only ABI operations authenticated to the exact
action target:

- `runQuery` selects an exact public or internal query entry from the same
  candidate catalog and invokes the existing SAP05/PQV read owner as a fresh
  coherent read; and
- `runMutation` selects an exact public or internal mutation entry from the
  same candidate catalog, derives a child request key from the action
  invocation plus monotonic syscall ordinal and exact callee/argument
  commitment, records AAV-A1 child-mutation evidence, and invokes the existing
  SAP04/C07 owner.

User code supplies only the statically admitted function reference and
canonical arguments. It cannot supply candidate, active selection, scope,
request key, grant, journal, transaction, validator, module/export, or
execution subject authority.

Callbacks do not join an action transaction. Query callbacks have a fresh
snapshot. Mutation callbacks own their existing independent OCC/commit/outcome
path. The action owns no database, savepoint, rollback, commit, feed, or outbox.
Overlapping or dropped callback promises are rejected where the ABI can prove
them and tracked/drained defensively by the host.

An unobserved or lost query callback response fails the current execution; it
does not create an effect row. A child mutation that may have committed uses
the accepted AAV-A1 child-mutation evidence and leaves the action non-completed
or uncertain until its exact existing outcome is observed. User code is never
restarted merely to recover its continuation.

## Scope, Cancellation, And Cleanup

Each target, AAV-A1 execution subject, Worker, outbound gateway instance,
callback bridge, counters, AbortController, and tracked operation set is owned
by one request Scope. No singleton Layer may capture request or candidate
authority.

Deadline or caller cancellation closes both capability bridges first so no new
effect or callback can start. The host then interrupts/aborts owned operations
where supported and waits at most 5,000 ms for the Worker call plus every
tracked outbound/callback operation to settle. The fresh Worker instance is
never reused.

If everything settles before a possible effect, cancellation remains a typed
pre-dispatch result. If an effect may have dispatched, a child mutation may
have committed, the Worker or an owned call remains unresolved, or release
fails, the AAV-A1 parent is settled as typed cleanup/dispatch uncertainty. The
host must not claim successful cleanup or return a retryable result while an
effect-capable bridge remains open. Full Effect Cause and release failure are
preserved internally rather than flattened into an ordinary application error.

## Failure Classification

AAV-A2 keeps these classes distinct:

- typed target/policy stale or superseded before user code;
- typed retryable integration failure proven before user code/effect dispatch;
- typed application error or argument/result/callback validator failure;
- typed resource-budget, timeout, and cancellation result;
- durable uncertain-after-possible-dispatch or cleanup uncertainty;
- authenticated target/R2/protocol/evidence corruption; and
- unexpected Worker, host, Effect Cause, or release defect.

Application code may observe only declared application and deterministic
validation failures admitted by the ABI. Authority, corruption, protocol,
budget, timeout, cancellation, uncertainty, and defects stay outside the user
Promise chain. Logs and transport errors redact arguments, results, headers,
credentials, HTTP bodies, stack, and foreign causes.

## Implementation Boundary

The approved AAV-A2 implementation slice may touch only the smallest closure
under:

- `packages/flarex-protocol` for the target, ABI, host-policy frame, vectors,
  and private exports;
- `packages/function-runtime` for the action-edge kernel and authenticated
  syscall client;
- `packages/flarex-backend/src/artifactRuntime` for candidate-bound R2 target
  derivation, exact Worker graph, host gateway/callback ports, and generated
  source closure;
- `apps/artifact-runtime` for the real Worker Loader entrypoint and scoped host
  adapters;
- the narrow existing persistence/Standard-invocation ports needed to consume
  AAV-A1 and the existing target/SAP04/SAP05 owners, without new tables or
  transaction ownership;
- focused protocol, unit, Workerd, PGlite, and genuine PostgreSQL tests; and
- directly owning roadmap/design reconciliation.

It must not change `packages/flarex` public authoring types, the accepted
Declarative V2 analyzer contract, Standard definition/artifact semantics,
schema/migrations, readiness/activation, active routing, or production
bindings. SAP07 owns the developer-visible action surface and complete Standard
definition-to-analysis-to-runtime proof after AAV-A2 is accepted.

Package extraction is not approved. Reuse current package owners unless a
separate preflight proves an unavoidable dependency cycle and exact owner.

## Required Validation

The implementation is accepted only with all of the following:

### Protocol and identity

- canonical target, policy, ABI, code-graph, request, callback, result, and
  hostile perturbation vectors;
- exact identity changes for every authoritative field and stability for
  allocation/order aliases that are not authoritative; and
- no query/mutation/internal-call identity or generated closure drift.

### Materialization and isolation

- warm, cold, reload, and exact-request replay evidence from real R2 objects;
- missing/corrupt/wrong candidate, projection, manifest, module, export,
  validator, compatibility date, graph, and policy rejection;
- fresh Worker Loader `load` evidence and no `get`/isolate-global reuse; and
- no user code, projection, manifest, arguments, result, or HTTP body in
  PostgreSQL.

### Outbound and callback behavior

- allowlisted HTTPS success plus non-allowlisted, wildcard, redirect,
  unsupported scheme, oversized request/response, cumulative budget,
  concurrency, timeout, connection loss, response loss, and gateway crash;
- durable prepare-before-dispatch and confirmed/uncertain AAV-A1 evidence;
- same-candidate public/internal query and mutation callbacks through the
  existing owners, with forged/dynamic/wrong-kind/wrong-group/wrong-candidate
  rejection;
- deterministic child request keys, duplicate callback replay, committed child
  outcome observation, and lost-outcome uncertainty; and
- no direct database, raw binding, ambient credential, storage, scheduler,
  task, `runAction`, or uncontrolled fetch capability.

### Resource, lifecycle, and database evidence

- every pinned count/byte/CPU/wall/concurrency/subrequest ceiling at
  below/equal/above boundaries;
- caller cancellation before dispatch, after prepare, during dispatch, during
  callback, during Worker execution, during drain, and during release;
- bounded drain, capability closure, unresolved-operation poisoning, and full
  Cause preservation;
- PGlite and genuine PostgreSQL proof that existing AAV-A1, active-selection,
  SAP04, SAP05, C07, OCC, result, feed, and outbox semantics are unchanged; and
- focused concurrency/stress showing counters, ordinals, effect keys, child
  keys, and one-Worker-per-invocation isolation under contention.

### Repository finish

- generated files refreshed and checked;
- package and broad affected typechecks/tests, Effect boundary checks, Drizzle
  check, and runtime topology/Workerd proof;
- roadmap 42, 46, 47, this record, System API proposal, bundle-partition note,
  and registry reconciled;
- both mandatory exact-final reviewers, fixes, and re-review; and
- one separate AAV-A2 commit with a clean scoped diff.

## Explicit Exclusions And Stop Conditions

AAV-A2 does not authorize:

- SAP07, a public action API, analyzer/API widening, routes, triggers,
  activation, FSV07, or production traffic;
- new PostgreSQL tables/columns/migrations or PostgreSQL/R2 duplication;
- another invocation, effect, mutation outcome, task, OCC, commit, feed, or
  outbox owner;
- durable-task host integration, task run/attempt/lease/retry/cancellation
  changes, schedules, workflows, or background jobs;
- internal action roots, `runAction`, query/mutation-to-action calls, Node
  actions, provider adapters, containers, or heavy jobs;
- wildcard/private-network egress, secret injection, raw bindings, ambient
  credentials, WebSockets, TCP, redirects, streaming, timers, `waitUntil`, or
  nondeterministic crypto; or
- legacy runtime fallback, dual profile/acceptance, compatibility APIs,
  package extraction, or unrelated cleanup.

Stop for a new decision if implementation requires any of those, cannot
enforce prepare-before-dispatch through the Dynamic Worker gateway, cannot
close capabilities before bounded drain, requires Worker reuse, or cannot
preserve the exact candidate across callbacks.

## Next Gate

After explicit implementation approval, complete this one AAV-A2 capability,
its tests, mandatory reviewers, and one commit. Acceptance then stops. The next
separate gate is SAP07: the private route-independent Standard public action
and its developer-visible analyzer/runtime surface. Durable-task compute-host
integration remains independent and later.
