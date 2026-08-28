# DTE06 Worker Loader Routed Composition Preflight

Status: complete privately on 2026-08-28; production-inert.

Evidence snapshot: 2026-08-28 current repository state after the completed
provider router in Preflight 48.

## Decision

Adapt the existing Worker Loader Task provider into the existing private
Application delivery composition through the completed
`TaskComputeProviderRouter`.

```text
event-owned Layer Scope
  -> scoped Worker Loader provider bundle
     -> descriptor + admitted compute profiles + provider + supervision control
  -> one-route TaskComputeProviderRouter
     -> TaskComputeProvider service
  -> CandidateRunner
```

This is a composition change, not a provider replacement. The same Worker
Loader provider remains the only configured provider, performs the same Worker
launch/session work, and owns the same Scope, fibers, dispatch state,
cancellation state, and cleanup.

## Current Source Facts

- `WorkerLoaderTaskComputeProvider` already constructs one plain scoped
  provider bundle internally, but its public factories expose only a
  `TaskComputeProvider` Context service plus supervision control.
- `ApplicationTaskComputeDelivery` currently provides that service directly to
  `TaskComputeDeliveryCandidateRunnerLive`.
- `TaskComputeProviderRouter` now accepts plain provider instances, dispatches
  by immutable compute profile, and routes cancellation by the accepted
  provider descriptor.
- the event host already owns one fresh Layer Scope per run and drains
  supervision before releasing it.
- Application and retained Legacy Worker policies may admit the same compute
  profile name, so one Worker Loader route needs their stable deduplicated
  union rather than duplicate router entries.

## Owned Files

This slice may change only:

- `packages/flarex-backend/src/taskComputeDelivery/WorkerLoaderTaskComputeProvider.ts`;
- its existing focused Worker Loader provider test;
- `packages/standard-application-invocation/src/ApplicationTaskComputeDelivery.ts`;
- existing focused or connected tests only when necessary to prove the new
  service edge; and
- this preflight plus directly owning DTE06 roadmap/index records.

No persistence, schema, migration, lifecycle, scheduler, Worker definition,
generated runtime, route, binding, deployment, public SDK, or external
resource file is owned by this slice.

## Scoped Bundle Contract

Expose one backend-private scoped factory that returns an immutable plain
Worker Loader provider bundle containing:

- the already validated Worker Loader provider descriptor;
- the stable deduplicated union of valid Application and Legacy compute-profile
  references;
- the existing validated `TaskComputeProviderShape`; and
- the existing `TaskComputeDeliverySupervisionControlShape`.

The factory requires the existing `TaskRuntimeLaunchAuthority` service and
`Scope`. It must reuse the current option capture, Worker Loader capture,
session host, state, finalizer, and supervised-provider construction. It must
not create another Context tag for each provider instance, another Scope, or a
parallel provider implementation.

The existing direct Worker Loader Layers remain behavior-compatible wrappers
over the same scoped factory. Their service/error/requirement contracts do not
change.

## Routed Application Composition

`makeApplicationTaskComputeDeliveryLayer` must:

1. construct exactly one supervised Worker Loader bundle inside its current
   event-owned Layer Scope;
2. construct exactly one router route from the bundle's captured descriptor,
   captured compute profiles, and provider;
3. publish the router as the existing `TaskComputeProvider` service;
4. publish the bundle's existing supervision control unchanged;
5. provide that routed service graph to the existing CandidateRunner; and
6. preserve the existing launch authority, trusted directory, connected
   runner, generation policy, error channels, and shutdown order.

There is no direct-provider fallback. Router construction failure fails Layer
construction through its typed configuration error.

## Required Proof

Focused and connected validation must prove:

- the scoped factory exposes the exact Worker Loader descriptor;
- Application and Legacy profile names form one stable deduplicated route;
- invalid and empty profile unions fail at the Worker Loader configuration
  boundary before any Worker or session allocation;
- the existing direct provider Layers still dispatch, cancel, supervise, and
  release resources as before;
- the Application delivery composition reaches the same real Worker Loader
  provider through the router;
- event-host quiescence still drains the same supervision control before Scope
  release;
- current Application Task success, failure, cancellation, timeout,
  lost-response, and fresh-host recovery behavior remains unchanged; and
- no runtime-core or source-map identity changes.

## Non-Goals

This slice does not authorize:

- a Node, AgentOS, container, workflow, or remote provider;
- more than one real provider route;
- changing compute-profile or provider wire contracts;
- fallback, comparison execution, provider racing, spill, or fanout;
- changing Query, Mutation, Action, Task Worker, callback, Function API Core,
  or generated runtime semantics;
- changing Task lifecycle, scheduling, retry, cancellation, settlement,
  result, OCC, commit, journal, outbox, or feed authority;
- DTE06-F3/F4 or DTE05-E3 host/deployment work; or
- a public Task API, route, binding, credential, or production activation.

## Validation

Before commit:

- focused router and Worker Loader provider tests pass;
- backend and Standard Application Invocation typechecks pass;
- the Application Task PGlite connected/event-host path passes;
- DTE06 CandidateRunner, lifecycle, Effect-boundary, and both runtime source-map
  gates pass;
- applicable lint and staged-diff gates pass; and
- both mandatory project reviewers inspect the exact final code diff.

## Stop Boundary

Stop after the scoped bundle factory, the one-route Application composition,
focused and connected proof, exact-final review, and one intentional commit.
The next provider remains separately gated. Its accepted docs-only architecture
and ordered runtime-family, artifact, session, protocol, callback, local-host,
and hosted-provider gates are recorded in
[`Preflight 50`](./50-dte06-node-task-provider-architecture.md).

## Implementation Receipt

`WorkerLoaderTaskComputeProvider` now exposes one scoped plain bundle factory.
The bundle reuses the existing option capture, launch authority, Worker session
host, provider state, supervision, and Scope finalizer while projecting its
validated descriptor and the stable deduplicated union of Application and
Legacy compute profiles. The existing direct Layers delegate to that factory.

`ApplicationTaskComputeDelivery` now uses the routed supervised Layer. It
constructs one Worker Loader bundle, creates one router route from that bundle,
publishes the router as the existing `TaskComputeProvider` service, and
publishes the same supervision control. CandidateRunner, the connected runner,
the event host, and all lifecycle and persistence owners remain unchanged.

Validation includes 52 focused backend routing/provider/host/runner tests, all
113 Standard Application Invocation tests, both affected package typechecks,
the System Test package typecheck, the 13-case connected Application Task
PGlite suite, the 14-case F2 connected plus fresh-host takeover matrix, all 65
lifecycle vectors and 37 named divergences, both runtime source maps, the
Effect boundary gate, generated runtime identity checks, `lint:core`, and
`lint:diff`, plus the staged diff gate. Both mandatory exact-final reviewers
reported no findings. The only observed test interruption was one unrelated five-second
query-authority timeout while several heavy suites ran concurrently; that test
passed in isolation and the complete 113-test package passed serially.

No alternate provider, runtime kernel, Worker definition, wire contract,
schema, migration, lifecycle transition, route, binding, deployment, external
resource, public API, or production activation was added.
