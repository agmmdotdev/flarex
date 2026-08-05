# Package Boundaries

## Status And Scope

**Status:** Active domain authority.

This roadmap owns the current package and application responsibilities,
dependency direction, public-versus-internal surface rules, runtime-host
placement, and the checks that make those boundaries credible.

It does not own:

- the semantics and sequencing of Standard Application APIs, which belong to
  [`42-standard-application-apis.md`](./42-standard-application-apis.md);
- database authority, schema, OCC, or transaction semantics, which belong to
  [`20-postgres-executor.md`](./20-postgres-executor.md) and the
  [FlarexDB foundation plans](./flarexdb-foundation/README.md);
- deployment analysis and activation sequencing, which belongs to
  [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md);
- sync and cache semantics, which belong to
  [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md); or
- the exact exported API or implemented behavior of a package. Its
  `package.json`, export entrypoints, source, and tests remain authoritative for
  those details.

Package placement is an architectural boundary, not proof by itself. Import
graphs, Worker bundle checks, tests, and deployment proofs must confirm that
host-only or privileged code does not leak into a narrower runtime.

## Current Sources Of Truth

Use these sources in order when they disagree:

1. [`../AGENTS.md`](../AGENTS.md) and the accepted design precedence recorded
   there;
2. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   for authority, trust, replacement, and host boundaries;
3. [`20-postgres-executor.md`](./20-postgres-executor.md) for the trusted
   executor and hosted topology;
4. this roadmap for repository-wide package ownership and dependency rules;
5. package manifests, export entrypoints, source, and tests for current exact
   implementation; and
6. older roadmap checkpoints only as provenance or compatibility inventory.

Decisive current implementation anchors include:

- [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) for workspace membership;
- [`packages/utils/package.json`](../packages/utils/package.json) and
  [`src`](../packages/utils/src) for dependency-free generic primitives;
- [`packages/flarex-protocol/package.json`](../packages/flarex-protocol/package.json)
  and [`src`](../packages/flarex-protocol/src) for transport-neutral contracts;
- [`packages/flarex/package.json`](../packages/flarex/package.json) and
  [`src`](../packages/flarex/src) for the developer SDK;
- [`packages/persistence-postgres/src`](../packages/persistence-postgres/src)
  and [`packages/executor/src`](../packages/executor/src) for trusted storage
  and execution logic;
- [`packages/executor-http/src`](../packages/executor-http/src) and
  [`packages/executor-nitro/src`](../packages/executor-nitro/src) for host
  adapters;
- [`apps/executor/src/worker.ts`](../apps/executor/src/worker.ts),
  [`apps/backend/src/worker.ts`](../apps/backend/src/worker.ts), and
  [`apps/artifact-runtime/src/worker.ts`](../apps/artifact-runtime/src/worker.ts)
  for deployable Worker composition;
- [`packages/flarex-dev/src`](../packages/flarex-dev/src) and
  [`packages/flarex-test/src`](../packages/flarex-test/src) for local tooling
  and tests; and
- [`third_party/trigger.dev`](../third_party/trigger.dev) for the pinned,
  independently installable Trigger.dev compatibility source island; and
- [`scripts/check-effect-boundaries.mjs`](../scripts/check-effect-boundaries.mjs)
  plus app-specific Worker bundle checks for executable boundary enforcement.

## Current Architecture

### Layering And Dependency Direction

The accepted direction is from environment-specific composition toward
portable contracts and cores:

```text
developer application
  -> flarex / flarex-test / flarex-dev

deployable hosts
  -> apps/backend
  -> apps/artifact-runtime
  -> apps/executor

host and environment composition
  -> flarex-backend
  -> @flarex/executor-http
  -> @flarex/executor-nitro         (optional compatibility)
  -> flarex-dev                     (local-only composition)

framework-neutral domain cores
  -> @flarex/executor
  -> @flarex/persistence-postgres
  -> @flarex/freshness
  -> @flarex/analysis

portable developer and wire contracts
  -> flarex
  -> @flarex/standard-application-definition
  -> @flarex/declarative-program
  -> @flarex/declarative-materializer
  -> flarex-protocol

generic dependency leaf
  -> @flarex/utils
```

This is a responsibility diagram, not a claim that every manifest forms a
strict linear chain. `flarex-dev` intentionally composes backend, executor,
persistence, analysis, SDK, and protocol packages for local development.
`flarex-test` intentionally builds on that local runtime. Those broad
dependencies are permitted only for development and test composition; they
must not be copied into production Worker cores.

### Package Ownership

| Workspace member | Current responsibility | Boundary |
| --- | --- | --- |
| `@flarex/utils` | Total, deterministic, domain-neutral primitives proven reusable across independent package owners | Dependency leaf with no runtime dependencies, Effect, Flarex-domain contracts, persistence, host logic, crypto/authority, canonical protocol encodings, or legacy compatibility; exports are explicit subpaths |
| `flarex-protocol` | Shared JSON-safe wire contracts, decoders, identities, manifests, and protocol types | Must remain host-neutral and must not acquire persistence, Worker, Node, or application orchestration |
| `flarex` | Public developer SDK: values, validators, schema, function registration, clients, React, auth, IDs, and artifact-facing types | May use protocol contracts; must not expose backend storage, executor internals, or host configuration |
| `@flarex/analysis` | Portable analysis of developer source/function modules | Consumes SDK/protocol models; backend execution remains authoritative even when local tooling invokes the same analyzer |
| `@flarex/persistence-postgres` | Postgres/PGlite schema, repositories, transactions, storage generations, and database adapters | Owns database mechanics, not function routing, HTTP, Worker lifecycle, or user-code execution |
| `@flarex/freshness` | Non-authoritative freshness projection and read-set freshness logic | May depend on persistence records; cannot become committed app-data authority |
| `@flarex/executor` | Framework-neutral trusted executor semantics, invocation sessions, deployment authority, retries, maintenance, and outbox coordination | May use persistence/freshness and shared contracts; must not own Cloudflare, Nitro, HTTP-server, or connection lifecycle |
| `@flarex/executor-http` | Private Web-standard Fetch routing, request decoding, responses, and backend delivery callbacks | Adapts HTTP to executor capabilities; must not duplicate transaction or business semantics |
| `@flarex/executor-nitro` | Optional Nitro/Vercel compatibility adapter | Wraps the Fetch adapter and must remain replaceable; it is not the hosted production authority |
| `flarex-backend` | Backend-only platform runtime, public backend routing, Durable Object coordination, artifact services, and authoritative analysis composition | No client SDK or app-facing generation APIs; legacy DO app-data storage is removable prototype scaffolding, not replacement authority |
| `flarex-dev` | CLI, Vite integration, source packaging, codegen, push, local Miniflare/runtime materialization, and local executor composition | Local/dev-only composition root; Node and Miniflare capabilities must not enter deployable Worker bundles |
| `flarex-test` | Developer test SDK and harness built on the local runtime | Test-only; must exercise shared runtime behavior rather than define a second production backend |
| `@flarex/backend` (`apps/backend`) | Thin deployable public backend Worker wrapper | Re-exports/composes `flarex-backend`; no independent domain logic |
| `@flarex/executor-worker` (`apps/executor`) | Private Cloudflare executor Worker using service bindings and request-scoped Postgres clients | Owns Worker bindings, authorization-before-allocation, client connect/cleanup, and host wiring; trusted semantics stay in core packages |
| `@flarex/artifact-runtime` (`apps/artifact-runtime`) | Hosted Dynamic Worker materialization and execution-artifact service | Owns Cloudflare Worker Loader/R2/service-binding adaptation; user code receives restricted syscall transports, never raw platform or database capabilities |
| `@flarex/example` (`apps/example`) | Consumer fixture and example application | Behaves like a normal user project; it must not become platform infrastructure or own Flarex Wrangler deployment |
| `third_party/trigger.dev` | Frozen Trigger.dev run-engine and supervisor compatibility source island used as migration input for durable execution | Excluded from the Flarex workspace and runtime graph; it has no Flarex imports, database authority, routing authority, public API, or activation path. Future adoption must use Flarex-owned adapters and preserve the existing Postgres commit authority. |

No `packages/flarex-core` package currently exists. Add another shared package
only when two legitimate owners duplicate a stable, coherent abstraction and
neither existing lower-level package is the correct home. A speculative
“common” package would obscure authority rather than improve it.

### Accepted Planned Durable Task Package

The durable-task preflight accepts one future private package,
`@flarex/durable-task`, with only an
`./internal/run-attempt-v1` export. It will own the host-neutral run-attempt
lifecycle domain, pure policy, typed Effect service, Task System store port,
and domain Layer. Its initial runtime dependency is only the root-catalog
`effect` package.

`@flarex/persistence-postgres` now owns the DTE04-A3 five-table Task System
schema and generated migration plus the DTE04-B scope-bound Task System
lifecycle-store adapter through exact private domain-contract dependencies.
`flarex-backend` will own host composition, durable
effect delivery, and runtime projection adapters. The durable-task package must
not import persistence, Drizzle, Prisma, Redis, Node, Cloudflare, backend, apps,
Trigger packages, or the frozen Trigger source island. It has no package-root,
public protocol, SDK, or host-adapter export.

This package boundary is now admitted by
[`DTE01-G`](./durable-task-engine/preflight/05-final-package-admission.md).
Creation remains sequenced behind the private task identity/scope contract and
the lifecycle adapter checkpoint. The DTE04-A3 schema admission does not
authorize an app/backend dependency, Worker bundle, public export, store
adapter, run creation, discovery, effect delivery, or production route.

The DTE01 package owns run-attempt lifecycle only. The revised DTE02-B contract
uses a first-class canonical Standard Application task catalog with stable
`TaskIdV1`; it does not reinterpret `action`/`internalAction` or function path
as task authority. The task-definition/catalog owner is now admitted and
implemented by DTE04-A2b as
`@flarex/standard-application-definition/internal/task-definition-v1`. It
imports only the run-attempt policy, compute-profile reference, and
definition-revision identity from `./internal/run-attempt-v1`; durable-task
does not depend back on Standard Application or artifact owners. No host or
public surface is activated.

`@flarex/utils` is not a core or common-domain package. A candidate belongs
there only after it is proven to be a stable generic primitive with independent
consumers and no lower-level domain owner. Repeated protocol canonicalization,
persistence codecs, authority logic, Effect contracts, host behavior, and
legacy compatibility remain with their real owners.

### Accepted Standard Definition Package

Roadmap 42 owns one narrow internal package:
`@flarex/standard-application-definition` with the shipped explicit `./v1`
export plus the private DTE04-A2b `./internal/task-definition-v1` export. The
shipped surface composes the existing canonical-program and
declarative-materializer owners for Developer API and internal Test API
producers. The private surface owns only production-inert task definition,
runtime-binding, and creation-authority evidence.

```text
flarex-dev producer --------\
                             -> @flarex/standard-application-definition
backend test producer ------/       -> @flarex/declarative-program
                                      -> @flarex/declarative-materializer
```

The package is not a generic core, public SDK barrel, live harness, analyzer
host, registry, runtime, or persistence owner. Its shipped definition path uses
pure Effect `Result` composition. Its private task-definition path additionally
uses the existing portable private SHA adapter through explicit Effect
operations, but has no service, Layer, runner, Node, Cloudflare, database, or
application dependency. Later Standard stages require their own placement
preflight; they do not automatically accumulate in this package.

The package exposes canonical-program and artifact-materialization stages plus
a combined definition-preparation operation built from those stages. The
backend test producer uses the combined operation. `flarex-dev` uses the two
stages because its graph lowering depends on the normalized program and its
opaque materialization-budget authentication intentionally precedes SDK and
source inspection. SDK inspection, legacy-policy rejection, source-package
rules, and graph construction remain in `flarex-dev`; the Standard package
must not acquire hidden cross-stage policy that only the combined operation
enforces.

The approved `SAA01` typed-authoring mechanics live in the existing `./v1`
export rather than a new package or root barrel. They are pure owned metadata
constructors that emit the exact protocol `ValidatorJsonV1` and canonical
program input shapes. The protocol decoder and validator engine remain the
only runtime authorities. `@flarex/system-test` consumes these mechanics for
typed simulation definitions and references; producer-specific workload,
fault, source, handler-context, and codegen policy remains outside the Standard
package. The public `flarex` SDK remains a separate compatibility surface until
roadmap 09 admits an exact adapter.

### Hosted Runtime Topology

The production execution path is deliberately split:

```text
public backend Worker (`apps/backend`)
  -> backend package and coordination services
  -> artifact-runtime Worker (`apps/artifact-runtime`)
  -> managed Dynamic Worker running developer modules
  -> private executor service binding
  -> executor Worker (`apps/executor`)
  -> cache-disabled Hyperdrive / Postgres
```

The Dynamic Worker may call a narrow syscall or invoke transport. It must not
receive a database client, persistence interface, deployment-control
capability, arbitrary service binding, or raw storage handle.

The O03-A transaction-grant boundary follows the same ownership split. O03-A1
places only strict inert Ed25519 flattened-JWS wire/canonical-evidence contracts
behind the explicit `flarex-protocol/transaction-grant` subpath; it is not a
package-root, SDK, server, executor, or Worker-app re-export. O03-A2a's upstream
credential verification and process-local `VerifiedAuthContext` authenticity
capability are backend-owned and are never persisted or transported.
Completed O03-A2b keeps issuance/signing and policy authority backend-private
and exposes trusted grant verification only through the
`@flarex/executor/transaction-grant` leaf. Corrected O03-A2c adds independent
backend- and executor-owned opaque preparation capabilities plus the located
current-epoch check; signature/pin/epoch admission returns the final executor-
owned capability for O03-B. Core preparation handles stay in backend/executor,
while backend-only transport, checked revocation, and Worker key/binding wiring
move to their later operational/hosted consumers. The schema-neutral kernel may
use immutable seeded metadata in private tests, but its production adapter must
consume roadmap 17 plus S03-D4/S04's coherent active package/artifact/source/
function-validator/schema snapshot and activation fence. O03-B remains the
owner of session atomics. Worker apps never own grant semantics or expose
issuer secrets to artifact code.

The executor Worker owns Cloudflare request lifecycle and Postgres client
allocation/cleanup. `@flarex/executor` owns the trusted operation semantics,
and `@flarex/persistence-postgres` owns transaction/database behavior. This
separation prevents local, Nitro, Fetch, and Worker hosts from developing
different correctness rules.

### Local And Test Topology

Local development and tests reuse the same SDK, analysis, executor, persistence,
backend runtime, and generated execution-artifact contracts. `flarex-dev` may
compose them in-process with Miniflare and PGlite for speed. `flarex-test`
builds on that composition rather than maintaining a fake backend.

Local analysis is fast feedback. Backend-controlled analysis inside the
execution isolate remains authoritative for deployed function paths, kinds,
visibility, validators, schema, and source positions. Package reuse does not
change that trust rule.

## Invariants And Trust Boundaries

1. **One behavior owner per concern.** Hosts adapt capabilities; they do not
   fork executor, persistence, analysis, validation, or protocol semantics.
2. **Dependencies point inward.** Portable contracts and cores cannot import
   deployable apps, local tooling, tests, Node-only collectors, or
   Cloudflare-specific composition.
3. **Applications are composition roots.** A package must never locate or
   import source from `apps/*`. Shared behavior moves into the correct package
   and apps import it through declared exports.
4. **The SDK is not the backend.** `flarex` contains developer-facing APIs and
   portable contracts, not database handles, service bindings, platform
   credentials, or deployment implementation.
5. **The backend is not the SDK.** `flarex-backend` and Worker apps remain
   backend-only. Client APIs, codegen, and Vite behavior belong to `flarex`,
   `flarex-dev`, and `flarex-test`.
6. **Postgres is authoritative.** Legacy Durable Object app-data paths in
   `flarex-backend` are prototype/regression inputs. Their package location does
   not promote them to the accepted target or create a migration obligation.
7. **Transactions stay below hosts.** Database transaction helpers own
   `BEGIN`, `COMMIT`, and rollback. No host holds a transaction open while
   untrusted developer code executes.
8. **User code gets least authority.** Generated Dynamic Workers receive only
   explicit, authenticated transports and serializable configuration.
9. **Protocols are explicit.** Cross-package or cross-Worker data uses shared,
   validated contracts rather than importing implementation types through
   internal file paths.
10. **Public exports are intentional.** Importers use declared package export
    paths. A new export is an API decision, not a shortcut around ownership.
11. **Runtime-specific code stays at the edge.** Node filesystem/process/Git
    logic stays in CLI or operator tooling. Cloudflare bindings stay in Worker
    apps or explicit host adapters.
12. **Proof tooling separates purity from privilege.** Deterministic evidence
    contracts, canonicalization, joins, and verification remain separate from
    credentialed Cloudflare/Postgres collection and destructive teardown.
13. **Effect execution is audited.** Production `Effect.runPromise` calls are
    explicit boundary sites; `Effect.runSync`, hidden aliases, and unreviewed
    runtime entrypoints are prohibited by the repository check.
14. **Placement requires executable proof.** Typechecks catch type/import
    drift; focused tests prove semantics; bundle gates prove deployable graphs;
    real-Postgres and hosted gates prove boundaries that local structure cannot.

## Decisions And Rationale

### Reuse One Runtime Instead Of Building Dev And Test Fakes

The backend implementation lives in `flarex-backend`; the public backend app
is a thin wrapper; local development and tests reuse package code through their
own composition roots. This keeps behavior aligned while allowing environment
adapters to differ.

### Keep The Trusted Executor Framework-Neutral

`@flarex/executor` and `@flarex/persistence-postgres` are the forward trusted
core. `@flarex/executor-http`, `@flarex/executor-nitro`, and `apps/executor`
adapt that core to Fetch, Nitro, or Cloudflare. This makes transaction and
retry behavior testable without a hosted Worker and prevents host frameworks
from becoming architectural authorities.

### Keep Compatibility Adapters Until Their Exit Gates Pass

The HTTP and Nitro paths remain useful compatibility and local-test surfaces.
They must not be retired merely because the private Worker is the accepted
host. Retirement requires the Worker/Hyperdrive bundle and real-Postgres
correctness gates plus migration of every remaining caller.

### Treat Development Tooling As A Privileged Composition Layer

`flarex-dev` legitimately depends on many internal packages because it builds,
analyzes, pushes, generates, and starts a local system. That privilege is
bounded to developer processes. It is not permission to publish internal
executor/persistence APIs as developer SDK surface or to bundle Node tooling
into Workers.

### Keep Hosted Proof Contracts Pure

H05 evidence types, canonical serializers, dependency joins, hash derivation,
and final verification live under the executor app's pure proof boundary.
Credentialed API calls, filesystem/Git inspection, provider-envelope
projection, and teardown remain operator-side scripts. These are internal
application tools, not package exports or runtime capabilities.

## Convex Compatibility And Flarex Divergences

Flarex follows Convex's package-level mental model:

- developers author ordinary TypeScript functions against a public SDK;
- generated APIs and codegen serve developer ergonomics, not deployment-host
  ownership;
- local development orchestrates the real backend behavior rather than a
  separately designed mock;
- backend-controlled analysis and execution remain authoritative; and
- persistence and transaction details stay behind trusted backend interfaces.

Primary Convex reference areas are recorded in
[`13-convex-first-system-porting.md`](./13-convex-first-system-porting.md),
especially `npm-packages/convex/src/server`, CLI dev/codegen modules,
`crates/application`, `crates/function_runner`, and `crates/database`.

Necessary Flarex divergences are narrow and named:

- Cloudflare requires separate public backend, artifact-runtime, Dynamic
  Worker, and private executor boundaries connected by service bindings;
- Postgres and Hyperdrive require explicit client lifecycle and adapter
  packages, while PGlite provides the local fast lane;
- managed Dynamic Workers are generated platform artifacts even though the
  developer writes only modules under `flarex/`;
- Cloudflare control-plane and observability evidence currently requires
  local privileged collectors, so proof contracts and collectors are separate;
  and
- Nitro remains an optional compatibility host, not a Convex requirement or
  the Flarex production authority.

These differences must remain adapters and capability boundaries. They are not
reasons to expose infrastructure to developers or weaken Convex-style runtime
semantics.

## Implemented Capabilities

- Every current package and app has a declared workspace manifest and builds
  through package exports rather than reaching into an app source tree.
- The SDK exposes separate browser/client/React/server/validator/value entry
  points while keeping backend and persistence packages out of its dependency
  graph.
- The backend Worker app is a thin export wrapper over `flarex-backend`.
- Backend connection, delivery, scheduler, and execution route errors retain
  domain-owned operation unions and tagged classes while sharing one
  backend-local operation/status/message/cause facet, default foreign-cause
  classification, and `HttpError` projection. Specialized transaction adapter
  preservation and legacy partition routing remain local.
- Backend HTTP owns the exact structural projection from a message-bearing
  typed request error to status 400. Domain-named adapters delegate that
  projection while retaining tag-specific status or message policy, defensive
  unexpected-error fallbacks, and their Effect failure channels.
- The private executor Worker composes the framework-neutral executor, Fetch
  adapter, Postgres client adapter, and Cloudflare request lifecycle.
- The artifact-runtime Worker owns Worker Loader, R2, and executor service
  binding integration without moving those capabilities into the SDK or
  executor core.
- Local development composes analysis, source packaging, generated artifacts,
  backend runtime, executor, persistence, and Miniflare from `flarex-dev`.
  Its execution-artifact analysis-error owner also owns the exact pure
  message/diagnostics projection reused by local and HTTP response adapters;
  their distinct response tags and transport evidence remain with each
  adapter. The materializer likewise owns its exact message/status projection
  from typed response errors into the compatibility `Error` consumed by its
  Promise methods, while the source tags, bodies, and decoders remain distinct.
  Flarex-dev also owns its message-only projection from unknown adapter
  exceptions; stack, diagnostics, causes, redaction, and generated-source
  formatting remain with their narrower boundaries.
- `flarex-test` reuses the local runtime surface.
- Fetch and Nitro adapters share the same executor core; Nitro is a thin
  wrapper over the Fetch adapter.
- H05 proof code separates pure evidence contracts from Node collectors and
  destructive teardown, and deployable bundle checks guard that separation.
  Its Node entry scripts share required environment-value policy locally:
  identifiers and configuration values are trimmed, secret tokens retain their
  exact spelling, and this host policy stays out of `@flarex/utils`. The same
  host-local boundary owns canonical outside-worktree evidence input and output
  mechanics, including real-path resolution, regular-file and size checks, and
  atomic no-replace publication. Individual commands retain their evidence
  labels, byte ceilings, and diagnostics. H05 Cloudflare REST adapters also
  share one host-local pure decoder for the provider success envelope while
  retaining endpoint result validation, redacted messages, and public result
  projections in each adapter. H05 manual evidence decoders share the exact
  two-timestamp window traversal while retaining format-owned record policy,
  timestamp brands, diagnostics, first-failure order, and serialized key
  order; Schema-composed receipt decoding remains on its Schema boundary.
- The Effect boundary checker rejects synchronous execution, hidden aliases,
  direct runtime imports, and unregistered production `runPromise` sites.
- Postgres and PGlite adapters share one persistence-owned resolver for the
  bundled Drizzle migration tree. It resolves from package module location so
  installed consumers do not depend on their current working directory;
  explicit folder overrides and adapter-specific migrator options remain with
  each adapter.
- Persistence raw-SQL consumers share one package-local adapter for installed
  Drizzle 0.45's `{ rows: array }` raw `execute` result. Callers retain their
  exact invalid-result errors, while row detachment and domain decoding remain
  separate. The adapter returns the rows array by identity, reads it once, and
  preserves property-access exceptions. A formerly duplicated direct-array
  branch was removed because no supported producer was identified. This is
  neither an `@flarex/utils` primitive nor a public persistence subpath.
- Stable table and logical-index catalogs share package-local pure `Result`
  mechanics for nonblank input text and protocol `CatalogTableId` decoding.
  Each catalog retains its tagged field failures and `Result.gen` validation
  order; namespace and logical-index-ID rules remain with their sole owners.
  These input adapters map only protocol Schema parse failures rather than
  broadly reclassifying unexpected decoder defects. The shared table-ID helper
  remains outside `@flarex/utils` because it depends on Effect and protocol
  policy.
- Pure protocol payload, backend storage-state, and executor HTTP request
  normalizers that intentionally retain validation as data use one
  domain-local Effect v4 `Result` decoder. Multi-field HTTP decoders use
  `Result.gen` to preserve field-read and first-failure order. They enter the
  Effect error channel once through `Effect.fromResult` and do not maintain
  parallel ad-hoc result unions or result-to-Effect adapters.
  Unused backend throwing wrappers were removed; `Result.getOrThrow` is reserved
  for an explicit unchecked API with a concrete supported compatibility
  consumer, not one inferred from existing code or tests.
- Backend live-query and scheduler response payloads share one package-local
  Effect decoder factory for exact structural primitives. Each domain retains
  its operation union, messages, and tagged failure construction; the factory
  remains outside `@flarex/utils` because that dependency leaf cannot own
  Effect adapters or backend response policy.
- `apps/runtime-topology-probe/src/strictSchemaOptions.ts` owns the probe's
  exact excess-property policy for Effect Schema struct annotations and
  unknown-input decoder calls. This is app-local wire policy rather than a
  generic utility; keeping the two option surfaces explicit prevents protocol
  modules from drifting between strict and permissive decoding.
- `packages/flarex-protocol/src/strict-schema-options.ts` similarly owns the
  protocol package's internal strict excess-property policy across commit,
  transaction-grant, point-mutation, schema-manifest, storage-authority, and
  index contracts. It is intentionally not a public package subpath: callers
  consume the owning protocol decoders rather than selecting parse policy.
- `@flarex/utils/records` owns shallow non-null, non-array object narrowing as
  both a predicate and nullable adapter. It deliberately does not promise a
  plain prototype, JSON membership, symbol-key rejection, or runtime
  mutability. Protocol request and host-payload decoders, backend live-query
  and scheduler response decoders and delivery guards, deployment metadata,
  executor metadata, persistence authority, importable H05 evidence/Worker/
  collector modules, and ordinary importable test modules reuse it without
  mutable-record assertions. Backend traversal and placement logic whose input
  is already Flarex `Json` uses the protocol-owned `isJsonObject` or
  `isWritableJsonObject` discriminator instead of treating JSON membership as
  a generic record concern. Backend live-query and scheduler HTTP readers keep
  successful response bodies as `unknown`; their domain payload decoders are
  the only typed-success authority rather than an unconstrained caller-chosen
  generic.
  Stricter canonical, domain object, and writable fixture guards retain their
  owners and may delegate only the shallow record step, while standalone
  generated source keeps the smallest equivalent local predicate because it
  cannot import a workspace package at runtime. Test-only consumers declare a
  development dependency instead of widening their production graph.
- `@flarex/utils/strings` owns the tested ECMAScript UTF-16 string comparator
  reused by protocol canonicalization, deterministic ordering, executor
  stored-attempt verification, and persistence journal canonicalization paths,
  plus distinct primitive nonempty- and nonblank-string classification. The
  nonempty predicate requires one UTF-16 code unit and deliberately accepts
  whitespace-only strings, null bytes, zero-width characters, and unpaired
  surrogates. The nonblank predicate uses exact ECMAScript `trim` semantics.
  Neither predicate normalizes its input or implies Unicode, UTF-8 size,
  PostgreSQL/JSON, identifier, secret, or branded text policy; those checks
  and failures remain local.
  Unknown-object consumers must also preserve property access and hostile
  getter behavior. The auth-provider structural guard remains local until its
  accessor policy deliberately adopts a single-read snapshot; Schema-decoded
  owned values and decoders that already snapshot a property may reuse the
  generic predicate without crossing that boundary.
  Narrower ordered-index comparators retain their domain-significant names.
- `@flarex/utils/strings` also owns the exact lowercase hexadecimal
  8-4-4-4-12 UUID text-shape predicate shared by protocol identifiers and the
  Postgres commit-wake claim owner. It does not enforce UUID version or variant
  bits, generate identifiers, attach brands, or establish authority. Protocol
  `V1` naming and hex conversion remain with `flarex-protocol`, while
  persistence retains its Schema message, validation order, brand, and typed
  failures.
- `@flarex/utils/numbers` owns total positive- and non-negative-safe-integer
  predicates used across independent protocol, executor/H05, and persistence
  owners. The non-negative predicate preserves JavaScript's acceptance of
  negative zero. Domain decoders keep their own error messages, upper bounds,
  integer-but-not-safe contracts, signed ranges, timestamps and durations,
  brands, and typed failures; sharing the primitive does not make those numeric
  contracts interchangeable.
- `flarex-protocol/iso-timestamp` owns the pure canonical ECMAScript
  parse-and-round-trip predicate shared by H05 evidence and point-session
  terminalization. It accepts extended-year `Date.prototype.toISOString()`
  spellings but does not own brands, diagnostics, ordering, freshness, expiry,
  or clock authority. Transaction grants retain their stricter four-digit-year
  wire grammar rather than weakening it for reuse.
- `@flarex/utils/bytes` owns tested defensive copying into an owned
  `Uint8Array` or fresh exactly-sized `ArrayBuffer`, ordinary early-exit byte
  equality, a separately named equal-length full-scan comparison, and lowercase
  hexadecimal encoding of a visible byte range. Copies and encoding inspect
  only that visible range. Hex encoding uses the intrinsic typed-array iterator
  so caller overrides cannot substitute other bytes, and it preserves the
  platform `TypeError` for detached views instead of silently treating a
  formerly non-empty view as empty. Representation choice, branded validation,
  hashing, and named evidence capture remain with their domain owners. The
  full-scan primitive preserves evidence/authentication behavior but explicitly
  makes no cryptographic constant-time claim; callers keep the algorithm their
  boundary already required. Iterable or number-array adapters retain their
  local representation owner, and Flarex canonical decoders retain length,
  case, re-encoding, branding, and typed failure policy.
- Ordered-index key encoding is a serialized FlarexDB protocol contract, not a
  generic byte or collection utility. `flarex-protocol/ordered-index` is the
  accepted `flarexdb_v1` owner for physical specs, Flarex-value lowering,
  bounded canonical keys and bounds, and separate row identity. The similar
  encoders in backend `PartitionDO`, persistence `indexEntries`, and the
  executor's `legacy_v1` overlay are isolated unshipped-prototype behavior
  evidence. Do not extract or bridge them through `@flarex/utils`, and do not
  make the target codec accept their weaker shapes merely to deduplicate code.
  Port still-intended tests and behavior to the target path, then delete those
  prototype implementations at their recorded retirement gate; reclassify only
  if evidence of a shipped compatibility obligation appears.
- Promise compatibility for identity-access-policy canonicalization remains a
  protocol contract. Its protocol-owned Effect adapter preserves the existing
  typed policy error while treating unexpected Promise causes as defects;
  issuer and verifier consumers reuse that adapter and translate only its typed
  error channel.
- Inert transaction-grant evidence derivation follows the same protocol-owned
  adapter rule: issuer and verifier reuse its Effect operation, consumers may
  translate the typed protocol failure, and unexpected causes remain defects.
- Partition-selector naming is serialized Flarex routing metadata, not a
  generic casing utility. `flarex-protocol/partition-selector` owns the current
  `_id` special case, ASCII segment normalization, and empty-suffix fallback;
  analysis, codegen, backend validation, and executor invocation share that
  derivation while retaining their own validation errors and messages.
- The transaction-grant protocol owns the inclusive epoch bounds representable
  by its four-digit-year canonical timestamp wire format, plus the epoch,
  positive-duration, and non-negative-duration predicates used by issuance and
  verification. Applying those bounds to grant clocks, lifetimes, and skew is
  domain policy rather than a generic numeric utility; issuer and verifier
  configuration errors remain with their consumers. The shared predicates
  reject non-numbers before relational comparisons and therefore do not invoke
  caller-controlled coercion.
- `flarex-protocol/canonical-base64url` owns the shared non-empty unpadded text
  Schema and pure bounded decoder. It delegates general encoding and decoding
  to Effect `Encoding`, then re-encodes to prove the unique canonical spelling.
  Commit evidence and transaction grants supply their own byte ceilings and
  retain their brands, JWT or evidence policy, and typed failure mapping.
  This canonical protocol policy stays outside `@flarex/utils`; source strings
  that intentionally execute without package imports retain a bounded local
  encoder.
- `flarex-protocol/connection` owns sync client and server wire types plus
  structural runtime decoding. Backend connection code consumes those
  contracts directly. The SDK derives its narrower outbound and supported
  inbound subsets, while its argument-normalization helper remains local. The
  published backend test protocol entrypoint is a deprecated compatibility
  facade that re-exports protocol-owned names rather than defining another
  wire contract.
- `flarex-protocol/validator-json` owns the readonly `ValidatorJsonV1` wire
  type and structural Schema. Backend and Postgres persistence retain their
  published `ValidatorJson` names as direct type aliases, and backend storage
  decoding returns that protocol-decoded value without recursively cloning it.
  Backend and persistence path/error adapters remain local because their
  failure contracts differ. The protocol Schema owns the shared non-empty ID
  table-name invariant, and every validator field-map consumer treats all
  string keys as own data properties rather than inherited names. The SDK's
  developer-side `ValidatorJSON` remains separate while it represents bigint
  literals and other non-JSON runtime validation semantics that are not an
  exact wire-contract duplicate.
- `flarex-protocol/commit-protocol` owns the logical app-write document-field
  JSON Schema. The persistence journal reuses that exact Schema while retaining
  its stored syscall envelope, database corruption mapping, and row-validation
  boundary; this domain contract does not belong in `@flarex/utils`.
- `flarex-protocol/value` owns the strict Value Codec V1 envelope type, guard,
  and Schema. Commit-result and transaction-grant decoding reuse that
  structural contract while retaining their own byte ceilings, canonical-byte
  comparison, digest evidence, and typed protocol errors. The envelope remains
  a protocol codec contract rather than a generic utility.
- `flarex-protocol/json` owns the canonical readonly JSON shape, its finite
  plain-value guard and Schema, and one documented writable compatibility
  shape. The SDK aliases its readonly `JSONValue` to that owner; live-query,
  executor, backend, and legacy Postgres persistence retain their published
  writable names as aliases.
  Executor HTTP delegates JSON membership to the protocol guard while keeping
  its domain error adapter. The protocol JSON module also owns array- and
  object-member discrimination after JSON validation, plus an unknown-input
  guard that validates the full value before exposing the writable JSON object
  compatibility shape. That narrowing does not promise runtime mutability. The
  Postgres persistence boundary decodes staged-write JSONB rows once into an
  operation-discriminated record; malformed JSON and invalid operation/value
  combinations fail as storage corruption before executor document views.
  The module owns the shared structural equality contract without canonical
  JSON text allocation, plus deterministic JSON text encoding used by value,
  schema-manifest, commit evidence, SDK query tokens, and executor/backend
  live-query fingerprints.
  JSON equality ignores object key order and treats negative and positive zero
  alike. Sparse arrays are outside the shared JSON contract. Query-token and
  fingerprint names plus invariant-failure adapters remain domain-local. The
  SDK argument normalizer also remains local because it deliberately omits
  `undefined` object fields before encoding while preserving valid keys such as
  `__proto__` as own data properties. Unknown-input adapters and
  database-shaped comparators, writable legacy narrowing, domain-specific
  normalization, limits, hashing, evidence construction, and failure mapping
  remain with their owners. Backend adapters use one backend-owned boundary to
  detach readonly protocol JSON into the writable backend representation.

## Known Gaps And Limitations

- No general package-import DAG checker currently enforces all ownership rules.
  Manifest review, TypeScript resolution, focused tests, and app bundle scripts
  provide partial enforcement, but a forbidden dependency could otherwise be
  introduced accidentally.
- `flarex-backend` still contains legacy Durable Object storage and routing
  code alongside forward platform coordination. Replacement must prevent that
  ownership from leaking into new Postgres work, port intended semantics, move
  callers, and delete the prototype path after target-only proof.
- The SDK does not yet own an action-request lifecycle, so it deliberately
  rejects protocol-valid `ActionResponse` messages even though the shared wire
  contract and backend support that variant.
- `@flarex/persistence-postgres` exports both broad compatibility surfaces and
  narrower runtime-specific entrypoints. Further narrowing should follow real
  internal caller migrations; broad prototype surfaces are not permanent APIs.
- `flarex-dev` is intentionally broad and therefore a high-risk leak point.
  New deployable imports require bundle proof that Node, Miniflare, CLI, and
  local database composition remain excluded.
- The HTTP and Nitro compatibility adapters cannot be removed until all callers
  and correctness gates have migrated to the private Worker path.
- Backend-authoritative analysis, push, artifact activation, and final codegen
  cross several packages. Their precise ownership and remaining gaps are still
  being compacted in [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md).
- H05 source and bundle separation is implemented, but a successful hosted
  proof still depends on external Cloudflare/Postgres resources and evidence.

## Target Direction

Preserve a small public SDK and protocol base, a framework-neutral trusted
executor/persistence core, explicit host adapters, and thin deployable apps.
Move behavior only when its authority is clear; do not create packages merely
to reduce file size or hide a cyclic design.

The replacement should progressively shrink and then remove the authoritative
role of legacy Durable Object and initial-Postgres app-data code after target
parity, internal-caller migration, and hosted correctness gates pass. Backfill,
comparison, cutover, and runtime rollback are conditional on shipped evidence,
not package existence. Local development and tests should exercise the same
accepted Standard Application APIs and core contracts as production while
keeping privileged composition outside Worker bundles.

## Next Correctness Gates

1. **Expand the repository package-dependency boundary check.** Roadmap 42
   `SAP01-D` now machine-enforces the implemented Standard definition package's
   direct manifest, export, and production-import boundary. Expand deliberately
   to the remaining forbidden directions in this roadmap, allow the deliberate
   `flarex-dev`/`flarex-test` composition exceptions, test the complete graph
   policy, and run it in the normal validation path.
2. **Compact deployment-analysis ownership.** Make roadmap 17 state exactly
   which package owns local feedback, backend-authoritative analysis, push,
   activation, artifact materialization, and final codegen.
3. **Keep new FlarexDB work on the trusted core path.** Each foundation slice
   must place database mechanics in persistence, trusted orchestration in the
   executor, and runtime lifecycle only in adapters/apps, with PGlite and
   real-Postgres evidence appropriate to the change.
4. **Prove production graph isolation continuously.** Executor and artifact
   runtime bundle gates must fail when local tooling, Node collectors,
   compatibility routers, migration composition, or raw database authority
   enters a narrower Worker graph.
5. **Retire surfaces according to their real obligation.** Inventory remaining
   HTTP/Nitro consumers separately from legacy app-data and broad persistence
   callers. Host adapters remain until caller and host-parity evidence permits
   removal. Unshipped app-data prototypes remain only until target package,
   bundle, real-Postgres, recovery, and internal-caller gates pass; they do not
   wait for an artificial data migration.
