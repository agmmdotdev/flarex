# Host-Neutral Function Runtime

## Status And Scope

**Status:** Preflight and the first-extraction amendment are accepted. The
prerequisite journal-boundary correction, canonical declarative-program first
vertical, and host-neutral exact public point-mutation extraction are
implemented and validated. Later private point-query, internal-call, and edge-
action verticals proved additional concrete consumers. The centralized
Function API Core direction and focused preflight recorded below are accepted,
and `FAC01` through `FAC05` are implemented and validated. The next gate is a
fresh `FAC06` preflight for normal `ctx.*` analyzer lowering and removal of
synthetic private-platform authoring where current evidence permits it.
Production routing remains deferred.

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

## Accepted Centralized Function API Core Direction

The capability-by-capability verticals proved the host-neutral runtime owner,
but they also exposed an architectural duplication that must be corrected
before more developer-visible System APIs are added. Exact point-query,
query-internal-call, mutation-internal-query, mutation-internal-call, and
related hosts currently generate profile-specific `flarex:platform` modules.
Those modules repeat operation-scoped context lookup, auth and database
forwarding, internal-call forwarding, and some application-error mechanics.
The exact Worker cores also construct overlapping `ctx` and database facade
objects around their host capabilities.

This is not a reason to remove generated Worker graphs. Worker Loader still
requires one exact, authenticated module graph whose candidate-specific
configuration, application registry, module references, compatibility facts,
and digests participate in runtime identity. It is a reason to stop generating
reusable execution semantics as profile-specific template source.

The accepted distinction is:

| Generated per candidate/profile | Shared implementation owned by `@flarex/function-runtime` |
| --- | --- |
| immutable configuration and budgets | invocation-scoped context carrier |
| exact module/export registry | `ctx.auth` facade |
| authenticated R2 module references and digests | database reader/writer facades and query-builder semantics |
| selected runtime profile and support-module identities | `ctx.runQuery` / `ctx.runMutation` semantics |
| minimal Worker entrypoint and host adapter wiring | validator, result, settlement, and failure semantics |

Generated code declares which approved runtime profile and capability modules
the exact graph contains. It must not emit another implementation of database
methods, internal calls, context-stack management, or shared application-error
behavior merely because the selected profile differs.

### One Core, Narrow Capability Profiles

The central core is rich at the developer boundary and narrow at the authority
boundary. It may construct the supported Convex-shaped APIs, including
`ctx.auth`, `ctx.db`, query builders, `ctx.runQuery`, and `ctx.runMutation`, but
every effect delegates to an explicit per-invocation capability supplied by the
trusted host. It never receives Postgres, Drizzle, a transaction object, raw R2
or Worker bindings, an unrestricted service-binding namespace, activation
authority, or commit authority.

Do not create one universal context with optional or throwing methods. Compose
separate exact profiles from reusable feature owners:

| Feature | Query profile | Mutation profile | Edge-action profile |
| --- | --- | --- | --- |
| auth | yes | yes | yes |
| database reader | yes | yes | no |
| database writer | no | yes | no |
| internal query | only when the selected private profile admits it | only when the selected private profile admits it | authenticated callback, separate transaction |
| internal mutation | no | only when the selected private profile admits it | authenticated callback, separate transaction |
| controlled outbound effect | no | no | only when the selected action profile admits it |

Query and mutation internal calls preserve their accepted same-session,
same-journal/snapshot rules. Action callbacks preserve their separately owned
transaction and uncertainty semantics. Reusing a facade implementation must
not collapse these distinct consistency contracts.

The context carrier is invocation-scoped. A process-wide mutable singleton is
forbidden because attempts, nested calls, and future concurrently admitted
invocations must not leak context or capabilities. A Cloudflare adapter may
bind the shared core to a one-shot exact Worker, while an in-process semantic
adapter supplies the same narrowed ports without claiming isolate freshness.

### Authoring And Execution Primitives Remain Separate

There are two related but distinct primitive layers:

1. `@flarex/standard-application-definition/v1` owns inert typed authoring and
   lowering primitives: validators, function contracts, references, and
   canonical definition preparation.
2. `@flarex/function-runtime` owns executable context/facade construction,
   capability profiles, handler invocation, validation, lifecycle settlement,
   and portable failure semantics.

The future developer API and the internal simulation/test API are sibling
producers above the first layer. Neither is implemented on top of the other.
They may use different ergonomics, invalid-input fixtures, seeds, and fault
plans, but both lower into the same Standard Application contracts and execute
through the same runtime core. Test convenience must not become runtime
authority or a second database implementation.

Developer and simulation handlers should author ordinary `ctx.*` calls. The
analyzer may recognize or lower those calls to its canonical safe-operation
catalog, but `flarex:platform` is a private generated/runtime ABI, not an
application authoring API. Direct imports of `databaseGet`, `databaseInsert`,
`runQuery`, or `runMutation` from `flarex:platform` are temporary private
fixture/runtime evidence and must not be stabilized as developer syntax.

### Extensibility Rule

New APIs such as storage, scheduling, search, or additional action effects are
added as separately owned feature modules only after their analyzer operation,
runtime facade, authenticated host port, availability matrix, budgets, typed
failures, and Workerd/in-process evidence agree. Application code cannot supply
runtime plugins or select raw capabilities. A generated manifest may select
only platform-owned, versioned features admitted by the active target.

Do not create a new `flarex-core` or catch-all runtime package. The existing
`@flarex/function-runtime` package is the proven owner; use intentional private
subpaths and retain capability-specific public/internal subpaths where their
contracts genuinely differ.

### Focused Implementation Preflight

Before implementation, amend this record with one exact inventory and
migration plan that:

1. classifies every generated runtime module as candidate data, application
   registry, minimal host adapter, reusable runtime behavior, or legacy-only;
2. maps duplicated platform/context/database/internal-call/error behavior
   across all accepted exact profiles;
3. defines the invocation-scoped feature contracts and the query, mutation,
   and action availability matrices without a universal optional capability;
4. identifies the smallest shared query-plus-mutation extraction that proves
   two real consumers without changing their snapshot/journal semantics;
5. defines how normal `ctx.*` authoring reaches the analyzer-owned safe ABI
   without exposing `flarex:platform` to developers;
6. records every generated-core, support-module, target, profile, ABI, and graph
   identity that must be deliberately refreshed;
7. requires byte-deterministic generated output, in-process semantic parity,
   genuine Workerd execution, and unchanged executor/OCC/commit evidence; and
8. removes migrated template implementations in the same capability slice,
   with no parallel old/new facade, dual acceptance, or fallback.

The preflight must stop for a new decision if centralization would change a
public authoring contract, analyzer operation identity, persistence schema,
snapshot or transaction ownership, action uncertainty semantics, production
route, or activation behavior.

## Centralized Function API Core Preflight Decision

**Decision date:** 2026-08-06
**Decision:** proceed in bounded, committed slices. The first implementation
slice is `FAC01`, the shared invocation-context foundation used by the two
currently selected private query and mutation profiles. This preflight does not
change a public authoring contract, analyzer operation identity, protocol
format/version, persistence schema, transaction owner, active reader, route, or
production behavior.

### Current Exact-Graph Inventory

All accepted exact profiles use the same broad graph pattern, but the purpose
of each module is different and must remain explicit:

| Module class | Current examples | Classification | Centralization decision |
| --- | --- | --- | --- |
| application source modules | authenticated candidate module paths loaded from R2 | candidate/application body data | remain immutable R2-owned bodies; never copy into PostgreSQL or a shared runtime package |
| generated configuration module | `*-exact-runtime-config-v1.js` | candidate/profile data: target digest, compatibility time, budgets, root and internal catalogs | remain generated and candidate-bound |
| generated execution bridge | `*-exact-runtime-execution-v1.js` | exact application registry and module/export adapter | remain generated; it is data-shaped code, not a general runtime facade |
| generated runtime kernel | `*-runtime-kernel-v1.js` and the matching `*RuntimeKernel.generated.ts` source receipt | reusable runtime behavior built from one `@flarex/function-runtime` capability subpath | retain as a deterministic graph artifact while progressively sharing its source-level feature owners |
| exact Worker main | `*-exact-runtime-v1.js` and the matching `*WorkerCore.generated.ts` source receipt | request/RPC decoder, host-capability adapter, one-shot admission, deterministic globals, settlement, and currently some duplicated facade construction | keep the Cloudflare-only adapter; move only portable facade semantics out of it |
| synthetic `flarex:platform` module | present in exact query, query-internal-call, mutation-internal-query, and mutation-internal-call graphs | private analyzer/runtime compatibility ABI plus duplicated ambient context forwarding | temporary private adapter; shrink after shared context features exist and remove only when normal `ctx.*` authoring is analyzer-proven |
| declaration-only platform files | `Point*Platform.d.ts` | build-time description of the private synthetic module | keep aligned with the temporary adapter; never publish as a developer API |

The original point-mutation profile has configuration, execution bridge,
kernel, and Worker main modules but no synthetic platform module. Its Worker
main constructs the database and a broad context containing throwing
`runQuery`, `runMutation`, scheduler, and storage placeholders. The original
point-query profile uses a synthetic platform module but has no internal-call
feature. Both identities remain accepted historical profiles, but neither is
the sole selected Standard invocation path now.

The selected private paths are:

- SAP05 selects only the query-internal-call target/profile from roadmap 45;
- SAP04 selects only the combined mutation-internal-call target/profile from
  roadmap 45; and
- edge action remains the separately owned action profile. Its kernel receives
  an authenticated callback capability and has no database facade or synthetic
  `flarex:platform` module.

The query-internal-call Worker currently constructs auth, a point-read database,
pending-read settlement, and a context binder. Its function-runtime kernel adds
only the admitted `runQuery` feature for each parent or child frame. The
mutation-internal-call Worker currently constructs auth, the existing
journal-backed database, deterministic time/random state, and a broad base
context with unsupported features. Its function-runtime kernel adds the
admitted `runQuery` and `runMutation` features for each frame. The synthetic
platform modules then repeat ambient lookup plus auth/database/internal-call
forwarding so analyzed fixture source can import private safe-ABI functions.

This inventory classifies the duplication as follows:

| Concern | Classification |
| --- | --- |
| auth facade and exact query/mutation base-context shape | exact duplication suitable for a shared feature owner |
| point-read pending set, close, drain, and read-boundary error | intentional query host behavior; later reader-facade extraction may accept a narrow read port but cannot erase this owner |
| mutation journal database and read-your-writes overlay | intentional mutation host behavior; any later writer-facade extraction must preserve the current journal operation order and poisoning rules |
| same-snapshot query `runQuery` | intentional query-internal-call policy owned by its kernel |
| same-journal mutation `runQuery` / `runMutation` | intentional mutation-internal-call policy owned by its kernel |
| deterministic globals, one-shot admission, RPC disposal, request decoding | Cloudflare-only Worker mechanics |
| validator, handler, nested-call budget, result and failure settlement | reusable capability-specific kernel behavior already owned by `@flarex/function-runtime` |
| ambient `contextsV1` arrays and forwarding exports | temporary private ABI behavior, not the future authoring or concurrency model |

### Convex Comparison And Deliberate Divergence

Current Convex source constructs query, mutation, and action contexts in the
shared server implementation. `registration_impl.ts` combines `setupReader`,
`setupWriter`, `setupAuth`, and action-call helpers; `database_impl.ts` owns the
JavaScript database facade; and `syscall.ts` delegates through host-injected
`Convex.syscall` / `Convex.asyncSyscall`. The isolate installs that narrow host
bridge in `crates/isolate/src/request_scope.rs`. Convex generates application
API/type artifacts and bundles application modules, but it does not generate a
new database implementation for each function profile.

Flarex adopts that shape:

```text
normal handler ctx
  -> shared @flarex/function-runtime facade
  -> exact feature-specific host port
  -> query snapshot OR mutation journal OR action callback
  -> existing executor / OCC / commit owner where applicable
```

Flarex deliberately does not copy the exact Convex global syscall transport.
Candidate/revision/fence identity, content-addressed R2 bodies, authenticated
Worker Loader graphs, Workerd isolation, service-binding RPC, query snapshots,
mutation journals, and action uncertainty are real platform differences. The
shared facade may see only the narrow invocation port for its selected feature;
it never sees PostgreSQL, Drizzle, R2, a raw binding namespace, a transaction,
activation authority, or commit authority.

### Rejected Designs

1. **One universal context with optional or throwing capabilities is
   rejected.** It makes availability a runtime accident, repeats the broad
   placeholder shape already visible in the original mutation Worker, and
   permits query, mutation, and action consistency contracts to drift.
2. **The ambient synthetic platform stack is rejected as the permanent core.**
   It is safe only under the current one-shot admission assumptions and makes
   future concurrent or re-entrant admission depend on mutable module state.
   The first slices may retain it as the existing private authoring bridge, but
   no new developer contract may depend on it.
3. **Generating a complete facade per exact profile is rejected.** Generated
   source should select data, registry, budgets, and approved support-module
   identities, not reimplement database and context semantics.
4. **Replacing the exact Worker with only an in-process kernel is rejected.**
   It would lose authenticated graph, Workerd, module-freshness, RPC, and
   resource-boundary evidence.
5. **Changing authored source to `ctx.*` in the same first slice is rejected.**
   That is an analyzer/authoring contract change and would hide whether the
   runtime extraction itself preserved behavior. It receives a later explicit
   parity slice while reusing the existing safe-operation identities.
6. **A new catch-all core package is rejected.** The existing
   `@flarex/function-runtime` package is the proven portable owner.

### Selected Feature Contracts

The shared core uses positive capability composition. Absence is represented
by absence from the context type and object, not by an optional member or a
throwing stub.

| Facade feature | Trusted host port | Query internal-call | Mutation internal-call | Edge action |
| --- | --- | --- | --- | --- |
| auth | captured anonymous/authenticated identity plus trusted clone operation | yes | yes | yes, through its separate action context |
| point reader | `readPointDocument(table, id)` plus query settlement owner | yes | supplied by the journal-backed database | no |
| point writer | exact journal operations | no | yes | no |
| internal query | kernel-owned authenticated registry invocation | yes, same snapshot | yes, same journal/overlay | callback as a separate transaction only |
| internal mutation | kernel-owned authenticated registry invocation | no | yes, same journal/overlay | callback as a separate transaction only |
| controlled outbound effect | action callback capability | no | no | yes |

The shared auth facade preserves `null` for anonymous invocation and returns an
owned clone for authenticated identity on each call. Query and mutation base
context constructors contain only `auth` and the exact database surface passed
to them. Internal-call kernels attach only their admitted call methods. No
scheduler, storage, action, write, or internal-call member is synthesized when
the profile does not admit it.

The shared implementation is pure Promise-based TypeScript because these
facades execute inside user-code Workerd modules. Effect remains appropriate at
the backend/executor composition and lifecycle boundaries; placing an Effect
runtime inside handler `ctx` methods would create a second execution contract.
Typed host failures continue to be classified by their existing query,
mutation, action, and backend owners.

### Normal `ctx.*` Authoring Plan

The public developer API and internal system-test API remain sibling producers
over `@flarex/standard-application-definition/v1`. Both should eventually emit
ordinary Convex-shaped handlers. The analyzer will recognize the admitted
`ctx.auth`, `ctx.db`, `ctx.runQuery`, and `ctx.runMutation` member-call forms and
lower them to the existing safe-operation catalog. This does not require a new
database semantic owner or new operation names.

That analyzer slice must prove lexical binding and shadowing, direct member-call
shape, catchability, required `await` behavior, query-versus-mutation
availability, static internal references, and rejection of aliases or dynamic
property access that would escape the safe catalog. Only after analyzer,
materializer, Workerd, and system-test parity passes may fixture application
source stop importing `flarex:platform`. The platform specifier remains
reserved and private throughout the transition; there is no dual public
authoring contract.

### `FAC01`: First Implementation Slice

The first implementation is deliberately smaller than database or nested-call
centralization while still proving one real query and one real mutation
consumer:

1. add one intentional private support subpath under
   `@flarex/function-runtime` for the shared auth facade and exact query and
   mutation base-context constructors;
2. add one deterministic generated support-module receipt and one private exact
   graph module specifier for that shared implementation;
3. make the selected query-internal-call and mutation-internal-call Worker cores
   import that support module;
4. delete their duplicated auth/base-context construction, including the
   mutation core's unsupported `runQuery`, `runMutation`, scheduler, and storage
   placeholders; and
5. retain the existing kernels as the only owners that attach admitted internal
   calls, and retain the query read boundary and mutation journal as their
   current host owners.

`FAC01` does not modify the original query, original mutation,
mutation-internal-query, or edge-action identities. Those profiles are
regression evidence and enter later slices only when a selected consumer or
removal gate justifies them. This avoids mechanically rewriting frozen profiles
before the current Standard query and mutation paths prove the shared core.

### Identity And Generated Closure

`FAC01` deliberately refreshes:

- the new shared support-module source receipt and SHA-256;
- the selected query-internal-call Worker-core generated source and SHA-256;
- the selected mutation-internal-call Worker-core generated source and SHA-256;
- both selected worker graph-basis digests; and
- candidate-bound runtime-target digests derived from those graph bases.

The existing query-internal-call and mutation-internal-call protocol format,
version, exact-runtime-profile identity, syscall-ABI identity, request/result
shape, call budgets, and persistence schema remain unchanged. Tests must prove
that regenerated target digests are derived rather than silently pinned old
receipts. There is no old/new graph fallback or dual acceptance.

### `FAC01` Validation And Removal Gate

Required evidence is:

- focused `@flarex/function-runtime` tests for anonymous/authenticated cloning,
  runtime freezing, exact query/mutation member availability, and capability
  alias preservation;
- byte-deterministic support-module and both selected Worker-core builds;
- graph-basis and runtime-target identity tests for both selected profiles;
- genuine Workerd query-internal-call and mutation-internal-call success,
  nested-call, validation, first-failure, close/drain, disposal, and resource
  budget coverage;
- SAP05 and SAP04 system composition regression, including PGlite and genuine
  PostgreSQL evidence already owned by those verticals in proportion to the
  changed facade boundary; and
- unchanged journal order, read-your-writes, OCC retry, rollback, uncertainty,
  committed application row, result, feed, and outbox behavior.

The duplicated selected-profile auth/base-context builders are removed in the
same commit. The temporary platform modules are not removed in `FAC01` because
current analyzer-authored fixtures still import their private ABI. Their
removal gate is normal-`ctx.*` analyzer parity plus migration of every direct
application-source import, followed by generated-graph and Workerd proof with
no fallback.

### `FAC01` Implementation Receipt

**Completed:** 2026-08-06

The committed implementation establishes one private, self-contained
`flarex:function-api-core/v1` support module generated from
`@flarex/function-runtime/internal/function-api-core-v1`. It owns the exact
anonymous/authenticated auth facade and frozen query/mutation base-context
construction. The selected query-internal-call and mutation-internal-call
Workers both consume that module, preserve their existing database capability
objects by identity, and no longer construct duplicate auth/base contexts. The
mutation profile no longer advertises fake throwing scheduler or storage
members. This is runtime implementation reuse, not a new public authoring API.

The deterministic generated closure is:

- shared Function API Core SHA-256
  `30fdbbf7e3563264eb0e21b0c39399ec2f59c4281f110f1062e4f2e6b38ca47b`;
- selected query-internal-call Worker-core SHA-256
  `3699b1105327c98844838ab005bd308eb05cd01a2d94beb57cb87e51e1b1d0cb`;
  and
- selected mutation-internal-call Worker-core SHA-256
  `9c94eadf207dd3494ef003c918b711c7398a1b53c4fc83f9418faabda8f73c5b`.

Validation passed for the full `@flarex/function-runtime` suite (46 tests),
focused generated-identity and selected-profile Workerd suites, backend and
affected-consumer typechecks, every backend generated-source check,
`check:effect-boundaries`, SAP05 PGlite and genuine PostgreSQL suites, and the
SAP06-A3 mutation-internal-call PGlite and genuine PostgreSQL suites that prove
the combined SAP04-selected mutation profile. The genuine PostgreSQL evidence
used a fresh isolated PostgreSQL 18 cluster and included both acceptance cases
in each selected suite. The exact-final TypeScript/Effect and code-quality
reviewers reported no findings after the one identified graph-to-target
identity-proof gap was corrected and re-reviewed.

No analyzer operation identity, protocol/profile/syscall ABI version,
persistence schema, snapshot or journal owner, OCC/commit behavior, action
uncertainty, activation, route, or production behavior changed. The existing
synthetic platform ABI remains private and temporary; there is no fallback or
dual graph acceptance.

### `FAC02` Point-Reader Preflight Decision

**Accepted:** 2026-08-06

The current Convex runtime keeps the JavaScript database facade separate from
the host bridge. `database_impl.ts` owns `setupReader()` and its `get` method,
which delegates through the async syscall boundary; `setupWriter()` reuses that
reader's `get` and adds mutation methods. `registration_impl.ts` installs the
reader on query contexts and the writer on mutation contexts. Convex therefore
provides useful shape guidance, but it does not justify moving snapshot,
journal, transaction, or persistence authority into a Flarex facade.

Current Flarex evidence has two deliberately different point-read adapters:

- the selected query Worker owns table lookup, revalidation, pending-read
  tracking, close/drain, read-boundary failure capture, and its admitted
  snapshot capability; and
- the selected mutation Worker owns table-capability resolution, exact journal
  sequencing, read-your-writes, application-error catchability, poisoning,
  close/drain, and disposal.

`FAC02` therefore accepts one generic, frozen, positive-capability point-reader
facade under the existing private Function API Core. Its whole contract is
`get(documentId) -> Promise<document | null>`. The constructor captures one
supplied read function and delegates directly: it does not insert a promise
turn, catch or translate errors, inspect identifiers or documents, or acquire
host capabilities. This preserves each adapter's existing synchronous
validation and closed-boundary behavior as well as its asynchronous failure
identity and ordering.

The selected query profile will expose only `get`; it will no longer advertise
throwing write, scan, normalization, or empty system placeholders. The selected
mutation profile will compose the shared reader with its existing journal-owned
`insert`, `patch`, `replace`, and `delete` methods, and will no longer advertise
unimplemented scan, normalization, or system members. Capability absence is
represented by member absence, matching the positive-capability rule already
accepted by this roadmap. This is a private runtime contract correction for the
selected profiles, not a public developer API or a claim that full Convex query
or system database surfaces exist.

Rejected in this slice are a universal database port, a facade that receives
tables or transaction state, promise normalization in the shared constructor,
error translation in the shared constructor, mutation-writer extraction,
query-builder or `normalizeId` work, original-profile rewrites, and any new
syscall, protocol, persistence, routing, activation, or production authority.

The implementation gate requires focused facade tests for exact keys, freezing,
argument forwarding, promise identity, and synchronous-throw preservation;
selected query and mutation Workerd proofs for exact context capabilities and
unchanged close/drain and journal ordering; deterministic regeneration of the
shared support module and both selected Worker cores; derived graph-basis and
candidate-target identity proofs; SAP05 and SAP06-A3 PGlite and genuine
PostgreSQL regressions; affected typechecks and Effect-boundary checks; and both
mandatory exact-final reviewers. The commit must remove the selected profiles'
duplicated point-reader object construction and unsupported database members in
the same slice, with no old/new fallback.

### `FAC02` Implementation Receipt

**Completed:** 2026-08-06

The private Function API Core now owns
`createFunctionRuntimePointReaderV1`. It constructs one exact frozen `{ get }`
facade and delegates directly to the invocation adapter without introducing a
promise turn or failure mapping. The selected query Worker supplies its existing
snapshot/read-boundary adapter. The selected mutation Worker supplies its
existing journal-backed adapter and composes that reader with the unchanged
writer methods. The selected query database no longer contains write, scan,
normalization, or system placeholders; the selected mutation database no longer
contains scan, normalization, or system placeholders.

The deterministic generated closure is:

- shared Function API Core SHA-256
  `e5c52cf21f6ee4e576b240d014aca40d0172ef108fb25ec649f53313082af986`;
- selected query-internal-call runtime-kernel SHA-256
  `5b2eb183302adbdcbaae4b263687d9d456b8348f183fe5daaff41c11e6ab5373`;
- selected query-internal-call Worker-core SHA-256
  `4cd6846af0a53951d38e624a6bb04c2daa3b74f264011a138a78cc8d2de83dd5`;
- selected mutation-internal-call runtime-kernel SHA-256
  `ee99614520496543277b38eaf0077426158606dd9bd67f87742ec6ea4d3dccad`;
  and
- selected mutation-internal-call Worker-core SHA-256
  `bae25a31640465943c7c2042803cd964bd3f6a2b8d55fc701d39813da94653f9`.

Validation passed for all 48 `@flarex/function-runtime` tests and its
typecheck; the complete backend generated-source build and typecheck; focused
generated-identity plus selected query and mutation Workerd suites (7 tests);
`check:effect-boundaries`; SAP05 and SAP06-A3 PGlite acceptance; and SAP05 and
SAP06-A3 genuine PostgreSQL acceptance (2 tests each) on separate databases in
one fresh isolated PostgreSQL 18 cluster. The generated checks failed closed on
the initially stale selected kernel receipts, after which both kernels were
explicitly regenerated and the complete backend build passed. The exact-final
TypeScript/Effect and code-quality reviewers reported no findings; the latter
also independently recomputed all five generated SHA-256 receipts.

No analyzer operation, public protocol/profile/syscall ABI version,
persistence schema, query snapshot owner, mutation journal operation order,
read-your-writes behavior, OCC/commit owner, action uncertainty, activation,
route, or production behavior changed. There is no fallback, dual facade, or
second read authority.

### `FAC03` Point-Writer Preflight Decision

**Accepted:** 2026-08-06

Current Convex `database_impl.ts` constructs `setupWriter()` by reusing the
shared reader and adding `insert`, `patch`, `replace`, and `delete` wrappers.
That composition is the useful model for Flarex. Convex's concrete wrappers are
`async`, support its full reader/table overload surface, validate through the
Convex value codec, and delegate to its global async-syscall bridge. Those
details are not portable authority and must not be copied into Flarex.

The selected Flarex mutation Worker currently has observable call-time policy
that predates this extraction:

- `insert` captures and bounds fields before validating the projected table
  name;
- `patch` validates the document ID/table projection before capturing the
  patch;
- `replace` validates the document ID/table projection before capturing and
  bounding replacement fields;
- `delete` validates only the document ID/table projection;
- every successful capture enters the existing strictly sequenced journal,
  receives its syscall sequence there, and returns the exact tracked promise;
  and
- application document-validation failures remain catchable without poisoning
  the journal, while every other admitted journal failure keeps the existing
  first-failure and poisoning behavior.

`FAC03` accepts one generic private point-database-writer constructor in the
existing Function API Core. It receives the already constructed point reader
plus four exact invocation-local write functions and returns one frozen object
with keys `get`, `insert`, `patch`, `replace`, and `delete` in that order. Each
method is a non-`async` direct delegate. The constructor captures the supplied
function references once, adds no promise turn, catch, validation, cloning,
normalization, retry, or authority lookup, and returns each supplied promise by
identity. This preserves synchronous throw timing as well as asynchronous
journal failure identity.

The selected mutation Worker remains the sole owner of field/patch capture,
table and ID validation, promise tracking, table-capability resolution,
operation serialization, syscall sequencing, outcome decoding, application
failure catchability, poisoning, close/drain, and RPC disposal. The shared core
does not receive tables, a journal capability, transaction state, PostgreSQL,
R2, Workerd bindings, or commit authority. The original mutation profile and
the mutation kernel's temporary read-only internal-query projection remain
unchanged; exact query/mutation context-profile composition is the next
separate slice.

Rejected in this slice are `async` facade wrappers, capture or validation moves
into the shared core, generic operation envelopes, a universal optional
database, Convex table overloads, scans, `normalizeId`, system tables,
query-builder work, internal-call composition changes, original-profile
rewrites, and any protocol, schema, persistence, OCC, commit, activation,
routing, action, or production change.

The implementation gate requires focused core tests for exact keys, freezing,
argument order, promise identity, and synchronous-throw preservation for all
four writes; selected mutation Workerd proof that all writer methods traverse
one ordered journal while the final nested read observes the same overlay;
deterministic regeneration of the shared support module, selected mutation
runtime kernel, and selected mutation Worker core; derived query and mutation
graph/target identity proof because both graphs commit the shared support
module; SAP05 and SAP06-A3 PGlite and genuine PostgreSQL regressions; affected
typechecks, the complete backend generated build, Effect-boundary checks, and
both mandatory exact-final reviewers. The commit must remove the selected
Worker's duplicate writer-object construction with no fallback or dual facade.

### `FAC03` Implementation Receipt

**Completed:** 2026-08-06

`FAC03` adds the private, generic
`createFunctionRuntimePointDatabaseWriterV1` constructor to Function API Core
and makes the selected mutation/internal-call Worker its first consumer. The
constructor composes the existing point reader with four named invocation-local
writer ports and returns the exact frozen `get` / `insert` / `patch` /
`replace` / `delete` facade. It captures each port once and delegates directly,
so call-time validation order, synchronous throws, exact promise identity, and
the existing journal's admission and failure semantics remain owned by the
Worker.

Focused core tests prove exact keys and freezing, reader identity, writer
argument forwarding, one-time port capture, promise identity, and synchronous
throw timing for all four methods. The selected Workerd scenario proves all
four writes traverse one ordered journal, a rejected write does not consume a
sequence, and a later nested read observes the journal overlay. The generated
closure was refreshed and verified at Function API Core
`518a0a15f48fe9543db21eb5844f58d78c4f5f881dbb9c7fcb3f8daec9136bcd`,
mutation/internal-call runtime kernel
`1a945b0b8f60e0ccf303de765c278546c7cbd58aa75759de7f6099b750d14c46`,
and mutation/internal-call Worker core
`31475266069092f31d3bc28439773dff3ff9308bcab0cc0ebd4a4f4d6a7fd8c6`.

Validation passed with all 50 `@flarex/function-runtime` tests and its
typecheck; the complete `flarex-backend` generated build and typecheck; seven
focused generated/Workerd tests; SAP05 and SAP06-A3 under PGlite; both suites
against a fresh isolated PostgreSQL 18 cluster; and the workspace Effect
runtime-boundary check. Both mandatory exact-final reviewers reported no
actionable findings; they independently verified facade/runtime/generated
agreement, direct-delegation timing and identity, journal/read-your-writes
preservation, and the absence of authority drift. No schema, persistence,
snapshot, journal, OCC, commit,
action uncertainty, activation, route, or production authority changed, and
there is no fallback or parallel writer facade.

### `FAC04` Exact Context-Profile Preflight Decision

**Accepted:** 2026-08-06

Current Convex `registration_impl.ts` constructs distinct positive-capability
contexts. A query receives its reader plus `runQuery`; a mutation receives its
writer plus `runQuery` and `runMutation`. `database_impl.ts` likewise composes
the writer from the reader rather than presenting a universal database with
throwing members. Storage, scheduler, metadata, full table readers, overloads,
and the global syscall bridge are Convex-owned surfaces and are not authority
for this Flarex slice.

The selected Flarex query/internal-call kernel currently adds `runQuery` by
spreading a host-created base context. The selected mutation/internal-call
kernel does the same for `runQuery` and `runMutation`, but it also projects an
internal query through a mutation-shaped database whose write methods throw and
keeps a throwing `runMutation` member on that query context. That representation
is inconsistent with the positive-capability decision above even though its
terminal failure behavior is deliberate.

`FAC04` directly replaces the private base-context constructors with exact
query- and mutation-context constructors in Function API Core:

- the query constructor returns only `auth`, the supplied reader, and the
  supplied `runQuery` function;
- the mutation constructor returns only `auth`, the supplied writer,
  `runQuery`, and `runMutation`;
- each result is a fresh frozen invocation-owned record, while auth, database,
  and call-function identities are preserved exactly; and
- no constructor catches, awaits, validates, normalizes, retries, or acquires
  authority.

The selected invocation factories expose context-creation callbacks backed by
that shared support module. Their kernels continue to own parent ordinals,
catalog lookup, call/depth/byte budgets, cycle detection, pending-call
settlement, handler invocation, and application-versus-terminal failure
classification. The query kernel creates only query contexts. The mutation
kernel creates a mutation context for the root and internal mutations, and an
exact query context with the journal's already-created point reader for
internal queries. The mutation journal remains the only reader/writer and
read-your-writes owner.

The temporary private `flarex:platform` ABI still needs its old terminal
behavior until normal `ctx.*` analyzer lowering replaces every direct platform
import. During that compatibility window, the mutation kernel may bind a
separate private platform projection containing the existing throwing write and
query-to-mutation guards while passing the exact positive-capability context to
the user handler. This is not a second developer facade: it is scoped only to
the already-reserved private platform module, shares the same auth/database/call
functions, and remains covered by the existing removal gate. A forbidden
private-platform call must still record the terminal failure before throwing so
user code cannot make it non-terminal by catching it.

Rejected in this slice are a universal or optional context, throwing members on
the handler's query context, an inlined second Function API Core inside runtime
kernels, moving registry/call-budget/pending-call policy into the shared core,
changing application-error data capture, normal `ctx.*` analyzer lowering,
removing `flarex:platform`, extending database features, and any protocol,
schema, snapshot, journal, OCC, commit, action, activation, routing, or
production change. Shared application-error capture mechanics remain the next
bounded core slice after exact context profiles.

The implementation gate requires core tests for exact key order, runtime
freezing, fresh allocation, identity preservation, and query/mutation member
absence; function-runtime nested-call tests proving exact child query versus
mutation profiles and unchanged uncatchable terminal guards; selected Workerd
proof for the same direct-ctx and private-platform behavior; deterministic
refresh of the support module, both selected kernels, and both selected Worker
cores; graph-basis and derived target identity proof; SAP05 and SAP06-A3 under
PGlite and genuine PostgreSQL; affected typechecks, the complete backend
generated build, Effect-boundary checks, both mandatory exact-final reviewers,
and one commit with no old base-context API or fallback left behind.

### `FAC04` Implementation Receipt

**Completed:** 2026-08-06

Function API Core now owns the exact frozen query and mutation context
constructors. The selected query/internal-call factory supplies the shared query
constructor with its existing point reader and per-parent `runQuery`. The
selected mutation/internal-call factory supplies an exact point reader for
child queries and its existing journal-backed writer for root and child
mutations. The kernel retains call policy, and its separate private platform
projection retains the already-owned terminal write and query-to-mutation
guards without exposing those negative capabilities on a handler context.

The deterministic generated closure is:

- Function API Core
  `2e2a5157a1787023079e9863a4838b75f92501ef66f49dcf6635c70a5ef99ab6`;
- point-query internal-call kernel
  `787d5db3c71add5078eac6bd7a2003038ed6eb000d2c65806fcc82221f9c3032`;
- point-query internal-call Worker core
  `7a19f31a36c5186cd7e06876a3a1a5993e7c9195388cd2e605e66d732e2e7880`;
- point-mutation internal-call kernel
  `7f84ed314e7134dda1c41891dfd08cea08481bf37e6e19d1bb897e86092f668c`;
  and
- point-mutation internal-call Worker core
  `6dd45642a548247de1559b36e3f75336b63df9ac691066a19a36cf4d2dbe9286`.

Validation passed the complete 50-test function-runtime suite, the focused
23-test core and selected-kernel suite, the focused generated/graph-basis and
Workerd suite (8 tests), both affected package typechecks through the complete
backend generated build, and the workspace Effect-boundary check. SAP05 and
SAP06-A3 each passed under PGlite and against a fresh PostgreSQL 18 cluster;
the PostgreSQL lanes covered two tests each. The changed operations are pure,
lifecycle-free per-invocation context construction and existing Promise-shaped
handler calls, so no new Effect service, Layer, resource, retry, or error
channel is applicable. No schema, persistence, snapshot, journal, OCC, commit,
action, activation, route, or production authority changed, and no old
base-context API or fallback remains.

Both mandatory exact-final reviewers reported no actionable findings. The
TypeScript review first identified one bounded type-only loss of correlation
between a resolved function's query/mutation marker and its handler context.
The final kernel now uses literal-kind overloads plus a discriminated internal
handler, was regenerated and fully revalidated, and both reviewers accepted the
exact final staged diff. The code-quality review confirmed the positive
capability profiles, private terminal poisoning, journal ordering,
read-your-writes behavior, and generated identities remain intact.

### `FAC05` Shared Declared-Application-Error Preflight Decision

**Accepted:** 2026-08-06

Current Convex defines public `ConvexError<TData>` with one application-owned
`data` value, identifies it through a `Symbol.for("ConvexError")` property, and
serializes its data at the function invocation boundary. Flarex must not copy
that public representation in this slice. Declarative V2 already assigns safe
operation 18 and its throw/catch rules to
`CoreApplicationErrorV1(code, message, data?)`; changing that shape, name,
marker, or analyzer operation would be a separately versioned authoring and
protocol decision. A public symbol marker would also weaken the current exact
Worker trust model by making declared-error identity forgeable by application
code.

The useful Convex alignment is architectural: one runtime owner constructs and
recognizes the declared application error, while capability-specific invocation
code merely propagates it. Today the mutation/internal-query and
mutation/internal-call kernels duplicate the same code/message capture, data
normalization handoff, frozen capture record, native `Error` construction,
name projection, closure-owned `WeakMap`, inspection, and accessor mechanics.
Their generated private `flarex:platform` modules repeat the same implementation
again under profile-specific function names.

`FAC05` moves those exact shared mechanics into one exact-Worker-scoped registry
factory in Function API Core. The factory:

- captures code, then message, then optional data in that exact order;
- preserves the nonempty and 1,024-UTF-8-byte text rules and their diagnostic;
- delegates data normalization to the selected profile's existing canonical
  runtime-value normalizer without catching or translating its failure;
- omits `data` when the supplied value is `undefined`, otherwise preserves the
  normalizer's returned canonical value by identity in a frozen capture record;
- creates the same mutable native `Error` with message and non-enumerable fixed
  name `CoreApplicationErrorV1`;
- recognizes only errors created by that registry through a closure-owned
  `WeakMap`, so a matching name or user-created property cannot forge
  catchability; and
- delegates invalid construction/access to the profile's existing
  `ApplicationV1Error("argumentsInvalid", detail?)` constructor so profile
  failure identity and outer runtime classification remain unchanged.

The two profile kernels retain only their canonical data-normalization adapter
and their distinct application, terminal, contract, user-code, journal, call-
budget, snapshot, and journal semantics. Their private platform modules become
thin named adapters over the shared registry. The mutation/internal-query exact
graph deliberately gains the already-versioned `flarex:function-api-core/v1`
support module; the mutation/internal-call graph already carries it. Both graph
consumers of the registry refresh deliberately. Because the
point-query/internal-call graph
also commits Function API Core, all three graph bases and derived candidate
runtime targets refresh with the new shared-core identity even though only the
two mutation profiles consume the registry in this slice.

There is no process-global registry: each exact Worker module evaluation owns
one registry, and separate Workers/profiles cannot recognize one another's
errors.

Rejected are replacing `CoreApplicationErrorV1` with public `ConvexError`, a
global symbol or structural marker, changing code/message/data or analyzer
operations, exporting a developer-facing error API, treating ordinary
argument/result validation failures as declared errors, sharing the profile
error classes, making arbitrary thrown values catchable, moving nested-call or
terminal classification into the registry, swallowing data-normalization
defects, or changing a snapshot, journal, persistence, OCC, commit, action,
activation, route, or production owner. The temporary private platform ABI and
its removal gate remain unchanged.

The implementation gate requires Function API Core tests for capture order,
byte bounds, omitted versus present data, frozen capture ownership, native
error shape, registry isolation, spoof rejection, invalid access, and preserved
normalizer failures; removal of both full profile-local capture implementations;
the internal-query graph's support-module identity plus both refreshed graph
bases and derived targets; existing application catch/rethrow evidence in both
Workerd profiles; deterministic refresh of Function API Core and both runtime
kernels; full function-runtime and backend generated builds; SAP06-A2 and
SAP06-A3 under PGlite and genuine PostgreSQL; Effect-boundary checks; both
mandatory exact-final reviewers; and one commit.

### `FAC05` Implementation Receipt

**Completed:** 2026-08-06

Function API Core now owns one exact-Worker-scoped declared-application-error
registry factory. It preserves code-before-message-before-data capture,
the 1,024-UTF-8-byte text bounds and diagnostics, omitted `data`, canonical
runtime-value identity, the mutable native `Error` projection, and
closure-owned unforgeable recognition. The two selected mutation profiles now
retain only their existing canonical data normalizers and typed invalid-input
adapters; their generated private platform modules are thin profile-named
projections over the shared registry. The mutation/internal-query graph now
commits the already-versioned Function API Core support module it imports.

The deterministic generated closure is:

- Function API Core
  `dfa95f0396509503cf238268c8b4c79c3f41364acf3218bd9de699c07db03666`;
- point-mutation internal-query kernel
  `fdb0fa34336b5491424b6538ae283f8c34d5368628cadedd80d9264b41271ccc`;
  and
- point-mutation internal-call kernel
  `7b8fddf09d35d246ab6a62f6353ae6617dc0c2f92f63510a7219c1ab16776621`.

Validation passed both affected package typechecks, all 53 function-runtime
tests, the focused generated-identity and both Workerd suites (10 tests), the
complete backend generated build, and the workspace Effect-boundary check.
SAP06-A2 and SAP06-A3 passed under PGlite and against a fresh PostgreSQL 18
cluster; the PostgreSQL lanes covered two tests each. The changed operation is
a pure synchronous private registry with no resource lifetime, cancellation,
retry, recovery, or asynchronous failure channel, so an Effect service, Layer,
or Effect error channel is not applicable. Profile-owned normalizer failures
and typed `ApplicationV1Error` construction remain at their existing
boundaries.

No analyzer operation, public developer API, protocol identity, schema,
persistence, snapshot, journal, OCC, commit, action, activation, route, or
production authority changed. No global or structural marker, alternate
acceptance path, or duplicate full profile-local capture implementation
remains.

Both mandatory exact-final reviewers accepted the implementation and generated
closure. The TypeScript/Effect reviewer reported no actionable findings and
confirmed that the synchronous Worker-scoped factory is the correct lifecycle
and immediate-throw boundary. The code-quality reviewer found no behavioral or
trust-boundary defect and identified one documentation-only mismatch: status
still named `FAC05` as current and described only two refreshed graph
identities. This final receipt and status now distinguish the two registry
consumers from all three shared-core graph commitments.

### Sequenced Follow-On Slices

After `FAC01`, continue one coherent commit at a time:

1. shared point-reader facade over the query read port, then shared
   journal-backed reader/writer facade mechanics where exact operation ordering
   can be preserved;
2. shared internal query/mutation context composition and application-error
   mechanics without changing their distinct snapshot/journal contracts;
3. normal `ctx.*` analyzer lowering and migration of internal simulation source,
   then deletion of the synthetic platform implementation where no direct
   source import remains;
4. edge-action alignment over its callback port without adding direct database
   authority; and
5. developer and internal-test API integration as sibling authoring producers,
   with the real end-to-end test lane continuing through analyzer, R2, Workerd,
   executor, and PostgreSQL.

Each slice must update this roadmap from current evidence. Ordinary extraction
decisions within these settled boundaries are pre-approved; a slice must still
stop if evidence requires a public/protocol version, persistence migration,
new transaction or trust owner, activation/routing behavior, or a change to
action uncertainty.

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

## Initial Extraction Preflight Requirements (Completed)

The following requirements governed the original exact point-mutation
extraction and are retained as historical constraints. That preflight and
extraction are complete. The later cross-profile centralization preflight and
its current implementation sequence are recorded in the accepted decision
above.

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

## Initial Preflight Exit Criteria (Completed)

The original extraction began only after its preflight had:

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

The accepted extraction amendment satisfied these items. They remain useful
regression constraints, not a second pending gate for `FAC01`.

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

The centralized Function API Core preflight and `FAC01` implementation receipt
above are complete. The next gate is a fresh bounded preflight for the first
follow-on: a shared point-reader facade over the existing query point-read port.
That preflight must prove the exact portable reader contract shared by the
selected query and journal-backed mutation consumers, preserve their different
snapshot and journal ownership, and reject any facade shape that widens
database authority or changes operation order. The reader implementation, if
the gate closes, remains one separate committed slice; mutation writer and
internal-call composition stay later slices.

The public `flarex-test` real-runtime contract remains unchanged. Internal
simulation APIs may adopt shared authoring primitives and normal `ctx.*`
handlers, but their end-to-end lane must continue through the actual analyzer,
R2 materialization, Workerd runtime, executor, and Postgres owners. A faster
in-process semantic lane is complementary evidence and must be named as such.

### Superseded Post-Extraction Decision Context

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
