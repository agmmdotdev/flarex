# Declarative V2 External Analyzer Compute Contingency (Superseded)

## Status

**Superseded:** Roadmap 17 now accepts capability-free cold-load Application
Analysis and treats handler bodies as opaque JavaScript. The static parser,
linker, call-graph, ABI, value-flow, progress, and restart system described here
is no longer the production target, so moving that computation to an external
service is not an authorized contingency.

This note is retained only as historical architecture and removal-audit
evidence. It is not approval to add an external compute service, route, binding,
deployment, fallback, second analyzer path, or to continue pending Declarative
V2 work. If measured hosted limits later make whole-bundle cold loading
infeasible, stop and amend roadmap 17 with those measurements; do not revive
this protocol implicitly.

The next executable analysis milestone is roadmap 17 AA-R1, followed by its
contract, host, migration, and private proof gates. The remainder of this note
describes the displaced design in the present tense only to preserve its exact
historical boundary.

## The Boundary In One Picture

```text
Developer machine / CI
  -> TypeScript and dependency build
  -> portable prebuilt ESM + semantic declarations
  -> untrusted upload boundary

Flarex backend
  -> authorize the project/deployment request
  -> authenticate finalized source and semantic artifacts
  -> create a bounded, deterministic, inert analyzer command

Analyzer compute
  -> parse modules
  -> resolve imports, exports, functions, and calls
  -> perform bounded verification
  -> return inert evidence, diagnostics, digests, and usage

Flarex executor and persistence
  -> independently verify the response
  -> preserve fenced verifier progress and settlement
  -> grant no application authority from serialized evidence

Cloudflare Worker Loader
  -> consume the immutable verified runtime projection
  -> perform engine-specific compilation and isolate materialization
```

The analyzer-compute box may remain a Cloudflare Worker or, after a separate
measured decision, move to a serverless function, container service, queue
worker, or private VPS. The surrounding authority boundaries do not move with
it.

## What Backend Authentication Means

Backend authentication is more than user login. Before producing an analyzer
command, the backend independently proves that:

- the request is permitted for the exact project and deployment;
- source and semantic roots, selectors, generations, mutation fences, and
  attempt identities are current and mutually consistent;
- module ordinals, paths, lengths, and digests come from finalized immutable
  artifacts;
- the source and semantic evidence describe the same deployment input; and
- stale, replayed, mixed, caller-invented, or corrupted evidence fails closed.

The resulting proof and read-session handles are request-bound, process-local
capabilities. They must never be serialized or sent to analyzer compute.

## Why The Command Producer Exists

The authenticated command producer converts live backend authority into an
inert transport value:

```text
live request-bound proof and read session
  -> authenticated command producer
  -> canonical command bytes and mechanical receipts
```

The command binds the authenticated inputs to the exact durable reservation,
command kind and sequence, progress and predecessor lineage, analyzer and
verifier identities, range commitments, and all 26 command-budget dimensions.
It carries only the module metadata, full admitted module source, or canonical
semantic bytes required by its command grammar.

The serialized command is evidence, not authority. It cannot reopen a backend
session, read unrelated artifacts, acquire a repository lease, settle progress,
write PostgreSQL rows, execute a transaction, activate a deployment, or mint a
candidate.

## What Is And Is Not Compiled

Flarex does not run TypeScript, package installation, dependency resolution,
Vite, Rolldown, esbuild, or arbitrary build plugins inside the authoritative
verifier. Developer tooling or CI produces portable prebuilt ESM first.

Verification is module-oriented, not a separate compilation for each exported
query or mutation. Every admitted runtime module must be inspected, including:

- exported query, mutation, action, and handler entry functions;
- helper functions inside the same module;
- application modules imported by those entry points;
- library code that remains in the emitted ESM graph; and
- module initialization code.

Function names and semantic metadata are insufficient because unsupported or
dangerous behavior can exist inside a function body or imported helper. The
analyzer therefore parses complete admitted JavaScript module source and
derives bounded import, export, call, capability, value-flow, and diagnostic
evidence.

Flarex never accepts caller-generated V8 or Cloudflare bytecode as a protocol
or deployment artifact. Worker Loader alone owns engine-specific compilation.

## Storage And Data Movement

The source exists before command production:

```text
immutable Source Artifact and Semantic Artifact content
  -> object storage
  -> authenticated bounded read
  -> temporary analyzer command bytes
  -> analyzer response
  -> compact durable progress and restart evidence
```

The producer's command bytes are temporary transport data and should not be
stored as another source artifact merely because they are encoded bytes.
PostgreSQL owns bounded verifier attempt, reservation, progress, evidence-page,
usage, and settlement state. It is not the primary full-source blob store.

A later immutable runtime projection contains the verified portable JavaScript
modules and Flarex-owned metadata needed by Worker Loader. That publication
stage remains separate from analyzer command production.

## Compute Options

### Cloudflare Worker

Advantages:

- minimal network distance from existing Cloudflare-owned services;
- native operational environment;
- simple deployment and scaling model; and
- no additional infrastructure owner.

Possible constraints to measure:

- CPU duration;
- available memory;
- cold-start behavior;
- request and response size;
- cancellation responsiveness;
- sustained concurrency; and
- profiling and operational visibility.

### Serverless Function

Examples include AWS Lambda or an equivalent function platform.

Advantages:

- potentially larger memory and CPU configurations;
- isolated per-command execution;
- automatic scaling; and
- limited host-management burden.

Costs and risks:

- payload and execution-duration ceilings;
- cold starts;
- cross-provider transfer latency and cost;
- duplicate delivery and uncertain responses;
- configuration and analyzer-identity rollout; and
- another private transport and observability boundary.

### Container Service Or Private VPS

Advantages:

- predictable memory and CPU;
- long-running worker pools;
- better profiling and debugging;
- explicit concurrency control; and
- fewer function-runtime payload constraints.

Costs and risks:

- patching and lifecycle ownership;
- capacity planning and overload behavior;
- queue and retry policy;
- isolation between untrusted deployments;
- secret and network management; and
- a larger operational security surface.

## Required Trust Boundary For External Compute

An external analyzer receives only bounded inert commands. It must never
receive:

- PostgreSQL, R2, or backend credentials;
- request-bound proof, session, cursor, or module handles;
- repository Run or Work capabilities;
- physical locators as authority;
- lease owner or fence authority;
- application transaction or OCC capabilities;
- commit compiler, journal, feed, or outbox authority; or
- readiness, activation, publication, or routing authority.

The executor must independently validate:

- protocol and analyzer identities;
- reservation and command commitments;
- response framing, canonical bytes, and digests;
- evidence ordering, roots, counts, and predecessor lineage;
- reported usage against the accepted budgets; and
- retry, replay, cancellation, truncation, and uncertain-outcome behavior.

A compromised analyzer may fail, time out, or return invalid evidence. It must
not be able to mutate application state or cause Flarex to accept mismatched
evidence.

## Retry, Restart, And Failure Rules

- A retry reacquires fresh backend authentication.
- Live proof, session, result, cursor, lease, and fence handles are never
  serialized.
- Identical immutable authenticated inputs, identities, reservation, and
  budgets must reproduce the same deterministic command identity.
- Confirmed rollback may follow the owning bounded retry policy.
- An uncertain transport or commit outcome grants no new authority.
- Cold restart verifies durable metadata before payload and rehydrates fresh
  process-local verifier authority only after complete validation.
- Cancellation must close request-local resources and must not publish partial
  evidence.
- External compute must not introduce a silent local fallback or dual analyzer
  path.

## Decision Gate

External analyzer compute should be considered only after the private
real-system harness provides repeatable evidence for:

1. representative module and semantic-stream sizes;
2. parser, linker, hashing, and evidence-generation CPU time;
3. peak and sustained memory;
4. cold and warm execution latency;
5. cancellation and timeout behavior;
6. concurrent deployment and takeover stress;
7. command and response transfer sizes;
8. restart and uncertain-outcome frequency; and
9. operational cost at expected deployment volume.

The decision must compare at least:

- keeping analysis on Cloudflare;
- moving only stateless analyzer computation to serverless compute; and
- moving only stateless analyzer computation to a managed container or VPS.

It must not use performance pressure as permission to weaken verification,
increase unbounded work, serialize capabilities, move backend authentication,
or change application transaction semantics.

## Governance Boundary

This contingency does not authorize changes to FlarexDB OCC, commit
compilation or execution, transaction journals, idempotency outcomes,
commit/change feeds, outbox behavior, or authoritative application-row
semantics. It also does not authorize public routes, developer APIs, readiness,
activation, production traffic, or deployment of external infrastructure.

If measurements justify external analyzer compute, the next step is a separate
research gate that freezes the private transport, deployment owner, failure and
retry policy, identity rollout, data residency, observability, cost model, and
end-to-end equivalence tests before any implementation.
