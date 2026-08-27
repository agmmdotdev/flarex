# DTE06 Task Compute Provider Router Preflight

Status: complete privately on 2026-08-27; production-inert and unwired.

Evidence snapshot: 2026-08-27 current repository state after DTE06-F2 and the
docs-only runtime-placement decision in Preflight 47.

## Decision

Add one backend-private Task compute provider router behind the existing
unversioned `TaskComputeProvider` service. The router maps an immutable Task
compute profile to one configured plain provider value for dispatch, and maps
the provider name/version recorded in an accepted execution to that same
provider for cancellation.

```text
TaskComputeProvider service
  -> Task compute provider router
     -> compute profile -> provider for dispatch
     -> provider descriptor -> provider for cancellation
        -> Worker Loader provider today
        -> Node or Agent provider only after later preflight
```

This is the missing placement seam. It is not a new runtime kernel, lifecycle,
wire protocol, scheduler, or provider implementation.

## Current Source Facts

- `TaskComputeProvider` already owns provider-neutral `dispatch` and
  `requestCancellation` operations.
- A dispatch request already carries `computeProfile`.
- An accepted execution and cancellation request already carry provider name,
  provider version, and execution ID.
- `CandidateRunner` depends on only one `TaskComputeProvider` service, so a
  router can preserve that service and every delivery/repository decision.
- `WorkerLoaderTaskComputeProvider` is already a Scope-owned plain provider
  internally and is exposed through a Layer for the current single-provider
  composition.
- `ApplicationWorkerRuntime` already owns the shared fresh Worker Loader seam.
- Roadmap 40's Function API Core and exact operation kernels are closed and are
  not part of this slice.

## Owned Files

This slice may add or update only:

- one provider-router implementation under
  `packages/flarex-backend/src/taskComputeDelivery/`;
- its backend-private task-compute-delivery export;
- one focused provider-router test file;
- this preflight and the directly owning DTE06 roadmap/index records; and
- exact source-map or governance receipts only if an existing mandatory checker
  proves they are required by these files.

The current Worker Loader provider, CandidateRunner, Worker definitions,
generated cores, protocol package, durable-task package, persistence, lifecycle,
and host compositions remain unchanged.

## Configuration Contract

The router receives a nonempty ordered collection of routes. Each route owns:

- one valid `TaskComputeProviderDescriptorV1`;
- one nonempty set of valid `TaskComputeProfileRefV1` values; and
- one plain `TaskComputeProviderShape` instance.

Construction must:

1. capture every route, descriptor, profile collection, provider receiver, and
   provider method without retaining caller-controlled configuration getters;
2. validate descriptors and profiles through the current durable-task schemas;
3. reject an empty route set;
4. reject an empty profile set;
5. reject a compute profile assigned to more than one route;
6. reject a provider descriptor assigned to more than one route;
7. reject a missing or non-callable provider operation;
8. preserve each provider receiver when invoking a captured method; and
9. expose immutable router state with no post-construction mutation API.

The configuration error is backend-private and unversioned because it is not a
wire, persisted, or compatibility contract.

## Dispatch Rules

1. Validate the dispatch request through the existing
   `TaskComputeProvider` contract wrapper.
2. Select exactly one provider by `request.computeProfile`.
3. If no route exists, fail with the existing non-retryable
   `TaskComputeDispatchRejectedError` reason `unsupported_compute_profile`.
4. Invoke only the selected provider.
5. Validate the selected provider's acceptance through the existing provider
   contract.
6. Require the acceptance provider name/version to equal the selected route's
   descriptor. A mismatch is an existing `TaskComputeDispatchContractError`;
   it must not be rewritten as acceptance from the configured provider.
7. Return the validated acceptance without changing execution ID, identity, or
   provider-owned semantic values.

There is no default provider, fallback, spill, retry across providers, race,
comparison dispatch, or multi-provider fanout.

## Cancellation Rules

1. Validate the cancellation request through the existing provider contract.
2. Select exactly one provider from the request's accepted execution provider
   name/version, not from a current compute-profile mapping.
3. If no descriptor route exists, fail with the existing non-retryable
   `TaskComputeCancellationRejectedError` reason `execution_not_found`.
4. Invoke only that provider and preserve its receiver.
5. Return the provider's existing validated, exactly correlated receipt.

Descriptor-based cancellation prevents a later placement/configuration change
from sending an old execution's cancellation to a different provider.

## Effect And Lifetime Decision

The router is a stable shared capability and may provide the existing
`TaskComputeProvider` Context service through a Layer. Its configured provider
instances remain plain values because multiple instances must coexist and each
provider owns its own Scope, fibers, clients, sessions, and cleanup.

Router construction is a pure recoverable configuration decoder returning
Effect v4 `Result`. The Layer enters the typed failure channel once with
`Effect.fromResult`. Dispatch and cancellation are named `Effect.fn`
operations. The router creates no runtime, fiber, Scope, session, or background
process and executes no business work during Layer construction.

## Required Tests

Focused tests must prove:

- dispatch selects by exact compute profile;
- several profiles may deliberately share one provider route;
- cancellation selects by exact provider name/version even without a profile;
- unknown dispatch profiles and cancellation descriptors fail closed without
  invoking any provider;
- duplicate profiles and duplicate provider descriptors are rejected;
- empty routes, empty route profiles, invalid descriptors, invalid profiles,
  missing methods, and throwing configuration accessors are rejected;
- provider method receivers are preserved;
- structurally valid route records may retain unrelated host metadata;
- malformed raw-provider receipts become existing typed contract errors;
- a selected provider acceptance with a different provider descriptor becomes
  a contract error;
- request/acceptance/cancellation correlation remains owned by the existing
  provider wrapper; and
- the router adds no fallback or fanout.

## Validation

Before commit:

- focused provider-router tests pass;
- the full `@flarex/durable-task` compute-provider suite passes;
- the backend package typecheck passes;
- DTE06 CandidateRunner and Worker Loader provider regressions pass;
- durable-task lifecycle and connected-runtime source-map gates pass;
- applicable lint gates pass;
- scoped diff checks pass; and
- both mandatory project reviewers inspect the exact final code diff.

## Non-Goals

This slice does not authorize:

- wiring the router into the event host or production composition;
- changing `WorkerLoaderTaskComputeProvider` construction or lifecycle;
- implementing Node, AgentOS, container, workflow, or remote providers;
- changing compute-profile or provider wire contracts;
- changing retry, OOM escalation, cancellation, delivery, persistence, Task
  lifecycle, result settlement, OCC, commit, journal, outbox, or feed semantics;
- changing Query, Mutation, Action, Task Worker, Function API Core, generated
  runtime kernels, or runtime source identities;
- public SDK, API, route, binding, deployment, or external-resource work; or
- fallback, dual execution, provider racing, or comparison delivery.

## Stop Boundary

Stop after the private router, focused tests, validation, exact-final review,
and one intentional commit. The current single Worker Loader composition stays
unchanged. A later preflight must adapt provider factories and host composition
before the router can serve two real providers. Node and AgentOS provider work
remain independently gated.

## Implementation Receipt

The backend-private `TaskComputeProviderRouter` now provides the existing
unversioned `TaskComputeProvider` service. It captures plain provider receivers,
routes exact compute profiles for dispatch, routes accepted provider
descriptors for cancellation, validates raw provider receipts through the
existing provider contract, and fails closed for unknown or duplicate routes.
Structurally valid route records may carry unrelated host metadata; the router
reads only its three owned data fields and never invokes configuration getters.

No provider adapter, CandidateRunner, event host, Worker definition, runtime
kernel, wire contract, persistence owner, lifecycle transition, or production
composition changed. The current single Worker Loader path remains unchanged.

Validation for the implementation checkpoint includes 15 focused router cases,
the existing durable-task provider suite, CandidateRunner and Worker Loader
provider regressions, all 65 lifecycle vectors and 37 named divergences,
durable-task and connected-runtime source-map gates, generated-runtime identity
checks, `lint:core`, `lint:diff`, and the staged diff gate. An exact two-file
strict TypeScript check covers the final router and its focused test, and the
full backend package typecheck passes.
