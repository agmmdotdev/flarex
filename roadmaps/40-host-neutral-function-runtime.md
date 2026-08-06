# Host-Neutral Function Runtime

## Status And Scope

**Status:** Preflight and the first-extraction amendment are accepted. The
prerequisite journal-boundary correction, canonical declarative-program first
vertical, and host-neutral exact public point-mutation extraction are
implemented and validated. Later private point-query, internal-call, and edge-
action verticals proved additional concrete consumers. The centralized
Function API Core direction and focused preflight recorded below are accepted,
and `FAC01` through `FAC09` are implemented and validated. `FAC09` removed the
private auth, database, and nested-call authoring shims in favor of the normal
Convex-style handler `ctx`; only the separately owned application-error
registry remains a host-private mutation-runtime module while its developer-
facing replacement is still unapproved. Production routing remains deferred.

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

The checked-in generated modules and Git history own the exact closure
identities. This living roadmap records their authority and regeneration gate,
not a digest receipt that becomes stale after the next accepted core change.

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

### `FAC06` Direct Context Point-Access Preflight Decision

**Accepted:** 2026-08-06

Current Convex application source calls shared query and mutation context
facades directly: `ctx.db.get(...)` and `ctx.db.insert(...)` are ordinary
member calls on the context constructed by `registration_impl.ts`, while the
database facade delegates through the installed isolate syscall bridge. Convex
does not require application code to import an internal syscall module. Flarex
already has the corresponding shared context/database facades and passes them
to exact Workerd handlers, but its analyzer currently rejects every member
access as `CORE_COMPUTED_DISPATCH`; simulations therefore still import the
private `flarex:platform` ABI even when the runtime executes the same `ctx`
object.

`FAC06` accepts the first exact query-plus-mutation authoring pair without a
source rewrite or a new runtime operation:

- a direct call on the handler's simple first-parameter binding of the exact
  form `<context>.db.get(...)` lowers to existing ABI operation 23,
  `databaseGet`;
- the corresponding exact `<context>.db.insert(...)` call lowers to existing
  ABI operation 37, `databaseInsert`;
- the first parameter's spelling is not authority and need not be `ctx`, but
  it must be one plain identifier and may not have another same-spelled binding
  anywhere in that function's conservatively analyzed scope;
- that identifier remains a dedicated context binding: every body occurrence
  must be the root of an exact admitted context-member call. Reassignment,
  update, passing, returning, capture, aliasing, and catch or local rebinding
  invalidate context lowering for the function rather than authenticating
  authority by spelling alone;
- registration treats that binding as context only on the selected root
  handler, because only that function is invoked by the runtime with the
  Function API context. A reachable local or imported helper that merely has a
  similarly shaped first parameter is rejected at `handlerCapability` if it
  contains a context-lowered call; helpers must receive narrower explicit
  values until a separately proven flow-sensitive interprocedural design
  exists;
- both dots and the final call must be the direct static token sequence;
  optional chaining, computed access, aliases, destructuring, detached methods,
  parenthesized call targets, longer receiver chains, dynamic property names,
  and user-defined lookalikes remain rejected; and
- import-call evidence retains the authored terminal member name, while the
  value-flow record, capability, catchability, and registration authority use
  the unchanged canonical ABI operation.

The analyzer does not transform application bytes. The exact Worker invokes
the original function with the shared frozen context, so `ctx.db.get` and
`ctx.db.insert` execute the same Function API Core facades already proven by
`FAC02` through `FAC04`. The lowering is analysis evidence: it proves that the
member call consumes an admitted safe operation. This deliberately avoids
generating a second application module, changing R2 body ownership, or making
the private platform module a developer API.

The preflight also found a fail-closed registration gap. The accepted
Declarative V2 capability matrix distinguishes auth, database read, database
write, `runQuery`, and `runMutation` by declared function kind, but completed
handler lookup currently reports only `usesRunMutation`; registration
therefore enforces only that one query restriction. `FAC06` replaces that
single flag with the complete existing matrix projection, accumulated across
the reachable local/imported helper graph, and rejects any unavailable
capability at `handlerCapability`. This introduces no capability or new
function kind. It makes the already-versioned matrix authoritative for both
legacy private imports and the new context spelling. Application-error and
pure-data operations remain universally available as before.

The executable analyzer contract gains an explicit two-row context-member
lowering catalog, so its generated contract hash, asset hash, and manifest
identity refresh rather than changing accepted syntax behind an old identity.
The base ABI operation IDs, evidence codecs, progress/receipt protocols,
analyzer release owner, registration rows, persistence schemas, and runtime
target/profile identities do not change. The temporary platform import stays
accepted for unmigrated internal evidence, and the synthetic Workerd module is
not deleted: exact Worker cores still use its private binder/error adapter and
other analyzer fixtures still import its ABI. There is no dual runtime path;
both source spellings produce the same ABI evidence and use the same runtime
facades.

This slice migrates the shared create/read simulation source plus the cooking
and English-learning create/get application files to normal context calls.
Other database methods, auth, queries, internal calls, error construction, and
edge actions receive later bounded lowerings after this lexical, capability,
and real-system pair is proven. In particular, `FAC06` does not yet authorize
the newer Convex table-plus-id overload, query-builder chains, public developer
SDK generation, removal of `flarex:platform`, or any snapshot, journal, OCC,
commit, action uncertainty, activation, routing, or production change.

The implementation gate requires contract-vector tests for exact lowering,
arbitrary first-parameter spelling, byte/chunk determinism, operation order,
legacy-import parity, shadowing and every rejected indirect form; transitive
registration tests for query write refusal and mutation acceptance plus action
database refusal under the complete matrix; deterministic executable-analyzer
regeneration; the shared simulation API and cooking/English-learning real
Workerd paths under PGlite and genuine PostgreSQL; full affected analyzer,
system-test, generated-identity, and Effect-boundary validation; both mandatory
exact-final reviewers; removal of superseded simulation imports; and one
commit.

### `FAC06` Implementation Receipt

**Completed:** 2026-08-06

The executable analyzer contract now owns two exact context-member lowerings:
root-handler `<context>.db.get(...)` maps to existing `databaseGet`, and
`<context>.db.insert(...)` maps to existing `databaseInsert`. The original
application bytes execute unchanged in Workerd against the Function API Core
query and mutation contexts. Import-call evidence retains the authored member
name while value-flow evidence retains the canonical ABI operation,
capability, and catchability.

The analyzer admits a lowering only when every use of the handler's simple
first-parameter binding is one of the exact direct context calls. Restart
reconstruction rejoins the authored member and canonical operation only through
the executable contract's explicit lowering catalog, associates calls and
value flows by their ordered stable function ordinals, and fails closed rather
than substituting a zero index. Completed handler lookup distinguishes the
authored member from the canonical private ABI name and accepts that context
origin only on the selected root handler, preventing a reachable helper's
ordinary first argument from acquiring context authority.
The same lookup now accumulates auth, database-read, database-write,
`runQuery`, and `runMutation` across the entire reachable graph. Registration
applies the existing function-kind capability matrix to both normal context
syntax and retained private ABI imports. `ST-CORE-010` is resolved without a
new capability, ABI ID, evidence codec, persistence field, or runtime path.

The executable generated closure refreshed deterministically:

- executable contract SHA-256
  `e174e8df1dbf18c77b7790286097f3bd919756c7643d58f60f239257505cc949`;
- executable asset SHA-256
  `bca3781ea604438377bf61a2308d475ff413583d7d5ff189c9d15cf3b59802d1`;
- executable manifest identity
  `67598823f1709ecd13318a7d1d29cd5f1aad742b12f6711a275831e4ae3e860c`;
  and
- unchanged base verifier asset SHA-256
  `00eb1d44298eac350d1e4dcac1d14896b13b8e0d841c8c01108c8a60fca8fc39`.

Exact lowering, arbitrary context spelling, private-ABI authority parity,
every-byte split determinism, indirect-form refusal, query-write refusal,
context reassignment and catch-shadow refusal, mutation-write acceptance,
action-database refusal, legacy-import enforcement, warm/cold reconstruction,
and reachable-helper refusal passed. The full analysis lane passed 20 files and
446 tests. The complete system-test PGlite lane passed 21 files and 51 tests,
including the two migrated cooking and English-learning simulation tests.
Those same cooking and English-learning paths passed four tests
against a fresh PostgreSQL 18 database. Analyzer typecheck, system-test
typecheck, all three generated checks, and the workspace Effect-boundary check
passed.

The changed analyzer and registration operations are pure, synchronous,
incremental state machines with an existing `Result` failure boundary. They
introduce no asynchronous resource lifecycle, retry, cancellation, dependency
service, or recovery policy, so an Effect service, Layer, or Effect error
channel is not applicable. Registration continues to translate analyzer
failure into its existing typed terminal result.

Both mandatory exact-final reviewers accepted the staged implementation with no
actionable findings. The code-quality reviewer initially challenged a possible
`flarex:platform` import-alias collision, then withdrew the finding after the
executable analyzer reproduced the existing fail-closed `CORE_SYNTAX`,
`CORE_REEXPORT`, and `CORE_CALL_TARGET` rejection: import aliases are not an
accepted compatibility path. No implementation change was required. No
snapshot, journal, OCC, commit, change-feed, outbox, action uncertainty,
readiness, activation, routing, or production owner changed. The synthetic
private platform module remains only for unmigrated operations and runtime-owned
binder and error-adapter mechanics; this slice adds no fallback or dual runtime.

### `FAC07` Direct Context Point-Writer Completion Preflight Decision

**Accepted:** 2026-08-06

Current Convex `GenericDatabaseWriter` exposes `ctx.db.patch`, `replace`, and
`delete` in both id-only and newer table-plus-id forms. Its implementation maps
those operations to shallow-merge, replacement, and removal syscalls. Flarex
already owns the corresponding semantics end to end: ABI operations 38 through
40, the centralized `@flarex/function-runtime` mutation database facade, exact
runtime document capture and validation, ordered journal operations, OCC and
commit execution, change-feed publication, and outbox behavior. The cooking
simulation still imports those three private ABI functions only because the
executable analyzer did not yet recognize their ordinary context spelling.

`FAC07` therefore completes the existing id-only point-writer authoring surface
without adding a runtime operation or changing a transaction owner:

- exact root-handler `<context>.db.patch(id, value)` lowers to
  `databasePatch`;
- exact root-handler `<context>.db.replace(id, value)` lowers to
  `databaseReplace`; and
- exact root-handler `<context>.db.delete(id)` lowers to `databaseDelete`.

The original source continues to execute unchanged in Workerd against the
central Function API Core context. The `FAC06` simple-first-parameter,
direct-lexical-use, stable function-ordinal, complete capability-matrix, and
root-only authority rules remain the sole admission model. A reachable helper
does not gain context authority merely because its first argument is named
`ctx`, and query or action registration cannot admit the database-write
capability.

The preflight found one fail-closed correction required before adding these
members. JavaScript ignores surplus call arguments, while current Convex admits
table-plus-id writer overloads that the Flarex facade does not implement. A
three-argument `ctx.db.patch("recipes", id, value)` must not lower and then be
misread as the id-only `(id, value)` call. The versioned context-lowering
catalog will therefore own exact argument counts for all five admitted point
members, including the existing `get` and `insert` entries. The analyzer counts
top-level arguments while respecting nested parentheses, arrays, objects, and
trailing commas; a different count remains an ordinary rejected source shape.
This is a grammar admission guard, not a new public type or ABI version.

The canonical grammar also currently classifies `delete` only as a unary
keyword, although ECMAScript permits it as an `IdentifierName` after `.`. The
smallest correction adds the exact `PostfixExpression . delete` production.
That makes `ctx.db.delete(...)` syntactically representable but grants no
general member authority: the existing semantic validator still rejects every
non-catalog or indirect dot access as `CORE_COMPUTED_DISPATCH`.

This slice does not authorize the current Convex table-plus-id overloads,
`db.table(...)`, query-builder chains, auth or nested-call lowering, helper
context forwarding, public developer SDK generation, removal of the private
platform module, or any snapshot, journal, OCC, commit, action uncertainty,
activation, routing, or production change. Supporting a second table spelling
would first require a separate facade and table-identity preflight rather than
relying on JavaScript argument permissiveness.

The implementation gate requires exact lowering and private-ABI parity vectors
for all three operations; one-, two-, nested-, and trailing-comma arity proof;
explicit table-overload and surplus-argument refusal; mutation acceptance plus
query, action, and reachable-helper refusal; deterministic generated-executable
refresh; migration of every cooking point-writer source import; real cooking
definition, analyzer, registration, Workerd, PostgreSQL application-row,
result, commit-feed, and outbox proof under PGlite and genuine PostgreSQL; full
affected validation; both mandatory exact-final reviewers; and one commit.

### `FAC07` Implementation Receipt

**Completed:** 2026-08-06

The executable contract now owns five exact, arity-bearing context lowerings.
The three new entries map root-handler `ctx.db.patch`, `replace`, and `delete`
to existing ABI operations 38, 39, and 40. The original application source is
not rewritten: Workerd executes it against the centralized Function API Core
mutation database, which continues to delegate into the existing validation,
journal, OCC, and commit owners. Direct-call restart evidence retains authored
member names while value-flow evidence retains the canonical ABI operations.

The context call scanner now counts top-level arguments without flattening
nested calls, arrays, objects, or template substitutions, and admits trailing
commas without counting an empty extra argument. Commas inside `${...}` remain
inside their template argument, including across every source-byte split.
Top-level spread is refused because it does not have a statically exact runtime
arity; nested array and object spread remains part of one argument. Every
admitted point member therefore has an exact authored arity. Missing/surplus
arguments and the unsupported current Convex table-plus-id writer overloads
remain rejected source shapes. The canonical grammar gained only
`PostfixExpression . delete`; an explicit non-context `value.delete(id)` vector
proves that the semantic member-authority guard still rejects the newly
parseable shape.

Every cooking patch, replacement, deletion, rollback, and internal-publication
write now uses `ctx.db` directly. The real Standard definition, analyzer,
inactive registration, immutable revision selection, Workerd runtime, existing
executor/C07 commit path, PostgreSQL application rows, result, commit feed, and
outbox remain the execution path. No compatibility wrapper, source transform,
fallback, or parallel database implementation was added.

The executable closure refreshed deterministically:

- executable contract SHA-256
  `b8b9de47e91f601edad25900227a3b6d5ee7742fffd045957c2c7361abb92c22`;
- executable asset SHA-256
  `a9a724e34a064f2c4d6db9e8b09eeb6b15c2b76eda41543a870464bea0ba975d`;
- executable asset size `4,858,776` bytes;
- executable manifest identity
  `5cdac93e8996093752882860d6618e897a4704062a36a0488b6a432a721bcf45`;
  and
- unchanged base verifier asset SHA-256
  `00eb1d44298eac350d1e4dcac1d14896b13b8e0d841c8c01108c8a60fca8fc39`.

Exact lowering, nested/trailing/template argument counting, top-level-spread
and unsupported-overload refusal, private-ABI parity, non-context `.delete`
refusal, restart operation identity, query-write refusal, mutation acceptance,
and the inherited action and reachable-helper gates passed. Analysis typecheck
passed. The isolated full analysis lane passed 470 of 471 tests; its sole miss
was a pre-existing evidence byte-split test exceeding its fixed five-second
timeout, and that exact test passed in 3.68 seconds with a 30-second focused
allowance. All five timeout-only tests from an earlier contended run also passed
serially (89/89). System-test typecheck and the complete PGlite lane passed 21
files and 51 tests. The focused cooking lane passed one PGlite test and two
tests against PostgreSQL 18.3, including the full six-commit point lifecycle and
failure rollback proof. All three generated checks and the workspace
Effect-boundary check passed.

The changed analyzer helpers are pure incremental token/state operations and
registration continues to use its existing typed `Result` boundary. No async
resource, cancellation, retry, service, Layer, or new failure translation was
introduced, so an additional Effect abstraction is not applicable. Initial
mandatory review found two bounded exact-arity defects: template-substitution
commas were treated as argument separators, and top-level spread could bypass
static arity. Both were corrected with focused and every-byte-split regressions;
both mandatory final re-reviews accepted the corrected exact staged snapshot
with no actionable findings. The TypeScript/Effect reviewer assessed 15
materially changed operations, recommended no Effect transformation, and
confirmed that these pure incremental scanner operations do not require a
service or Layer. The code-quality reviewer confirmed nested-template tracking,
top-level-spread refusal, nested-spread preservation, and unchanged runtime,
journal, OCC, and commit ownership.

### `FAC08` Direct Nested-Context-Call Preflight Decision

**Accepted:** 2026-08-06

Current Convex exposes `runQuery` on query and mutation contexts and
`runMutation` only on mutation contexts. Its query calls share the caller's
snapshot; a mutation's nested mutation runs as a sub-transaction. Current
Convex references are typed generated `FunctionReference` values whose runtime
identity is supplied through proxies or symbol-bearing objects, and current
`runQuery` / `runMutation` also admit transaction-limit options. Storage,
scheduler, metadata, component references, stale-snapshot options, and action
callback syscalls are additional Convex authorities, not incidental context
syntax.

Flarex already owns the corresponding selected semantics. Function API Core
constructs exact frozen positive-capability query and mutation contexts. The
query/internal-call kernel owns same-snapshot query calls. The
mutation/internal-call kernel owns same-journal query and mutation calls,
ordered call frames, depth/cycle/byte budgets, child validation, pending-call
settlement, application-error capture, terminal poisoning, and read-your-writes.
The existing private ABI operations 41 and 42 identify those calls, and
registration already enforces the function-kind capability matrix. FAC08 must
reuse all of those owners without adding a callback port, sub-transaction,
snapshot, journal, OCC, or commit implementation.

The current executable analyzer's catalog hard-codes two-level
`ctx.db.member(...)` paths. Adding special one-level branches for
`ctx.runQuery(...)` and `ctx.runMutation(...)` would duplicate root-binding,
alias, arity, restart, and linker policy. FAC08 instead replaces that catalog
shape with one ordered context-member path representation. Existing point
members become `db/get`, `db/insert`, `db/patch`, `db/replace`, and `db/delete`;
the new entries are `runQuery` and `runMutation`. Stable lowering IDs and ABI
operation IDs remain unchanged. Each entry owns its exact admitted arities:
point members retain their FAC07 arity, while nested calls admit one static
reference plus an optional argument object. Zero arguments, a third options
argument, and top-level spread fail closed.

Nested-call admission remains intentionally narrower than current Convex
developer ergonomics. The call must be an immediate awaited context-bound
member call whose first argument is the existing exact literal
`{ _path: "module:export" }`. Dynamic references, strings, forged paths,
generated proxy expressions, aliases, detached methods, optional/computed
members, dropped promises, direct returns, overlap, and unsupported options
remain rejected. A reachable local or imported helper may receive the context
and make the same direct call: the completed linker already accounts for its
ABI capability across the whole reachable graph, and the runtime object remains
the sole authority. This is the Convex-compatible helper-composition rule and
does not let an untrusted object manufacture runtime authority.

The completed/restart evidence intentionally normalizes the legacy private
`runQuery` / `runMutation` spelling and the new context spelling to the same
stable ABI operation. Unlike database members such as `get`, the nested member
name is already the canonical ABI name, so restart evidence cannot distinguish
the two spellings. Adding a root-only context-helper rule would therefore need
a separately approved evidence/protocol provenance field or would reject
existing private helper calls. FAC08 does neither. It preserves whole-graph
capability accounting and proves local and imported helper admission explicitly.
The stricter existing database-member root rule remains unchanged. A later
developer/internal-test API slice may make generated typed references sibling
producers over a shared authoring primitive only after it defines how trusted
generated reference identity is authenticated by analysis; FAC08 must not
weaken analysis merely to accept the current runtime proxy representation.

The real cooking query, mutation, and workflow-mutation consumers will switch
from private `flarex:platform` call imports to normal `ctx.runQuery` and
`ctx.runMutation`. Their definitions, analyzer, inactive registration, R2
projection, immutable revision selection, Workerd execution, existing
query/mutation kernels, executor, PostgreSQL rows, result, feed, and outbox
remain the proof path. The unrelated remaining private point-read import is not
removed in this slice.

Context syntax itself does not own function-kind admission. The completed-link
and registration capability matrix remains that authority, and it already
admits `runQuery` and `runMutation` for edge actions while denying database
access. Because context and private spellings intentionally resolve to the same
ABI operations, FAC08 preserves that action admission and adds a regression for
it. This does not change the edge-action callback port, independent-transaction
semantics, uncertainty, budgets, or runtime; no action source is migrated and
no action-specific capability is added.

The implementation gate requires exact catalog/ABI parity, one- and two-
argument lowering, static-reference and immediate-await proof, unsupported
arity/spread/options refusal, alias/detachment refusal, local/imported-helper
capability accounting, query-versus-mutation registration admission, restart
identity, every-byte-split equality,
the migrated cooking PGlite and genuine PostgreSQL lanes, generated identity
refresh/checks, affected and broad regressions, both mandatory exact-final
reviewers, reviewer fixes and re-review, and one commit. Database query
builders, auth, action runtime/callback changes, public developer APIs,
platform-module removal, schemas, persistence, activation, routing, and
production behavior remain outside FAC08.

### `FAC08` Implementation Receipt

**Completed:** 2026-08-06

The executable analyzer now owns one ordered context-member-path catalog. Its
existing point database entries retain their stable lowering IDs and exact
arities, while stable entries 6 and 7 lower direct `ctx.runQuery` and
`ctx.runMutation` calls onto the already-owned ABI operations 41 and 42. The
shared incremental call scanner authenticates the complete one- or two-argument
call, exact literal `_path` reference, immediate await, unaliased context
binding, and direct member syntax. It rejects zero or surplus arguments,
top-level spread, options, dynamic/generated/forged references, optional or
computed access, detached calls, dropped promises, direct returns, and overlap.

Completed-link registration remains the sole function-kind authority and
accounts for nested calls across the complete reachable local/imported helper
graph. Query handlers admit `runQuery` but reject `runMutation`; mutations and
the existing action matrix retain both operations. Restart reconstruction maps
the ordered member-path catalog to the same stable ABI flows, including the
intentional canonical-name collision described by the preflight. No runtime,
callback, snapshot, journal, sub-transaction, OCC, commit, action uncertainty,
activation, routing, or production owner changed.

The real cooking assessment query, internal publishing mutation, and workflow
mutation now author nested calls through their frozen Function API contexts.
Those sources traverse the unchanged definition, executable analyzer, inactive
registration, R2 projection, selected runtime, executor, PostgreSQL application
rows, result, commit feed, and outbox path. The unrelated remaining private
`databaseGet` source and the runtime's host-private support-module imports stay
outside this slice.

The executable regenerated deterministically at
`f74ea3583f0ae0e81ed15f31fb048cd2795a8f4e580239703d534d66b7d98cfb`
(4,858,936 bytes), contract
`b95499cd02ffe25ecbf64e2c2dae0c6721980eebcdc6c3a487836edc36fb52a1`,
and manifest identity
`3ac116306c48aa50cc4c359127f024ea772a8e4b60fe276eb42a61cf5ea7c33e`.
The base verifier remained
`00eb1d44298eac350d1e4dcac1d14896b13b8e0d841c8c01108c8a60fca8fc39`.

Validation passed both affected typechecks, all 51 registration tests, 222
executable-verifier tests in the broad lane plus clean focused reruns of the
generated-identity pin and the one filesystem-cleanup-timeout case, all three
generated checks, the complete 21-file/51-test PGlite system lane, the focused
two-test genuine PostgreSQL 18 cooking lane, and the workspace Effect-boundary
check. The changed analyzer operations are pure incremental state machines:
they add no expected async failure, resource lifetime, injected service, retry,
or recovery boundary requiring a new Effect service or Layer. Both mandatory
exact-final reviewers reported no actionable findings. The TypeScript reviewer
confirmed catalog/ABI/generated/restart agreement and found no Effect
transformation candidate; the code-quality reviewer confirmed reachable-graph
capability accounting plus unchanged runtime, journal, OCC, and commit owners.

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

### `FAC09` Private Platform Removal Preflight Decision

Current Convex passes a positive-capability context into each registered
handler. Developer-authored database and nested calls use `ctx.db`,
`ctx.runQuery`, and `ctx.runMutation`; internal syscall plumbing is not an
importable developer module. Flarex had already built the same explicit
function-context facade, but its analyzer fixtures and generated exact Workers
still supported a second spelling through `flarex:platform`. That specifier
also combined two different owners: ambient auth/database/nested-call shims and
the mutation application-error registry whose process-local `WeakMap` proves
catchable-error provenance.

FAC09 directly removes the first owner and deliberately retains the second:

- `ctx.auth.getUserIdentity()`, all five admitted point database members, and
  direct nested calls lower to their existing ABI operations with exact arity;
- the analyzer platform catalog is an exact module-to-operation manifest, not
  a module-wide grant, and admits no user-authored operation from the host-
  private `flarex:platform` module;
- query Worker graphs contain no synthetic platform module;
- mutation-internal Worker graphs retain one error-only host module so their
  handler constructors and host inspector share the same immutable registry;
- portable kernels invoke handlers directly with their already-created
  context. The removed invocation-global stack and synthetic mutation-capable
  projection existed only for private user-call shims and owned no journal,
  OCC, commit, or lifecycle authority; and
- every positive application and system fixture migrates to `ctx`, while
  explicit removed-import vectors prove fail-closed refusal.

This is one replacement, not dual acceptance. It introduces no public module,
new syscall, schema, persistence state, route, activation behavior, or
production trigger. Application-error developer ergonomics remain a later
preflight: current Convex uses a standalone error class rather than a context
member, so FAC09 must not invent a context-shaped error API merely to eliminate
the last private module spelling.

### `FAC09` Implementation Receipt

`FAC09` completed the direct replacement described above:

- the analyzer admits the complete direct handler surface, including
  `ctx.auth.getUserIdentity()`, and rejects every user-authored
  `flarex:platform` operation through an exact empty operation manifest;
- portable query and mutation kernels invoke handlers directly with their
  owned positive-capability contexts, with no ambient invocation stack or
  synthetic mutation-capable projection;
- query Worker graphs no longer synthesize a platform module, while mutation-
  internal graphs retain only the host-private shared application-error
  registry and inspector;
- positive production, restart, registration, and simulation fixtures use
  `ctx.*`; removed user-call imports remain only as explicit fail-closed
  analyzer vectors; and
- no journal, OCC, commit, persistence, schema, activation, route, or
  production-trigger owner changed.

The committed generated analyzer executable identity is
`f47121d2875efb784275e3c09088ff5e66bc2e5b3c472698584c078e1720b943`
at `4,859,064` bytes. Validation covered analyzer typecheck and generated
checks, all 522 analyzer tests, every backend generated-core
check and typecheck, 37 focused backend producer/Workerd tests, all 52 portable
function-runtime tests, system-test typecheck, and seven real-system PGlite
files with 21 tests.

### `FAC10` Standalone Application Error Preflight Decision

The public developer API is justified, but only as a standalone value-domain
constructor. Current Convex owns `ConvexError` beside its public values API and
lets application code write `throw new ConvexError(data)`. Its runtime later
recognizes the error through a globally registered symbol. Flarex must copy the
useful authoring shape without copying that forgeable recognition boundary.

The accepted Flarex split is:

- `flarex/values` owns `FlarexError` beside `Value` and `v`; it is not a
  context member and does not expose a host syscall module;
- the constructor remains explicit as
  `new FlarexError(code, message, data?)`. Copying Convex's single-data
  constructor would require a new hidden code and bounded-message derivation
  protocol, while the accepted Flarex wire and catchability contract already
  owns immutable `code`, `message`, and optional canonical `data`;
- exact Workers own a fresh constructor per isolate. It captures and validates
  the three accepted fields through the existing process-local `WeakMap`
  registry, so a matching class name, public properties, global symbol, or
  separately constructed developer-package instance cannot forge provenance;
- the analyzer lowers only an exact `new FlarexError(...)` binding
  imported from `flarex/values`. Arbitrary `new`, `class`, `super`, subclassing,
  computed construction, and user imports from `flarex:platform` remain
  rejected; and
- query and mutation registration may advertise this capability only after
  every selected query and mutation runtime graph provides the exact public
  module and shares its registry with the owning failure inspector. Actions
  and workflow mutations remain fail-closed until their separate exact runtime
  owners provide the same proof.

`FAC10-P1` completed the first shared primitive only: the public typed
authoring class and the isolate-local registry constructor use the same visible
`name`, `code`, `message`, and optional `data` shape, while the registry keeps
the accepted validation order, byte bounds, canonical data capture, and
unforgeable identity. This is deliberately not yet analyzer or Worker
admission.

`FAC10-P2` completes that admission as one capability. The executable analyzer
maps only the unaliased named `FlarexError` import from `flarex/values`, used
with `new` and exactly two or three arguments, onto the existing `errorCreate`
ABI operation. Calling it without `new`, aliasing or shadowing it, supplying a
different arity, or constructing an unrelated identifier remains rejected in
both warm analysis and cold reconstruction. A catch binding may use the exact
fail-closed guard `if (!(error instanceof FlarexError)) { throw error; }` and
then read only its direct `code`, `message`, or `data` field inside that same
catch block before any reassignment or nested catch; those exact reads lower to
the existing `errorCode`,
`errorMessage`, and `errorData` ABI operations. Unguarded field reads,
non-exiting or non-dominating checks, scope escape, reassignment, unrelated
`instanceof` targets, arbitrary members, aliases, and nested data property
dispatch remain rejected. Assignment, compound assignment, update, `delete`,
destructuring-assignment, and bare loop-target positions are never classified
as application-error field reads; destructuring and loop writes to the narrowed
catch binding also invalidate the proof. One conformance source is consumed by
both the authoritative analyzer proof and a genuine Workerd execution proof.
Every exact `flarex/values` import in the handler module's recursively reachable
static artifact-import graph asserts the application-error capability even when
its imported function is never called. Callable reachability remains the
separate authority for operation capabilities. Registration therefore rejects
unsupported runtime profiles before ECMAScript module instantiation. It
advertises the capability for query and mutation functions only; workflow
mutations and actions remain fail closed.

Every selected point-runtime graph now carries exactly one generated Function
API Core, one canonical host-private
`_flarex/application-error-platform-v1.js` registry module, and the public
`flarex/values` facade. That matrix covers top-level point query, point query
with internal calls, top-level point mutation, point mutation with internal
query, and point mutation with internal query plus mutation calls. The
host-private module exports only the constructor and provenance inspector; the
former private create/read compatibility functions were removed once their
last test consumer moved to the public constructor. Application modules remain
at their authenticated root paths while `_flarex/execution.js` remains only
the generated registry bridge, preventing a nested bare-module alias from
creating a second registry.

The portable runtimes preserve boundary ownership: query application errors
are rethrown only after the read boundary closes and drains, mutation
application errors only after the journal closes and drains, and an owned
read/journal failure still wins. The exact Worker then preserves the original
registered error rather than projecting ordinary user-code failure. No name,
property, `instanceof`, or global-symbol fallback was added.
The internal-call mutation runtime retains its broader authenticated
document-validation predicate only for child-call catchability; root settlement
uses the exact registry inspector, so a document-validation failure keeps its
pre-existing user-code boundary instead of escaping as a registered error.

This decision changes no syscall, application-error wire payload, inspector
classification, query read boundary, mutation journal, OCC, commit, schema,
persistence, activation, route, or production behavior.

`FAC10` is closed. The next implementation turn must begin with a fresh
`FAC11` preflight against current Convex source and choose one concrete shared
context/runtime primitive with at least two real exact-runtime consumers. It
must not turn the public `flarex-test` harness into an in-process substitute,
admit action or workflow-mutation application errors, or widen any persistence,
OCC, commit, activation, routing, or production owner merely to continue the
centralization program.

The public `flarex-test` real-runtime contract remains unchanged. Internal
simulation APIs may adopt shared authoring primitives and normal `ctx.*`
handlers, but their end-to-end lane must continue through the actual analyzer,
R2 materialization, Workerd runtime, executor, and Postgres owners. A faster
in-process semantic lane is complementary evidence and must be named as such.

### `FAC11` Shared Auth-Facade Completion Preflight Decision

The next shared primitive is the already accepted
`createFunctionRuntimeAuthV1`, not a new base or universal context. Current
Convex keeps `setupAuth(requestId)` as one small public-context facade and has
that facade delegate `getUserIdentity` to the host-owned
`1.0/getUserIdentity` async syscall. Query and mutation registration each
compose that same facade beside their own exact database, storage, scheduler,
metadata, and nested-call capabilities. The Rust isolate dispatcher retains
the identity authority. This is the useful Convex boundary to copy: centralize
the developer-visible facade, but do not move authentication or execution
identity authority into the facade.

Flarex already owns the equivalent split. Each exact Worker validates and
captures its authenticated request projection before application execution,
while Function API Core owns a frozen `getUserIdentity` facade parameterized
by an explicit identity-clone port. The internal-call query and mutation
profiles already use it. The top-level point-query, top-level point-mutation,
and mutation-with-internal-query profiles still reconstruct the same facade
locally. They are three real consumers spanning query and mutation execution,
and every corresponding Worker graph already includes the single generated
Function API Core module.

`FAC11` therefore completes adoption of that existing facade in those three
profiles. It preserves each profile's current context shape and allocation
boundary, uses the Worker's captured native structured-clone capability, and
retains fresh identity ownership on every `getUserIdentity` call. Request
decoding remains the authority for anonymous versus authenticated identity;
the shared facade receives only that decoded projection and cannot verify,
mint, refresh, or widen it.

A generic `create*BaseContext` or context with optional capabilities is
explicitly rejected. `FAC04` removed those shapes in favor of exact positive-
capability contexts, and the older point profiles' unsupported scheduler,
storage, and nested-call placeholders are separate profile-migration debt.
Changing or deleting those keys would alter runtime compatibility rather than
centralize auth, so it is not part of this slice. No action, workflow mutation,
public test harness, analyzer operation, protocol identity, persistence,
journal, OCC, commit, activation, routing, or production owner changes.

The acceptance gate is generated-source identity for all three refreshed
Workers, one-core-module graph evidence across all five selected query and
mutation profiles, direct Workerd proof of anonymous and authenticated identity
semantics including fresh clones, complete function-runtime regression, backend
generated checks and typecheck, and both exact-final reviewers.

### `FAC11` Implementation Receipt

**Completed:** 2026-08-06

All five selected query and mutation exact runtimes now construct
`ctx.auth` through the one generated Function API Core facade. The three newly
migrated Workers retain their previous profile-specific context keys and create
the facade at the same invocation-open boundary. Their request decoders still
own identity admission, and each facade call clones the captured authenticated
projection through the Worker's native structured-clone port. Anonymous calls
return `null`; repeated authenticated calls return detached identities.

The refreshed exact Worker core identities are:

- top-level point query:
  `03006aad7080e7df2560f056aa90b2e35183e2e7eb87f73403fa0d27da6011c5`;
- top-level point mutation:
  `5ab7af3db695cbdf7e2f9553bd794e26a3d77c5ea05a6d7364f94fa2ea8e6206`;
  and
- point mutation with internal query:
  `b6142217a62a741b345e370bc839a7a8ef53b05271c9356cea6b27807486eb84`.

The final regression set includes a canonical generated-core injection in the
older in-process mutation harness. It evaluates the checked-in Function API
Core source in an isolated test closure rather than copying the facade, so its
21 journal, failure, validation, deterministic-runtime, and identity tests
continue to exercise the generated Worker. The changed mutation graph-basis
digest receipt was refreshed to the exact new graph.

Validation passed all generated backend build checks and backend typecheck,
function-runtime typecheck and all 59 tests, all six selected generated/Workerd
files with 34 tests, the complete 21-test point-mutation exact-runtime suite,
and the workspace Effect-boundary check. No analyzer, application-error,
protocol, query read-boundary, mutation journal, OCC, commit, schema,
persistence, activation, routing, or production behavior changed.

`FAC11` is closed. The next implementation turn must begin with a fresh
`FAC12` preflight against current Convex source and select one further concrete
shared runtime primitive with at least two exact consumers. It must preserve
the positive-capability context decision and must not use placeholder removal
or public test-harness shortcuts as incidental centralization work.

### `FAC12` Top-Level Point Database-Facade Completion Preflight Decision

Current Convex still keeps database facade construction in one shared runtime
owner. `setupReader()` constructs the complete admitted reader and delegates
its operations to the syscall bridge. `setupWriter()` calls `setupReader()`,
preserves the reader methods, and adds the four write methods. Query and
mutation registration then select those shared facades rather than rebuilding
database methods per function profile. The useful rule is composition and
positive capability; Convex's table overloads, query builder, system reader,
normalization syscall, validation codec, and global bridge are not authority
for Flarex features that have not been implemented.

Flarex Function API Core already owns the narrower accepted equivalent:
`createFunctionRuntimePointReaderV1` returns exactly frozen `{ get }`, while
`createFunctionRuntimePointDatabaseWriterV1` composes that reader with exact
`insert`, `patch`, `replace`, and `delete` ports. The query/internal-call and
mutation/internal-call profiles consume those facades. The top-level point-
query and top-level point-mutation Workers still rebuild the same admitted
methods locally and advertise `query`, `normalizeId`, `system`, and, for the
query, write members that only throw. Those members have no analyzer admission
or host capability and contradict the positive-capability decision already
proved by `FAC02` and `FAC03`.

`FAC12` directly migrates those two top-level profiles to the existing shared
point database facade. The query Worker supplies its unchanged snapshot/read-
boundary adapter to the shared reader and exposes only `get`. The mutation
Worker supplies its unchanged journal-owned read and four write adapters to
the shared reader/writer composition and exposes exactly `get`, `insert`,
`patch`, `replace`, and `delete`. The adapters retain all document/table
validation, field capture, promise tracking, sequencing, failure poisoning,
close/drain, and RPC disposal. Function API Core receives no snapshot,
journal, tables, transaction, R2, PostgreSQL, binding, OCC, or commit authority.

The mutation-with-internal-query profile is deliberately not folded into this
database-only slice. Its kernel currently creates a mutation-shaped throwing
database for child queries and spreads a legacy broad base context before
attaching `runQuery`. Replacing that representation correctly requires one
coherent exact context-profile migration, not another wrapper around negative
capabilities. That is the next candidate preflight after FAC12. This boundary
is based on ownership, not compatibility preservation for the removed top-
level placeholders: top-level unsupported database members are removed now,
with no fallback or dual facade.

The implementation gate is exact portable database types, Function API Core
use in both authored and generated Workers, exact-key and frozen-facade tests,
genuine Workerd query and mutation proofs, unchanged synchronous validation and
promise/journal behavior through the complete legacy mutation harness,
deterministic regenerated identities and graph receipts, complete affected
package regressions, the workspace Effect-boundary check, both mandatory exact-
final reviewers, and one commit. No analyzer operation, protocol identity,
schema, snapshot/journal owner, OCC/commit behavior, action uncertainty,
activation, routing, or production behavior changes.

### `FAC12` Implementation Receipt

**Completed:** 2026-08-06

The top-level point-query Worker now supplies its existing snapshot-backed read
adapter to `createFunctionRuntimePointReaderV1` and exposes exactly frozen
`{ get }`. The top-level point-mutation Worker composes the same reader with
its four existing journal-owned write adapters through
`createFunctionRuntimePointDatabaseWriterV1` and exposes exactly frozen
`{ get, insert, patch, replace, delete }`. Their portable runtime database
types now express those exact positive capabilities. The removed query write,
scan, normalization, and empty system members had no host authority or analyzer
admission, and no compatibility facade remains.

All validation, capture, promise tracking, journal serialization, syscall
sequencing, first-failure poisoning, close/drain, and RPC-disposal code remains
in the exact Workers. The shared facade continues to delegate synchronously
and returns each adapter promise unchanged. The legacy in-process mutation
harness now injects all three selected exports from the canonical generated
Function API Core closure, so its complete behavioral suite traverses the same
facade rather than a copied test implementation.

The deterministic refreshed identities are:

- top-level point-query runtime kernel:
  `f490ce3f2d819b29e17c4ecb29c4dc0af4707096d0ec9ce2efef81096971fa65`;
- top-level point-query Worker core:
  `5c758ac3ac498447e6bd6923de324c21bd4dde1564ec8d703a01cee51f20f70e`;
- top-level point-mutation runtime kernel:
  `3b05bb96ecba10987b525cf52d18de4861b805834896a4117fb1e590f8090980`;
- top-level point-mutation Worker core:
  `0c8570577cba4f22683ce28bc1e5c4d5a127b7c39d32289bc046c34497ef7049`;
  and
- top-level point-mutation graph-basis SHA-256:
  `97a8aec600cd3d5a683b82ffc53b0d25a0def7e00a946a90fb29465d904cba81`.

Validation passed all 59 function-runtime tests and its typecheck, the complete
backend generated build and typecheck, all seven selected generated, legacy,
and genuine Workerd files with 56 tests, and the workspace Effect-boundary
check. Workerd proves exact database key order for both profiles; the legacy
mutation suite preserves its 21 journal, validation, deterministic-runtime,
failure, and promise-settlement tests.

`FAC12` is closed. `FAC13` must begin with a fresh current-Convex preflight for
the mutation-with-internal-query profile's context composition. It must replace
the mutation-shaped throwing child-query database and broad base context as one
positive-capability migration, not merely reuse the reader/writer factories
while preserving negative facade members.

### `FAC13` Run-Query Context And Mutation-Internal-Query Preflight Decision

**Accepted:** 2026-08-06

The current checked-in Convex source at `43301bc895df12f4c60b94f0b3556d226ab1aae0`
still constructs the complete reader once in `database_impl.ts`, constructs the
writer by reusing that reader, and selects positive query and mutation contexts
in `registration_impl.ts`. A query receives a reader plus `runQuery`; a mutation
receives a writer plus `runQuery` and `runMutation`. This remains useful
composition guidance. Convex's full query builder, system-table reader,
normalization, storage, scheduler, metadata, overloads, global syscall bridge,
and nested-call transaction behavior remain outside this Flarex slice.

The older Flarex mutation-with-internal-query profile still violates that
positive-capability shape in two connected places. Its exact Worker constructs
a broad base context containing throwing `runQuery`, `runMutation`, scheduler,
and storage members and a mutation database containing throwing scan and
normalization members. Its portable kernel then creates a child-query database
by retaining the mutation shape and replacing every write with a terminal
throw. The root mutation consequently sees a broad context that advertises
features the profile never admitted, while a child query discovers read-only
status only by calling a write-shaped placeholder.

The existing shared context primitive also needs one direct private correction
before it can own this profile cleanly. `FunctionRuntimeQueryContextV1` and
`createQueryFunctionRuntimeContextV1` describe the structural capability
`{ auth, db, runQuery }`, but their names claim the function kind is a query.
Using that factory for the mutation root would be semantically false; adding an
identical mutation-query factory would duplicate core logic; and using the full
mutation factory with a throwing `runMutation` would preserve the rejected
negative-capability design.

`FAC13` therefore directly replaces those private query-kind names with the
capability-neutral `FunctionRuntimeRunQueryContextV1` and
`createFunctionRuntimeRunQueryContextV1`. The full
`FunctionRuntimeMutationContextV1` continues to extend that shape with a real
`runMutation`, and its existing constructor remains the owner for profiles that
actually admit mutation calls. The query/internal-call and combined
mutation/internal-call exact consumers move to the renamed primitive in the
same generated closure; no parallel old/new private API or compatibility alias
is retained.

The mutation-with-internal-query kernel receives only two context constructors
from its invocation owner; it does not receive a redundant raw database port.
The Worker-owned closures retain the exact child reader and root writer. The
kernel creates child contexts only through the shared run-query context
primitive with `{ get }`, and creates the root context through the same
primitive with `{ get, insert, patch, replace, delete }`. Both contexts expose
exactly `{ auth, db, runQuery }`; neither exposes `runMutation`, scheduler,
storage, scan, normalization, or system-table placeholders because this staged
profile does not admit those capabilities. The exact Worker composes the child reader
and root writer through the already accepted point-reader/point-writer
factories and retains all table validation, field capture, read-your-writes,
journal sequencing, poisoning, close/drain, deterministic globals, and RPC
disposal locally.

Rejected alternatives are preserving the broad base context, wrapping a
mutation database in throwing child-write members, adding a second structurally
identical context factory, weakening the combined profile to this restricted
shape, or moving snapshot/journal/nested-call policy into Function API Core.
The generated-identity changes are limited to the private Function API Core and
the exact Workers that consume the renamed context primitive or the completed
FAC13 profile. No analyzer operation, public protocol/profile/syscall ABI,
schema or persistence owner, query snapshot, mutation journal, OCC or commit
owner, action uncertainty, activation, routing, or production behavior changes.

The implementation gate is exact portable database and context types, no
negative capability members, authored/generated Worker agreement, exact frozen
context and database key proofs in unit and genuine Workerd tests, unchanged
nested-query budgets and terminal/application/journal behavior, deterministic
generated identities and graph receipts, affected package regressions,
`check:effect-boundaries`, both mandatory exact-final reviewers, fixes and
re-review when needed, and one intentional commit.

### `FAC13` Implementation Receipt

**Completed:** 2026-08-06

Function API Core now owns the capability-neutral
`FunctionRuntimeRunQueryContextV1` and
`createFunctionRuntimeRunQueryContextV1`. The former query-kind names were
removed directly from source, declarations, generated source, and every exact
consumer; there is no compatibility alias or dual private API. The full
mutation context still composes that primitive with a real `runMutation` only
for the combined profile that admits it.

The mutation-with-internal-query kernel now asks its invocation owner only for
exact child-query and root-mutation context constructors. It no longer receives
a redundant raw database and no longer manufactures a mutation-shaped
read-only facade. The exact Worker closes those constructors over one shared
auth facade, the journal's exact `{ get }` reader, and its exact
`{ get, insert, patch, replace, delete }` writer. The root and every child see
exactly frozen `{ auth, db, runQuery }` contexts. The broad scheduler, storage,
`runMutation`, scan, normalization, system-table, and throwing child-write
members are absent.

The journal still owns table and document validation, field capture,
read-your-writes, operation serialization, syscall sequence assignment,
application-error catchability, first-failure poisoning, close/drain, and RPC
disposal. The portable kernel still owns catalog admission, nested-call and
byte budgets, cycle detection, call frames, dropped-call settlement, result
validation, and terminal failure classification. Unit and genuine Workerd
tests prove exact root/child context and database keys, freezing, successful
insert-then-child-read behavior, and terminal classification when hostile
untyped child code attempts a missing write.

The deterministic refreshed generated identities are:

- Function API Core:
  `234a1f5249fd9b19c5a6f353ea336f2cab50c73859c6fb553b203437c1dd4fac`;
- query/internal-call runtime kernel:
  `a380e76e28f9ac53f3024b334d8b6d01e50c5b99664f7babdb4b6007cbe6c711`;
- query/internal-call Worker core:
  `b6e238c90f049ea31551dbc8b77e0cf8f3bfab6f1599993bb81a10e34a050f66`;
- mutation/internal-query runtime kernel:
  `b7d390516434fb843588f1ef4dbaef9481ed52d141d574948c67a7cb1c926bbc`;
- mutation/internal-query Worker core:
  `418658caa2aecc82f999e7085492cfebe1598e9333442644703d265e59157a8d`;
- mutation/internal-call runtime kernel:
  `b0b87b9e83cf3aad7cc7282748751645bf19e317d90664e3dc586bc39f54189b`;
  and
- mutation/internal-call Worker core:
  `c5cfc6f29770e96b01f5ea01eee5ff1ec1df32f4b73ea8b7ca9a805a1b3e5940`.

For the stable graph-basis fixtures, the shared support identity produces
query `9234f79e2ffd03cbebcc39e7588be23006694a5acd4621d6bf79989984ae7d94`,
mutation `ace1ad4d884abc7765e740e5942b0874323865ee127c305f92b149a35ab84116`,
query/internal-call
`3ca61f0849dec3b19d63e2cbcf0c494192c4728422a77a651becdcac7a978b70`,
mutation/internal-query
`b0bd2db9ea244349e9af7806db199277263ea638977bc03fb87ec0bbb6af4fa4`,
and mutation/internal-call
`b363debeb2a3bb00173e22adb6410d3211e9f934faeefcca0232bf3e85a5f02b`.
The top-level Worker-core bytes did not change; their graph bases changed only
because those graphs commit the directly replaced shared support module.

Validation passed the complete deterministic backend build and backend
typecheck, function-runtime typecheck and all 59 tests, all seven affected
generated, legacy, and genuine Workerd files with 57 tests, and the workspace
Effect-boundary check. Both mandatory exact-final reviewers reported no
findings after independently checking the capability split, private direct
replacement, generated agreement, journal and terminal behavior, and test
coverage.

`FAC13` is closed. `FAC14` must begin with a fresh current-Convex preflight for
the top-level `{ auth, db }` context shared by point query and point mutation.
The likely bounded capability is one exact base-context primitive used by both
Workers, with removal of the point-mutation Worker's remaining throwing nested
call, scheduler, and storage members. The preflight must reject a universal
context, prove two exact consumers, and preserve query read-boundary and
mutation journal ownership before implementation.

### `FAC14` Database Context Preflight Decision

**Accepted:** 2026-08-06

The current checked-in Convex source at `43301bc895df12f4c60b94f0b3556d226ab1aae0`
still constructs a reader in `database_impl.ts`, constructs a writer by reusing
that reader, and selects each function-kind context positively in
`registration_impl.ts`. Its current query context contains a real reader,
auth, storage, metadata, and `runQuery`; its mutation context contains a real
writer, auth, storage, scheduler, metadata, `runQuery`, and `runMutation`.
Flarex should preserve that positive-capability composition style without
pretending that the staged point profiles already own Convex's query builder,
system-table, storage, scheduler, metadata, or nested-call capabilities.

The top-level point-query Worker currently creates its admitted `{ auth, db }`
context inline. The top-level point-mutation Worker creates the same admitted
pair but also publishes throwing `runQuery`, `runMutation`, scheduler, and
storage members. Those placeholders are not compatibility behavior: the
private point-mutation profile never admitted the capabilities, its portable
context contract exposes only `{ auth, db }`, and no generated or runtime
consumer can use them successfully. Keeping them makes feature discovery
depend on terminal failure and gives the two exact consumers different context
semantics for the same admitted capability set.

`FAC14` therefore introduces the private capability-neutral
`FunctionRuntimeDatabaseContextV1` and
`createFunctionRuntimeDatabaseContextV1`. The name deliberately does not say
"base context": Convex-style actions do not have direct database access, so
`{ auth, db }` cannot honestly become a universal function-context base. The
existing run-query context extends this database-context shape, and the full
mutation context continues to extend the run-query shape only where those
capabilities are real. The factory returns one fresh, exact, frozen object and
preserves the supplied auth and database objects by identity; it does not own
their construction, lifetime, transaction, or deep immutability.

Both top-level exact Workers become direct consumers. Point query retains its
Worker-owned snapshot read boundary and exact `{ get }` reader. Point mutation
retains its Worker-owned journal and exact
`{ get, insert, patch, replace, delete }` writer. The remaining throwing nested
call, scheduler, and storage members are removed rather than moved, aliased, or
made optional. Function API Core does not acquire snapshot, journal, syscall,
validation, settlement, or host policy.

Rejected alternatives are a universal or optional-capability context, a
function-kind-specific duplicate factory, preserving unsupported members for
future compatibility, and naming the shared shape as a base for actions. No
public developer API, analyzer operation, protocol/profile/syscall identity,
schema or persistence owner, snapshot or journal policy, OCC or commit owner,
action uncertainty, activation, routing, or production behavior changes.

The implementation gate is exact authored and generated context keys, frozen
and fresh-object proofs, absence of negative capability members in generated
source and genuine Workerd execution, deterministic Function API Core and both
top-level Worker identities, stable graph receipts, affected regressions,
`check:effect-boundaries`, both mandatory exact-final reviewers, fixes and
re-review when needed, and one intentional commit.

### `FAC14` Implementation Receipt

**Completed:** 2026-08-06

Function API Core now owns the private capability-neutral
`FunctionRuntimeDatabaseContextV1` and
`createFunctionRuntimeDatabaseContextV1`. The run-query context extends this
exact `{ auth, db }` shape, while the full mutation context still adds real
`runQuery` and `runMutation` capabilities only for the combined profile that
admits them. The constructor returns a fresh frozen context and preserves the
auth and database values by identity.

The top-level point-query and point-mutation exact Workers both consume the
new constructor. Query still supplies its exact `{ get }` reader inside the
same snapshot read boundary. Mutation still supplies its exact
`{ get, insert, patch, replace, delete }` writer inside the same journal. Its
previous throwing `runQuery`, `runMutation`, scheduler, and storage members and
the now-dead unsupported-function helper are absent. Auth cloning, validation,
deterministic globals, pending-operation settlement, journal poisoning,
close/drain, terminal failure classification, and RPC disposal are unchanged.

The deterministic refreshed identities are:

- Function API Core:
  `0d0b9846fd167b826f862bfadc6cbbfd8a22f6844d15f1ca8ffeb7002db50972`;
- point-query Worker core:
  `778f50fd9b66a0e7156521231774e0246de8260c92698bcf54524aabd53dc73d`;
  and
- point-mutation Worker core:
  `0b961c10481b3e98625e3bf18b1398c078c5c02f359abc063c3c6564de2176ba`.

For the stable graph-basis fixtures, the shared support identity produces
point query `ca08687ca0e2ca14940fcea28e754bdbb9c406a4df9611eb216ceb7201252314`,
point mutation `d3da4949de85074d68d4b983dc784000496eb1702a9f0aff645b87f5a4e3e9d1`,
query/internal-call
`5cba43442dcd1763d7fab91c2a3f5665d61d99d209943b2e6fc93d03cd31603c`,
mutation/internal-query
`9cf3806cb93b337b23795650bbbcf6f57d0220de061633d38cdd49319e30467b`,
and mutation/internal-call
`537b7650e437e8617bc6a31f846261b633403c3c62c56f287012e30acf6865c7`.
The three nested Worker-core and runtime-kernel byte identities remain
unchanged; only their graph bases move because every graph commits the shared
Function API Core identity.

Validation passed the complete deterministic backend build and backend
typecheck, function-runtime typecheck and all 59 tests, all eight affected
generated, legacy, and genuine Workerd files with 58 tests, and the workspace
Effect-boundary check with zero production `Effect.runSync` and 56 allowed
production `Effect.runPromise` sites. Both mandatory exact-final reviewers
reported no findings after independently checking type and runtime contract
agreement, Effect applicability, positive capability composition, generated
identity closure, snapshot and journal ownership, and test coverage.

`FAC14` is closed. `FAC15` must begin with a fresh preflight over the remaining
authored/generated runtime duplication. It should prefer one exact
two-consumer capability and preserve all present profile, application-error,
deterministic-global, settlement, snapshot, journal, and host boundaries rather
than extracting a universal runtime helper.

### `FAC15` Auth Identity Snapshot Preflight Decision

**Accepted:** 2026-08-06

The current checked-in Convex source at `43301bc895df12f4c60b94f0b3556d226ab1aae0`
still owns `getUserIdentity()` inside the shared `setupAuth()` facade in
`authentication_impl.ts`, then supplies that facade positively to query,
mutation, and action contexts in `registration_impl.ts`. Its syscall bridge
owns identity acquisition. Flarex differs because its exact Worker has already
validated and captured an authenticated projection before invoking user code,
but the user-facing behavior should still be owned by one shared auth facade
rather than by a host callback repeated in every function profile.

Function API Core already owns `createFunctionRuntimeAuthV1`, including the
anonymous result, asynchronous method shape, frozen facade, and rule that every
user call receives a fresh identity. It nevertheless requires a
`FunctionRuntimeIdentityCloneV1` callback. All five admitted point-runtime
Workers satisfy that private port with the same one-line
`nativeStructuredClone` wrapper. No consumer supplies a different policy, no
test implementation represents a supported alternate runtime, and the port
does not express host authority. It only leaks one implementation detail of
the facade back into every generated Worker.

`FAC15` therefore removes the clone-port type and callback directly. Function
API Core captures the platform `structuredClone` intrinsic at its own module
evaluation and uses it whenever a validated user projection is returned. ES
module dependencies evaluate before the importing exact Worker calls
`installExactGlobals`, so the shared module captures the same native Workerd
intrinsic that each Worker previously captured. Exact Workers still own
request decoding, identity validation, semantic byte limits, canonical JSON
admission, and the trusted frozen projection; the shared facade owns only a
fresh detached return snapshot.

The connected trust audit also found that the two query Workers used the live
global `structuredClone` while copying custom claims into that trusted
projection after the dynamically imported application module had evaluated.
Application top-level code can replace this writable global before request
capture. `FAC15` captures `nativeStructuredClone` in those two Workers before
either dynamic application import is initiated, then uses it specifically for
auth admission and custom-claim copies. That intrinsic is distinct from the
clone captured by Function API Core: Workers own trusted request capture,
while the shared facade owns the fresh user-visible result. A genuine Workerd
tamper regression must prove the admitted claims cannot be rewritten by
application module evaluation.

The clone remains per `getUserIdentity()` call. Returned identities are not
recursively frozen: they are user values, and existing query and mutation
behavior permits one result to be mutated while proving that the trusted
projection and the next result remain unchanged. `structuredClone` failure is
still a defect after admission, just as it was through the old native callback;
it is not converted into an Effect failure, application error, or terminal host
classification. The factory remains a pure synchronous facade constructor
whose method preserves the existing Promise boundary.

Rejected alternatives are retaining the unvarying callback as dependency
injection, hand-copying only known identity fields and thereby aliasing or
dropping custom JSON claims, recursively freezing user results, using global
`structuredClone` at call time after exact-global installation, moving auth
request validation into Function API Core, or widening this point-runtime
slice into the separately owned edge-action graph. No public developer API,
analyzer operation, protocol/profile/syscall identity, schema or persistence
owner, snapshot or journal policy, OCC or commit owner, action uncertainty,
activation, routing, or production behavior changes.

The implementation gate is direct removal of the private clone-port API and
all five duplicate Worker wrappers, exact anonymous and per-call ownership
tests including nested custom claims, authored/generated agreement, genuine
Workerd parity for top-level and nested profiles, deterministic support and
Worker identities plus graph receipts, affected regressions,
`check:effect-boundaries`, both mandatory exact-final reviewers, fixes and
re-review when needed, and one intentional commit.

### `FAC15` Implementation Receipt

**Completed:** 2026-08-06

Function API Core now owns the platform clone used by the private auth facade.
`FunctionRuntimeIdentityCloneV1` and the five identical Worker-local
`cloneUserIdentityV1` adapters are removed. Anonymous identity behavior is
unchanged, while each authenticated `getUserIdentity()` call returns a newly
detached, user-mutable snapshot. Nested custom claims are detached from the
trusted projection and from later calls.

The trust correction found during review is also closed. Both query Workers
capture the native clone before initiating their dynamic application import
and use that captured intrinsic while admitting custom claims. Generated-source
tests pin this ordering for both profiles, and a genuine Workerd case lets
application top-level code overwrite `globalThis.structuredClone` while proving
that the admitted subject and custom role cannot be forged.

The final generated source identities are:

- Function API Core:
  `ec57ff2a52924cf0ea731c3c40c12fb5d06af2a46f7fdc5586e6744c6c7e877a`;
- point query:
  `a9d5360037503f64e747d1fb3f01c7d2cc44c9b575f442f9c1a70eab13629056`;
- point query/internal call:
  `9efc961a3e5bbe104ca7da9fc13412a58a82ac924139e906751fe8ea7f2da706`;
- point mutation:
  `06aa94b4dda7fe4188715c6392b7591bca3e900377490a351a8c0a8e6a67e817`;
- point mutation/internal query:
  `e33785c2f2c841a10889dc577b6eb22defee065f0fa3fc092a6c89e152b8fe73`;
- point mutation/internal call:
  `a5f5bc6ef95a18c93ef4b362e243653bba8784e652deb584d162fa0a63acc939`.

Their final representative graph-basis SHA-256 receipts are point query
`0148a4ba0e6f21d27971d9f2c27b7b248595f60c275d7b13ba31424112683442`,
point mutation
`d27d77a2c54b30fd9a73a4ff1e8bb7c097a257a1e07141bc38f3b7cc64435e15`,
point query/internal call
`372f56d6c52067b9db39655564c902ac11c3cc7ce0db8ee4bb4ccfe2271af04b`,
point mutation/internal query
`dc0b865f96c73db3409739bb56ca77715dc6fd2665c5076a1ac6c88403c8359c`,
and point mutation/internal call
`168cf186d773b8051fd6e6566620b638ce072ba5a6a5fb789abdb7c23b0706c2`.

Validation passed for all six deterministic generated-source checks, Function
API Core typecheck and 7 files / 59 tests, backend typecheck and the affected 8
files / 59 tests including all five point-runtime Workerd profiles, scoped
`git diff --check`, and `check:effect-boundaries` with zero production
`Effect.runSync` and 56 allowed `Effect.runPromise` sites. The TypeScript/API
reviewer reported no findings. The systems-quality reviewer first found the
application-import ordering defect above, then reported no findings on the
corrected exact-final diff and confirmed that snapshot, journal, OCC, commit,
action, activation, and routing ownership remain unchanged.

`FAC15` is closed. `FAC16` must begin with a fresh current-runtime and
current-Convex preflight over every remaining captured platform intrinsic and
the ordering of dynamic application imports. The observed `Date`, `Math`,
property-reflection, and freeze captures are hypotheses, not an authorized
bulk move: select the smallest coherent deterministic-global trust boundary,
prove which application top-level mutations are observable in genuine Workerd,
and avoid changing deterministic time/random policy or widening into actions.

### `FAC16` Query Module-Evaluation Boundary Preflight Decision

**Accepted:** 2026-08-06

The current checked-in Convex source at
`84fbb0e70b4e857913673871cb847ad11a55f3d5` establishes the UDF global surface
before loading user modules. `udf_runtime.rs` evaluates the bundled setup module
while creating the default V8 snapshot, and `setup.ts` explicitly installs
`Date` plus deterministic `Math.random` before other bundled libraries can
retain the original references. Convex's current UDF phase then owns the
separate import-time policy: time and randomness either come from admitted
preloaded values or fail as `NoDateDuringImport` and `NoRandomDuringImport`.
The reusable principle is setup-before-user-evaluation, not the exact
import-time value policy.

Flarex's three point-mutation Workers already follow that principle for their
explicit dynamic imports. They capture their native platform intrinsics, call
`installExactRuntimeIntrinsics()`, and only then initiate the dynamic execution
bridge and runtime-kernel import expressions. The two point-query Workers do not. Their
`executionModulePromise` and `runtimeKernelPromise` are initiated before the
native `Date`, `Math`, object-reflection, construction, and freeze references
are captured and before `installExactGlobals()` runs. The execution bridge has
static imports of the admitted application modules, so application top-level
evaluation can run across that gap. FAC15's genuine Workerd finding already
proved this scheduling is observable when application code replaced
`globalThis.structuredClone` before the later query-Worker statements ran.

`FAC16` therefore changes only the two query profiles: capture every intrinsic
they already own, initialize their module-time state, install their existing
exact global surface, and then initiate both dynamic imports. This preserves
Flarex's already committed import-time policy—compatibility-date `Date.now()`
and the fixed initial `Math.random()` value—rather than adopting Convex's
current failure policy without a protocol decision. Request admission still
replaces those initial values with the request execution time and seeded RNG
before the handler runs.

The query exact-global implementation remains a backend/Workerd host concern;
it does not move into host-neutral Function API Core merely because two Workers
repeat it. This slice also does not claim parity with the more comprehensive
mutation hardening. Freezing native prototypes, closing inherited `Math`
mutation, expanding unavailable globals, extracting a backend support module,
or unifying query and mutation global installers each changes a larger runtime
surface and requires subsequent evidence. The explicit runtime-kernel import
expression stays beside the execution-bridge import for coherent source order,
but the private application-error platform also imports that trusted kernel
statically. `FAC16` therefore does not claim setup precedes trusted support
module evaluation; its trust claim is specifically that no admitted application
module starts evaluation before the host installs its exact globals.

Rejected alternatives are moving only `Date` and `Math` constants while still
letting user modules evaluate before setup, silently changing import-time time
or random behavior, moving host policy into `@flarex/function-runtime`,
rewriting all five Workers when the mutation profiles are already ordered,
or widening into edge-action globals. No developer API, analyzer operation,
protocol/profile/syscall identity, schema or persistence owner, snapshot or
journal policy, OCC or commit owner, action uncertainty, activation, routing,
or production behavior changes.

The implementation gate is authored/generated ordering agreement for both
query profiles, a genuine Workerd proof that application import-time `Date`
and `Math.random` observe the configured exact globals, unchanged invocation
time/seed behavior, refreshed query Worker and graph identities, affected
regressions, `check:effect-boundaries`, both mandatory exact-final reviewers,
fixes and re-review when needed, and one intentional commit.

### `FAC16` Implementation Receipt

**Completed:** 2026-08-06

Both point-query Worker cores now capture their existing native platform
references and run `installExactGlobals()` before initiating the dynamic
execution-bridge import. The explicit runtime-kernel import expression moves
with it for coherent authored/generated ordering, without changing the trusted
static support graph described above. The application bridge remains the sole
dynamic path from these Worker cores into admitted user modules.

The genuine Workerd regression captures `Date.now()` and `Math.random()` at
application module top level and proves they equal the configured compatibility
date and fixed `0.5` import-time value. Existing scenarios continue to prove
that request admission installs the request execution time and seeded RNG
before handler execution, and the FAC15 hostile `structuredClone` replacement
still cannot forge admitted auth claims. Generated-source assertions pin all
eight existing native captures before setup and setup before both explicit
dynamic import expressions in both query profiles.

The final generated query Worker identities are:

- point query:
  `22d9263a09f5447b9747904e8977da909f52b8c03830437dfdeb96f28854e771`;
- point query/internal call:
  `ba023a3c810c424400f67fecd30721c530f22390c221f10c5e6da343a08f41ca`.

Their final representative graph-basis SHA-256 receipts are point query
`189fa2c681560045a54ae185139be416ad70fb8d2c4443561ebea08ce4eec5e1`
and point query/internal call
`24f0743021925d3c7536062bf2301ddd6a8007625c2c617e8e9c9cf1362014ee`.
Function API Core, all mutation Worker sources, and their graph identities are
unchanged.

Validation passed for both deterministic generated-source checks, backend
build and typecheck, the focused 3 files / 25 tests, the affected 8 files / 59
tests including all five point-runtime Workerd profiles, scoped
`git diff --check`, and `check:effect-boundaries` with zero production
`Effect.runSync` and 56 allowed `Effect.runPromise` sites. Both mandatory
exact-final reviewers reported no findings after independently checking ESM
evaluation order, the limited trusted-static-module claim, configured
import-time and request-time behavior, generated agreement, Effect
applicability, and unchanged transaction and lifecycle owners.

`FAC16` is closed. `FAC17` must begin with a fresh preflight over the two query
profiles' post-install intrinsic integrity. In particular, their frozen `Math`
facade currently inherits from the captured but mutable native `Math`, while
request RNG setup later calls `Math.imul`; application code may be able to
rewrite that inherited operation after setup. The preflight must reproduce or
reject that hypothesis in genuine Workerd, compare the more comprehensive
mutation installer and current Convex isolation, then decide whether the
smallest correct boundary is query-local hardening or one backend-owned shared
exact-global support module. It must not move Workerd host policy into Function
API Core or widen into action behavior.

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
