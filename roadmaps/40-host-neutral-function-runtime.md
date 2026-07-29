# Host-Neutral Function Runtime

## Status And Scope

**Status:** Preflight and the first-extraction amendment are accepted. The
prerequisite journal-boundary correction, canonical declarative-program first
vertical, and host-neutral exact public point-mutation extraction are
implemented and validated. Production routing and broader runtime capabilities
remain deferred.

This record owns the proposed portable user-code execution semantics shared by:

- the isolated Cloudflare Dynamic Worker production host; and
- a fast in-process host used for focused internal and developer tests.

The decision is to make the host swappable above Cloudflare Worker Loader and
below verified user-code execution semantics. Both hosts should invoke one
owned runtime kernel rather than separately implement function lookup,
validation, `ctx`, database operations, nested calls, deterministic
environment, and result normalization.

This record now owns the approved `@flarex/function-runtime/point-mutation`
package boundary and its Cloudflare adapter. It does not approve a production
reroute, broader Dynamic Worker capability, test-SDK behavior change, FlarexDB
authority change, or replacement of Miniflare/workerd evidence. Those require
a separately bounded preflight and implementation slice.

## Why This Boundary Is Needed

Most user-code semantic tests should not require Miniflare, Worker Loader, or a
Cloudflare service-binding graph. They should be able to execute an ordinary
verified function module against controlled identity, time, randomness, and
database-journal capabilities.

Production still requires a fresh isolated Dynamic Worker. That host proves
properties an in-process runner cannot prove: module/isolate freshness,
Cloudflare global behavior, module-map loading, RPC serialization, disposal,
compatibility-date behavior, and platform resource boundaries.

The accepted split is:

```text
verified runtime projection + execution request
                         |
                         v
             host-neutral function runtime
             |       |       |       |
             |       |       |       +-- deterministic time/random
             |       |       +---------- function lookup/nested calls
             |       +------------------ ctx.auth and ctx.db
             +-------------------------- validation/result semantics
                         |
              +----------+-----------+
              |                      |
              v                      v
    Cloudflare Dynamic Worker   in-process test host
              |                      |
       journal RPC adapter      controlled journal adapter
              |                      |
              +----------+-----------+
                         v
                   trusted executor
                         |
                         v
              authoritative FlarexDB/Postgres
```

The Dynamic Worker does not receive FlarexDB or Postgres authority. User code
receives a restricted `ctx.db` facade. Its logical operations cross a
journal/syscall capability into the trusted executor, which retains session,
snapshot, OCC, commit, idempotency, feed, outbox, and persistence authority.

## Current Sources Of Truth

Current behavior must be verified against:

- [`packages/executor/src/storedAttemptAuthentication.ts`](../packages/executor/src/storedAttemptAuthentication.ts)
  for `PointMutationOccRuntimeNeutralRunnerV1`;
- [`packages/executor/src/pointMutationExactRuntimeRunner.ts`](../packages/executor/src/pointMutationExactRuntimeRunner.ts)
  for the structural artifact-host binding and executor-side journal
  settlement;
- [`packages/flarex-backend/src/artifactRuntime/PointMutationExactRuntimeWorkerCore.ts`](../packages/flarex-backend/src/artifactRuntime/PointMutationExactRuntimeWorkerCore.ts)
  for the current Cloudflare-bound exact point-mutation runtime;
- [`packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`](../packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts)
  for current ordinary generated `ctx.db`, query builder, nested-call, and
  executor syscall semantics;
- [`packages/flarex-backend/test/pointMutationExactRuntime.workerd.test.ts`](../packages/flarex-backend/test/pointMutationExactRuntime.workerd.test.ts),
  [`packages/executor/test/pointMutationExactRuntimeRunner.workerd.test.ts`](../packages/executor/test/pointMutationExactRuntimeRunner.workerd.test.ts),
  and adjacent tests for current workerd and adapter evidence;
- [`06-dynamic-worker-execution.md`](./06-dynamic-worker-execution.md) for
  Dynamic Worker capabilities, isolation, materialization, identity, and
  runtime-shell ownership;
- [`11-testing-and-simulation-strategy.md`](./11-testing-and-simulation-strategy.md)
  and [`15-test-sdk.md`](./15-test-sdk.md) for evidence lanes and the rule that
  tests reuse production semantics rather than define a second backend;
- [`16-package-boundaries.md`](./16-package-boundaries.md) for dependency and
  host ownership; and
- [`37-production-redelivery-and-c06b.md`](./37-production-redelivery-and-c06b.md)
  for the private exact-attempt runtime host and current production gates.

## Pre-Extraction Architecture

The trusted executor already accepts a
`PointMutationOccRuntimeNeutralRunnerV1`. The exact implementation projects
verified stored-attempt inputs into a strict request, constructs a journal RPC
session, calls a small structural artifact-host binding, decodes the result,
and settles the journal. This is a useful host seam.

It is not yet a host-neutral user-code engine. The concrete exact runtime still
extends Cloudflare `WorkerEntrypoint`, loads generated execution modules, builds
the developer context, patches deterministic globals, runs the handler, drains
the journal, and normalizes the result inside the Dynamic Worker core.

The ordinary generated runtime separately contains related context, database,
query-builder, nested-call, validation, and syscall source. Local development
and the public test harness use Miniflare-managed runtime materialization for
real user-code execution.

Before the extraction, the repository already had:

- an executor-to-runtime runner interface;
- a structural Cloudflare host-binding port;
- protocol-owned exact request and result contracts;
- authored TypeScript for the exact runtime core; and
- workerd boundary coverage.

It did not yet have one portable kernel that both a Cloudflare host and an
ordinary in-process host could invoke to execute the same user function.

## Accepted Preflight Result

The first-vertical preflight completed against the current exact runtime,
ordinary generated runtime, generated-core build, executor journal, RPC
adapter, host, and focused tests. It supersedes the earlier assumption that the
exact runtime was still maintained as one handwritten template literal or was
not connected to Worker Loader.

### Current Lifecycle And Implementation

The exact runtime is now authored as ordinary TypeScript in
`PointMutationExactRuntimeWorkerCore.ts`. A deterministic build converts that
file to `PointMutationExactRuntimeWorkerCore.generated.ts`; the generated
source is combined with the artifact's application modules and loaded through
`loader.load()` by the private artifact-runtime entrypoint. The executor
constructs an attempt-scoped journal RPC graph, calls the private host binding,
then closes and drains the graph before resolving the host and journal exits.

The isolated core currently owns:

- one-shot request admission;
- deterministic module-time `Date` and seeded `Math.random`;
- ambient network, timer, crypto, and async restrictions;
- post-hardening import of the application execution bridge;
- exact public-mutation lookup and handler extraction;
- restricted `ctx.auth` and point `ctx.db` methods;
- syscall sequencing, stable-tail draining, and RPC-stub disposal; and
- runtime-value normalization.

The ordinary generated runtime remains a separate, broader implementation. It
also has query builders, nested `runQuery` and `runMutation`, and analyzed
argument/return validation behavior. Those are not current exact-runtime
capabilities and must not be called parity merely because their names overlap.

### Correctness Prerequisite Found By The Preflight

The preflight found that the executor RPC adapter exposed
`RunSessionJournalPointOperationV1Result` directly. That persistence-owned
delivery envelope has `completed`, `rejected`, `sequenceRejected`, and
`stateRejected` variants, while the exact runtime accepts only the logical
successful outcomes `missing`, `present`, `inserted`, and `unit`.

The tests had covered the two sides separately with incompatible expectations:
the executor workerd test expected the delivery envelope, while the
exact-runtime tests used logical outcomes. A real exact-runtime `ctx.db` call
could therefore receive a valid persistence envelope and reject it as an
invalid runtime journal outcome.

The prerequisite slice now:

1. keep persistence delivery, replay, sequence, and journal-state outcomes
   inside the trusted executor;
2. project only a completed logical outcome across the attempt-scoped RPC
   capability;
3. convert every non-completed delivery envelope to an executor-owned typed
   journal failure;
4. preserve that local failure through close/drain while exposing only the
   existing redacted remote stop error; and
5. pin the boundary with workerd coverage for success, rejection,
   first-failure precedence, close/drain, late calls, and disposal.

`PointMutationJournalV1` retains its persistence-aware result and precise core
error channel. The RPC adapter alone owns the logical-outcome projection and
the additional typed rejection. The exact-runtime test fixture is constrained
by the same executor logical-outcome type, so the workerd adapter and runtime
expectations cannot silently diverge at compile time.

This correction does not alter journal persistence, replay authority, OCC,
commit compilation or execution, transaction evidence, idempotency outcomes,
feeds, outbox behavior, or authoritative application rows.

### Validator And Runtime-Projection Gate

At preflight time, arguments were validated before exact execution, but the
exact request projection did not carry the pinned argument and return validator
semantics needed by a portable kernel. The exact core normalized a returned
value but did not enforce the analyzed return validator. The ordinary generated
runtime already enforced analyzed validators.

The shared function runtime must consume a verified execution projection that
contains the required validator and function-registry semantics. It will not
invent a second analyzer artifact or accept developer API declarations
directly.

### Gate Re-Evaluation After The Canonical Program Slice

Roadmap 39 now provides the standard developer-intent and analyzer-input
contract. It deliberately does not mint runtime authority, and its later
Source Artifact V2/Semantic Artifact V1 materializer gate remains open.

That later materializer is not the immediate blocker for the exact
point-mutation runtime. The current trusted execution path already loads and
authenticates the active deployment projection before user code runs:

- `PointMutationOccRuntimeNeutralRunnerInputV1` contains the verified grant,
  canonical arguments, schema manifest, stable table bindings, and
  `PointMutationTargetFunctionMetadataV1`;
- the function metadata contains the path, execution module, exact mutation
  kind, public visibility, argument validator, and return validator; and
- `verifyPinnedFunctionMetadataEffect` checks that loaded metadata against the
  authenticated attempt state before the runner receives it.

The concrete loss occurs one boundary later.
`projectExactRuntimeRequestV1` currently copies only the function path, module,
kind, and visibility into `PointMutationExactRuntimeRequestV1`. The argument
validator and return validator are discarded, so the isolated core cannot
apply the same pinned validation contract. The first runtime slice must repair
that projection rather than treating the canonical program, analyzer output,
or a test registry as authority.

The resulting trust chain is:

```text
active authenticated deployment metadata
  -> trusted executor verification
  -> strict exact-runtime wire request including pinned validators
  -> isolated host adapter
  -> host-neutral invocation input
  -> portable point-mutation kernel
```

Direct in-process tests may construct the same strict invocation input through
an explicit test fixture builder. That builder is evidence only: it does not
produce an authenticated deployment, transaction grant, or commit authority.

### Selected Host-Neutrality Option

The preflight selects option 2: retain the current Cloudflare-oriented shell
and later extract a smaller portable execution operation inside it.

Extracting the full core now would either move Cloudflare-only global hardening
and RPC lifecycle into a supposedly portable package or duplicate missing
validator and nested-call semantics. Black-box fixtures alone would leave two
semantic implementations. A smaller operation allows the production shell to
retain the properties only Worker Loader and a fresh isolate can prove.

The later portable operation should remain plain TypeScript and Promise-based
at the sandbox boundary. Effect remains appropriate in the trusted
host/executor for typed failures, lifecycle settlement, and composition, but
the sandbox kernel must not evaluate an Effect runtime before global hardening
or acquire timer/network assumptions that the exact profile removes.

### Boundary And Package Decision

The verified projection gate above is now sufficiently concrete for the first
extraction. Create the intentional subpath
`@flarex/function-runtime/point-mutation`, with no package-root catch-all.

That portable owner may contain only:

- the verified point-mutation execution input consumed by the kernel;
- a per-invocation function registry;
- restricted auth, clock, random, and logical journal ports;
- function lookup, validation, context, handler, and result semantics; and
- runtime-owned typed failures.

It must not import Cloudflare, Miniflare, backend, executor-host, persistence,
R2, Node tooling, Drizzle, OCC, or commit owners. The Cloudflare adapter remains
with the artifact-runtime owner. The in-process adapter receives already-loaded
exports or an explicit registry and makes no claim about fresh module state,
import-time deterministic globals, ambient restrictions, or isolate security.
Do not add `vm`, data-URL imports, or cache busting merely to imitate Worker
Loader.

The package is justified immediately by two real adapters: the isolated
Cloudflare core and the in-process semantic-test host. The package may depend
only on portable protocol/value contracts required by the kernel. It must not
start an Effect runtime in the sandbox; typed Effect adaptation remains with
the trusted executor and host.

### Compatibility And Evidence

The generated core source SHA is part of exact-runtime identity. A later
extraction that changes generated bytes must update that identity deliberately
and prove behavior parity; source stability must not be assumed. If the
portable operation becomes another generated module, its bytes must be
included in the same identity and it must be imported only after the
Cloudflare shell has hardened globals.

The first extraction remains exact public point mutation only. It requires:

- one fixture executed through in-process and workerd adapters with the same
  verified projection, identity, time, seed, result, and logical journal;
- explicit parity for lookup, validators, context, operation order,
  first-failure selection, close/drain, and result normalization;
- separate platform evidence for module maps, freshness, globals, RPC,
  disposal, compatibility date, and isolation; and
- unchanged OCC, commit, idempotency, feed, outbox, and row-authority tests.

Queries, broader mutations, actions, HTTP actions, scheduling, and the public
test SDK remain later consumers with their own acceptance gates.

## Decisions And Rationale

### Standardize Runtime Semantics, Not Cloudflare APIs

The in-process host must not emulate `WorkerEntrypoint`, Worker Loader, service
bindings, or Miniflare. It supplies ordinary ports to the shared runtime
kernel. The Cloudflare adapter supplies equivalent ports from its isolated
environment.

### Keep Database Authority Behind A Logical Port

The runtime kernel may depend on a narrow database-journal capability whose
operations match the accepted user-code semantics. It may not depend on
Drizzle, Postgres, PGlite, executor repositories, transaction objects, physical
table IDs as caller authority, or arbitrary Fetch/service bindings.

The Cloudflare adapter translates this port to the one-attempt journal RPC
capability. An in-process test may supply:

- a deterministic recording journal for runtime semantic tests;
- an explicitly limited in-memory journal for pure contract tests; or
- the real trusted executor journal adapter for broader integration tests.

The fake/recording implementation is test evidence, not application-data
authority and not an alternate commit engine.

### Share One Execution Kernel

Subject to preflight, the shared kernel should own:

- function lookup, kind, and visibility enforcement;
- argument and return validation;
- `ctx.auth`;
- `ctx.db` reader/writer construction;
- query-builder behavior that is part of the developer contract;
- `ctx.runQuery` and `ctx.runMutation`;
- nested-call kind, depth, identity, and transaction rules;
- deterministic clock and randomness inputs;
- handler execution and async result handling;
- journal close/drain order;
- user-code versus journal/host failure classification; and
- canonical result normalization.

Host adapters retain module materialization, isolation, transport,
serialization, cancellation translation, logging/redaction boundaries, and
resource ownership.

### Use Per-Invocation Capabilities

Identity, database journal, clock, random seed, function registry, and
attempt-specific state are explicit per-invocation values. They must not become
global mutable singletons or one application-wide Context service because
multiple attempts and runtime instances must coexist safely.

Effect may describe the execution operation, typed failures, interruption, and
scoped adapter lifecycle where its semantics fit. The preflight must assess the
installed Effect version and choose explicit ports, services, Layers, and
runtime bridges by lifetime rather than by package-wide style.

### Keep The Cloudflare Host As The Production Isolation Boundary

The production adapter continues to own:

- Worker Loader module maps and entrypoint configuration;
- fresh-versus-cached isolate policy;
- Cloudflare compatibility date and runtime-shell identity;
- service-binding/RPC construction;
- unavailable globals and outbound capability restrictions;
- import-time deterministic environment behavior;
- platform disposal and resource limits; and
- hosted observability.

An in-process pass can never substitute for those proofs.

### Prefer A Dedicated Domain Owner If The Preflight Proves It

The leading package candidate is `@flarex/function-runtime`. It would own only
the host-neutral execution model, kernel, typed failures, and capability ports.

Cloudflare adaptation should initially remain with the existing artifact
runtime owner. Test composition should remain with `flarex-test` or a private
test-support subpath. The preflight must prove at least two real consumers and
may choose a narrower existing owner if extraction would only rename one
implementation.

## Candidate Contract Shape

The first extraction approves the following responsibility split. Exact names
may be adjusted mechanically during implementation, but changing ownership,
authority, or lifecycle requires another roadmap amendment:

```ts
interface PointMutationRuntimeFunctionV1 {
  readonly path: string;
  readonly kind: "mutation";
  readonly visibility: "public";
  readonly argsValidator: ObjectValidatorJsonV1 | AnyValidatorJsonV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
}

interface PointMutationRuntimeInputV1 {
  readonly function: PointMutationRuntimeFunctionV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly tables: ReadonlyArray<PointMutationRuntimeTableV1>;
}

interface PointMutationFunctionRegistryV1 {
  readonly resolve: (path: string) => unknown | PromiseLike<unknown>;
}

interface PointMutationInvocationV1 {
  readonly context: PointMutationRuntimeContextV1;
  readonly journal: PointMutationRuntimeJournalV1;
}

interface PointMutationRuntimeV1 {
  readonly execute: (
    input: PointMutationRuntimeInputV1,
    registry: PointMutationFunctionRegistryV1,
    invocation: PointMutationInvocationV1,
  ) => Promise<CanonicalFlarexRuntimeValueV1>;
}
```

The strict exact-runtime wire request remains protocol-owned and includes
artifact, authentication, deterministic-host, and transport data that the
portable kernel does not need. The Cloudflare adapter decodes that request and
projects only the function definition, canonical arguments, table bindings,
context, registry, and logical journal into the kernel.

The function registry is per invocation and resolves an already-loaded module
graph. It is not proof that arbitrary exports are valid. The kernel still
checks the runtime marker shape, exact mutation kind, public visibility, and
handler. The adapter or projection owner establishes module authenticity and
pinned function metadata before the kernel runs.

The invocation owns one close/drain lifecycle. The kernel:

1. resolves and checks the function;
2. validates canonical arguments against the pinned argument validator using
   table-aware ID policy;
3. invokes the handler with the restricted context;
4. closes admission to new journal operations;
5. drains the stable operation tail;
6. preserves journal failure precedence over a concurrent handler failure;
7. normalizes the returned value, treating `undefined` as `null`;
8. validates that normalized value against the pinned return validator when
   one exists; and
9. returns the canonical value.

The adapter owns final disposal even when lookup, validation, handler, drain,
normalization, or return validation fails. Cloudflare global hardening,
deterministic global installation, module import timing, one-shot Worker
admission, and RPC-stub disposal remain in the isolated shell. An in-process
adapter supplies already-loaded exports and explicit context/journal objects;
it does not mutate process globals or claim import-time determinism.

Runtime failures are a closed portable union covering function lookup/shape,
argument validation, user handler, journal drain, result normalization, and
return validation. Host adapters translate that union into their existing
redacted boundary errors. Raw user exceptions and foreign journal causes stay
as private causes and are not serialized as public diagnostics.

### First Approved Extraction Vertical

The first implementation slice is deliberately exact public point mutation
only:

1. add `@flarex/function-runtime/point-mutation` with the portable Promise
   kernel, explicit registry/context/journal contracts, typed failures, and
   direct fixture support;
2. extend the exact-runtime protocol request with the already-pinned argument
   and return validators and project them from the trusted runner input;
3. make the generated Cloudflare core import the portable kernel as a reserved
   runtime-support module after global hardening;
4. retain request admission, deterministic globals, module materialization,
   RPC disposal, result envelope construction, and host error translation in
   the Cloudflare shell;
5. add an in-process adapter that receives an explicit registry and recording
   journal; and
6. run one shared fixture through both adapters, asserting result, validation,
   logical journal sequence, close/drain ordering, and first-failure parity.

The portable module's generated source and digest become part of the exact
runtime code identity. The build must prove two byte-identical clean outputs.
No temporary duplicated kernel is allowed: after parity passes, the extracted
lookup/validation/invocation/settlement/result logic is removed from the
Cloudflare core in the same slice.

This vertical does not add query builders, nested calls, general mutations,
actions, scheduling, public `flarex-test` behavior, production routing, or a
new deployment artifact version.

### First Extraction Implementation Receipt

The approved exact public point-mutation extraction is now implemented:

- `@flarex/function-runtime/point-mutation` owns the portable Promise-based
  kernel, verified invocation shape, registry/context/journal ports, validator
  execution, handler settlement, result normalization, and host-neutral typed
  failures;
- the protocol-owned exact request carries the trusted executor's pinned
  argument and return validators, applies protocol-owned depth, node, and
  object-field admission limits before recursive decoding, and the executor
  projects those validators only after its existing stored-attempt
  verification;
- a deterministic build emits the kernel as a reserved runtime support module,
  proves two byte-identical clean outputs, and includes the module path and
  digest in exact-runtime code identity;
- the Cloudflare shell imports that support module only after global hardening,
  retains one-shot admission, deterministic globals, module materialization,
  journal RPC construction, and disposal, and translates authenticated
  portable failure inspections into the existing redacted host-response
  reasons;
- direct in-process execution uses the same kernel with an explicit registry
  and invocation factory and receives no Worker Loader, Cloudflare binding,
  persistence, OCC, or commit authority; and
- the duplicated exact lookup, marker, argument validation, handler settlement,
  result normalization, and return-validation path was removed from the
  Cloudflare core.

The shared parity fixture now proves the same pinned function, validators,
arguments, user identity, table projection, logical insert, result, and
close/drain lifecycle through generated and in-process adapters. It also proves
the same journal-over-handler first-failure rule while retaining each host's
owned error name. Separate workerd evidence proves the real support-module
graph, frozen-intrinsic error construction, and contract-failure translation
for missing functions, malformed metadata, and invalid arguments. Fixed time,
seeded randomness, hardened globals, fresh module state, and isolation remain
Cloudflare-platform claims because the in-process adapter deliberately does not
patch process globals.

Focused validation covers package, protocol, executor, backend, generated
source, workerd, and artifact-runtime paths. The extraction does not change
production routing, persistence delivery, replay, OCC, commit compilation or
execution, transaction grants, idempotency outcomes, feeds, outbox behavior,
or authoritative application rows.

### Post-Extraction Audit And Next-Consumer Decision

The required post-extraction audit is complete.

Dependency direction remains narrow:

- `@flarex/function-runtime/point-mutation` has no package-root export and its
  production source uses only type imports from portable protocol owners;
- the generated-kernel build rejects retained runtime imports and proves two
  byte-identical outputs;
- the portable package imports no Cloudflare, Miniflare, backend, executor,
  persistence, Node, R2, Drizzle, OCC, commit, or Effect runtime owner; and
- the backend depends inward on the portable package while the package has no
  dependency back to a host or application.

Failure ownership is also closed. Portable failures are authenticated by a
module-private `WeakMap` inspection rather than by caller-forgeable names or
`instanceof` checks. The Cloudflare adapter translates only authenticated
portable failures into exact-runtime boundary errors, and the artifact host
maps those names into existing redacted host-response reasons. Developer code
cannot mint a journal failure merely by importing an exported error class.
Own error names are installed as data properties so frozen
`Error.prototype` remains compatible in the real workerd lane.

Generated identity remains complete. Exact-runtime code identity includes the
main core path and digest plus the portable-kernel support-module path and
digest. The support module is part of the reserved module graph and is imported
after intrinsic hardening. Source or digest drift fails the backend build.

Validator admission now has one protocol owner for depth, node, and object-field
limits. The protocol preflights unknown validator containers before recursive
Schema decoding. The portable kernel and generated shell type-pin their erased
local constants to those protocol literals, apply one node budget per validator
root, and have boundary tests for the maximum-depth and aggregate two-validator
cases.

The remaining exact-core overlap is deliberate and must not be described as
two execution kernels:

- the shell still structurally decodes the RPC request and validator JSON
  because generated Worker source must fail closed on its own unknown-input
  boundary;
- the shell still normalizes request/auth values, developer database-operation
  inputs, and journal documents because those values cross host or journal
  trust boundaries;
- the portable kernel owns function lookup/markers, semantic argument and
  return validation, handler execution, close/drain precedence, and returned
  value normalization; and
- no second lookup, handler, settlement, or returned-value path remains in the
  Cloudflare shell.

The next-consumer preflight considered the public `flarex-test` harness and
rejects changing it in this slice. Its current contract intentionally starts
the real local Miniflare runtime and proves source analysis, artifacts,
backend/executor sessions, persistence, sync, lifecycle, and Cloudflare-shaped
boundaries. Replacing its public `query()` or `mutation()` path with the
in-process kernel would silently weaken that evidence and would be incomplete
because this kernel supports only exact public point mutations.

A separate generic recording database or fixture adapter is also not approved.
The existing registry and invocation-factory ports already allow explicit
low-level fixtures. Publishing a mock database now would create a second
FlarexDB semantic owner rather than a thin adapter. A future private
test-support subpath requires a concrete repeated consumer and must remain a
fixture/lifecycle helper over caller-supplied capabilities.

## Test Evidence Lanes

The target has three complementary lanes:

| Lane | Host | What it proves |
| --- | --- | --- |
| Runtime semantic | In-process | Function lookup, validation, context behavior, nested calls, deterministic inputs, result/failure normalization, and logical journal sequence |
| Adapter parity | In-process plus workerd | The same verified fixture produces equivalent result and logical journal behavior through both hosts |
| Platform | Miniflare/workerd/hosted Cloudflare | Module-map loading, isolate/module freshness, globals, RPC serialization/disposal, compatibility date, service bindings, restrictions, and resource behavior |

The public `flarex-test` harness may later use the faster host for explicitly
scoped tests, but its real-runtime contract must not silently change. That
decision belongs to a later test-SDK preflight after runtime parity exists.

## Relationship To The Private Standard Application Harness

[`41-private-standard-application-composition-and-real-system-harness.md`](./41-private-standard-application-composition-and-real-system-harness.md)
is the first planned cross-domain consumer of the capability-specific runtime
subpaths owned here. It does not authorize a universal application runtime or a
generic invocation package.

The private harness must expose only runtime capabilities implemented end to
end. Its first executable operation may target
`@flarex/function-runtime/point-mutation`; query, nested-call, general-mutation,
action, and scheduled-invocation methods remain absent until their separately
approved kernels and host adapters pass semantic, parity, and platform gates.
Canonical declarations may describe a function before its runtime capability
exists, but the harness must distinguish analyzable definition support from
executable runtime support.

New portable semantics stay in deliberate capability subpaths under
`@flarex/function-runtime`. Do not create
`@flarex/function-runtime/application`, move schema or registration authority
into this package, or make the private system harness a runtime dependency. The
harness is a top-level test composition consumer; production and portable
runtime packages never depend back on it.

## Mandatory Preflight Before Implementation

The preflight is a research deliverable. It must inspect current code, generated
artifacts, build scripts, tests, and host behavior and produce an accepted
amendment to this record before extraction begins.

### P1. Execution-Semantics Inventory

Inventory the exact and ordinary runtime implementations for:

- function module resolution and cache behavior;
- function markers, kind, visibility, and handler extraction;
- argument and return validation;
- `ctx.auth`;
- every `ctx.db` and query-builder method;
- nested query/mutation behavior;
- time, randomness, and other global patching;
- result normalization and serialization;
- journal close, drain, settlement, and disposal;
- error classification, messages, and cause handling; and
- request admission, single-use state, interruption, and cleanup.

Mark exact duplication, intentional divergence, legacy-only behavior, and
Cloudflare-only mechanics.

### P2. Authority And Trust Matrix

For every input and capability, identify:

- who authenticates or verifies it;
- whether it is serialized, process-local, or RPC-only;
- who may construct it;
- its lifetime and disposal owner;
- whether user code can retain or forge it;
- whether it can read, journal, commit, activate, or route; and
- its behavior after interruption, retry, or uncertain outcome.

This step must prove that the new boundary cannot bypass the existing
transaction grant, session, journal, OCC, commit, or persistence owners.

### P3. Host-Neutrality Options

Compare at least:

1. extracting a portable kernel invoked by both hosts;
2. retaining a Cloudflare-oriented core with a smaller portable execution
   operation inside it; and
3. retaining current code and adding only black-box contract fixtures.

For each option, assess generated-source build constraints, module imports,
bundle size, Cloudflare compatibility, in-process module loading, typed errors,
Effect runtime bridges, and expected duplication removed.

### P4. Module Loading And Freshness Research

Define what the in-process adapter receives:

- already-loaded module exports;
- an explicit function registry;
- a module-loader port; or
- a fresh JavaScript realm.

Research Node/JavaScript module-cache behavior and choose a design that is
honest about what it does not isolate. Do not add cache-busting, `vm`, or data
URL loading merely to imitate Worker Loader unless a concrete test requirement
and lifecycle proof justify it.

Import-time deterministic time/random behavior must remain a separate platform
claim unless the selected in-process mechanism actually proves it.

### P5. Contract And Package Ownership

Propose concrete internal types, subpath exports, error owners, dependency
direction, and host composition. Confirm that the portable owner imports no
Cloudflare, Miniflare, backend, executor host, persistence, R2, Node-only
tooling, or deployable application.

Assess whether protocol request/result types can be reused exactly or need a
separate in-process operation type. Do not redeclare weaker lookalike wire
contracts.

### P6. First Vertical And Compatibility Plan

The default candidate is exact point mutation only. The preflight must identify
every changed caller and generated artifact, prove whether current source bytes
or only behavior must remain stable, and define the removal gate for any
temporary adapter.

Queries, ordinary mutations, workflow mutations, actions, HTTP actions, and
scheduling are separate consumers. They do not enter the first slice unless
the preflight proves that excluding one would create two semantic kernels.

### P7. Validation Plan

Specify focused tests for:

- identical function fixture, request, identity, time, seed, and journal
  producing equivalent in-process and workerd results;
- identical logical operation ordering and first-failure behavior;
- malformed metadata, wrong function kind, invalid arguments and returns;
- handler failure versus journal failure versus host defect;
- nested calls and depth enforcement;
- journal close/drain/disposal under success, failure, and interruption;
- deterministic repeated in-process execution;
- Cloudflare-only freshness, globals, RPC, and module-map properties; and
- unchanged OCC, commit, idempotency, feed, outbox, and authoritative row
  behavior.

## Preflight Exit Criteria

Implementation may begin only after the preflight has:

1. mapped the complete first-vertical execution lifecycle;
2. separated portable semantics from Cloudflare, executor, and persistence
   authority;
3. selected the kernel boundary and package owner;
4. proposed concrete versioned request, capability, result, and error types;
5. defined per-invocation lifecycle and interruption/disposal behavior;
6. identified behavior or byte-level compatibility obligations;
7. defined adapter-parity and platform-only tests;
8. selected the smallest first vertical and rollback/removal gate; and
9. been recorded as an accepted update to this roadmap.

An incomplete answer to any item keeps this decision research-only.

## Known Risks

- The in-process adapter could become an attractive but semantically different
  mock backend.
- Extracting only names while leaving duplicated behavior would create the
  appearance of a standard without parity.
- Moving Cloudflare or executor capabilities into the portable kernel would
  widen user-code authority.
- A global service/runtime could leak attempt identity, module state, clock, or
  randomness across executions.
- Node module-cache behavior could be mistaken for fresh-isolate proof.
- Ordinary generated runtime and exact point-mutation runtime semantics may
  differ intentionally; extraction could erase those distinctions.
- A large first migration could change journal ordering, failure
  classification, or transaction behavior.

## Target Direction

The target permits a fast full semantic lane without weakening the production
boundary:

```text
canonical program fixture
  -> build and analyzer fixtures
  -> verified runtime projection fixture
  -> in-process function runtime
  -> recording or trusted executor journal
```

The production lane consumes the same verified runtime semantics:

```text
active verified runtime projection
  -> Worker Loader
  -> fresh isolated Dynamic Worker
  -> same function runtime kernel
  -> one-attempt journal RPC
  -> trusted executor and FlarexDB
```

## Next Correctness Gate

The approved exact public point-mutation extraction and its post-extraction
audit are complete. The first proposed next consumer—public `flarex-test`
execution—is explicitly deferred because it would weaken the harness's
real-runtime contract. No test-support package is justified merely by the two
current fixture implementations.

Before another function-runtime implementation begins, record a fresh preflight
for one concrete capability with two proven consumers and an
authority-preserving adapter plan. Roadmap 41's completed `SAC01-P` preflight
accepts only pure test fixture data; it does not yet establish even one new
runtime consumer and does not authorize package extraction. A later private
live harness may establish one concrete consumer, but it still does not by
itself prove the second. Candidate capabilities include a future exact query
kernel shared by approved in-process and workerd hosts, or a private
fixture/lifecycle helper after a real repeated consumer exists. Queries, query
builders, nested calls, general mutations, actions, scheduling, and public
test-SDK behavior remain separate decisions.

Do not reroute production, change OCC, commit, feed, outbox, or application-row
semantics, and do not claim that the in-process adapter proves Worker Loader
isolation, module freshness, deterministic globals, or Cloudflare resource
restrictions.
