# Application Analysis Migration

## Status And Scope

**Status:** Accepted focused execution plan. The docs-first preflight is
complete and self-reviewed. Implementation is authorized through `AA-R8` and
must stop before `AA-R9` production cutover.

This plan owns the ordered replacement of the private Declarative V2 static
verifier with Application Analysis. It coordinates the existing analysis,
artifact, Standard Application, persistence, readiness, activation, runtime,
and test owners. It does not create a new analysis package, a new transaction
or commit path, a public route, a production binding, or a second authority for
one candidate.

Roadmap 17 remains the domain authority. This file owns the challenged
inventory, accepted contract cut, migration sequence, and exit criteria.

## Current Sources Of Truth

- [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md)
  owns the Application Analysis direction and `AA-R0` through `AA-R9`.
- [`../packages/analysis/src/index.ts`](../packages/analysis/src/index.ts)
  contains the portable runtime-registration inspection that the replacement
  should reuse.
- [`../packages/flarex-dev/src/executionArtifact.ts`](../packages/flarex-dev/src/executionArtifact.ts)
  proves cold module evaluation, import-time capability restriction, and
  repeated-analysis comparison locally, but does not provide hosted authority.
- [`../packages/flarex-backend/src/sourceArtifactV2/FinalizedContentReader.ts`](../packages/flarex-backend/src/sourceArtifactV2/FinalizedContentReader.ts)
  reads authenticated finalized Source Artifact V2 module bytes.
- [`../packages/standard-application-analysis/src/v1.ts`](../packages/standard-application-analysis/src/v1.ts)
  exposes the current historical static-verifier result. It must not be
  reinterpreted as the replacement result.
- [`../packages/persistence-postgres/src/applicationRevisionRegistrationV1.ts`](../packages/persistence-postgres/src/applicationRevisionRegistrationV1.ts),
  [`../packages/persistence-postgres/src/applicationRevisionReadinessV1.ts`](../packages/persistence-postgres/src/applicationRevisionReadinessV1.ts),
  and
  [`../packages/persistence-postgres/src/applicationRevisionActivationV1.ts`](../packages/persistence-postgres/src/applicationRevisionActivationV1.ts)
  own the current persisted registration, readiness, and activation contracts.
- [`43-first-flarexdb-system-api-vertical.md`](./43-first-flarexdb-system-api-vertical.md)
  and roadmaps 44 through 48 own the private runtime consumers that must be
  reproven after migration.
- [`durable-task-engine/preflight/08-application-revision-and-runtime-binding.md`](./durable-task-engine/preflight/08-application-revision-and-runtime-binding.md)
  owns the current task binding. Its V1 contract embeds old candidate,
  artifact, source-root, and semantic-root identities and therefore cannot be
  silently reused.

When these sources disagree, roadmap 17 and this accepted replacement plan own
the target. Existing code and exact V1/V2 codecs remain authoritative for the
old generation until their consumers and preservation duties are removed.

## Preflight Findings

### Reusable implementation

`@flarex/analysis` already has a small useful core. Given loaded execution
module namespaces and an optional loaded schema definition, it identifies
registered Flarex functions from runtime markers, treats handlers as opaque,
normalizes function and schema metadata, sorts deterministically, and returns
typed semantic failures.

The local Miniflare adapter already evaluates a fresh exact source package,
restricts import-time effects, disposes the isolate, and runs analysis twice to
detect registration nondeterminism. These are implementation references, not
new contracts or hosted evidence.

### Displaced implementation

The old generation spans substantially more than one analyzer file:

- `@flarex/analysis` private grammar, parser, linker, ABI, call-graph,
  progress, evidence, release, and verifier ports;
- the analyzer app's verifier HTTP and restart host;
- backend source/semantic read sessions, command production, dispatch, and
  evidence collection;
- executor HTTP verifier transports;
- Standard Application Analysis's exact registration-complete alias;
- Postgres verifier attempt, command, authority, evidence, candidate,
  application-revision, verdict, runtime-publication, readiness, and activation
  relationships; and
- system tests and private runtime target codecs that bind the old digests.

Removal is therefore a consumer migration, not deletion of
`declarativeV2VerifierV1.contract.ts` in isolation.

### Source Artifact V2

Source Artifact V2 already records immutable module source bytes, module path,
role bits, source digest, and the unique execution/schema/auth paths. The
replacement may reuse that exact generation without changing its codec or root
identity. The first manifest does not require source-map content or source
positions.

The existing finalized-content reader is coupled to old verifier budget handle
types. `AA-R4` must give the reader an analysis-neutral bounded-read interface
or a narrow adapter. Reusing Source Artifact V2 does not authorize reusing the
verifier's progress or budget protocol.

### Semantic Artifact V1 is not yet orphaned

Semantic Artifact V1 is the old verifier's declaration stream, but its root is
also embedded in current candidate-bound mutation, query, internal-call, and
edge-action runtime-target contracts. `TaskDefinitionRuntimeBindingV1` and its
durable Postgres rows also commit the semantic root.

Consequently `AA-R8` may stop producing Semantic Artifact V1 only after new
runtime-target and task-binding contract generations are active for the new
application revision generation. Old V1 bytes and rows must remain decodable
until their preservation inventory is empty. A new field with the same spelling
but a manifest digest is forbidden; that would reinterpret a concrete digest.

### Current Standard definitions are not cold-load authoritative

The current Standard definition separates canonical declared metadata from a
prebuilt module graph. Several private fixtures contain plain handler exports
or placeholder values, and the materializer rejects schema and auth modules.
Cold-loading those JavaScript bytes cannot discover the declared function
kind, visibility, validators, schema, or indexes.

The replacement must therefore migrate the private Standard producer and
fixtures to an executable registration bundle. Its execution module must export
the real registered function map, and its optional schema module must export
the real schema definition. The analyzer observes those loaded values. It must
not consult Canonical Declarative Program V1 or Semantic Artifact V1 as a hidden
second metadata authority.

Canonical Declarative Program V1 and the old materializer remain readable
compatibility contracts during migration. Their broader retirement is outside
this plan unless `AA-R8` proves they have no consumer after the analysis
migration.

### Persistence is a new generation

The current `fx_system_application_revision_v1` row and readiness receipt bind
the verifier attempt, verifier receipt, registration frames, and static-derived
runtime publication. Current verdict and activation rows also bind those
identities. They cannot be renamed or populated with new meanings.

The replacement needs additive application-named persisted contracts. Exact
DDL is owned by `AA-R5`, but the following are mandatory:

- a backend-issued application candidate identity bound to one Source Artifact
  V2 root;
- one analysis row with `pending -> analyzed | rejected` terminal settlement;
- exact canonical manifest and receipt bytes plus their SHA-256 digests;
- an application revision generation that references the new candidate and
  accepted analysis rather than an old verifier attempt;
- application-named runtime publication, readiness, and activation generations
  wherever the old row identity or canonical receipt changes; and
- no foreign key from a new generation to an old verifier, Semantic Artifact,
  declarative candidate, verdict, or activation table.

The repository currently has no configured PostgreSQL URL for named-environment
row inspection. Repository ownership describes these paths as private and
unshipped, but that does not prove every external database is empty. Additive
implementation may proceed. Destructive `AA-R8` migrations must refuse
nonempty or referenced old state, and `AA-R8` cannot complete its genuine
PostgreSQL retirement proof until an explicit test database is available.

### Runtime publication becomes whole-bundle publication

The static verifier currently derives minimal execution groups from a static
call graph. Application Analysis will not reproduce that graph. The first
replacement publishes the admitted immutable application module graph for each
required runtime group and selects a function entry by manifest path. Function
kind determines the group; the runtime host still determines capabilities.

Transaction and edge-action workers may therefore receive the same code graph
while receiving different bindings, outbound policy, syscalls, and execution
lifetimes. This is simpler and predictable. If the whole-bundle form exceeds a
measured Worker Loader or R2 ceiling, the implementation stops with evidence;
it does not restore static JavaScript analysis inside `AA-R6`.

## Accepted Contracts

### `ApplicationManifestV1`

`ApplicationManifestV1` is canonical UTF-8 JSON with a single exact field set:

```ts
interface ApplicationManifestV1 {
  readonly format: "flarex.application-manifest";
  readonly version: 1;
  readonly sourceArtifact: {
    readonly rootSha256: LowercaseSha256;
    readonly executionModulePath: string;
    readonly schemaModulePath: string | null;
    readonly modules: ReadonlyArray<{
      readonly path: string;
      readonly roles: number;
      readonly sourceSha256: LowercaseSha256;
      readonly sourceByteLength: number;
    }>;
  };
  readonly schema: ApplicationSchemaManifestV1;
  readonly functions: ReadonlyArray<{
    readonly path: string;
    readonly moduleName: string;
    readonly exportName: string;
    readonly kind: "query" | "mutation" | "workflowMutation" | "action";
    readonly visibility: "public" | "internal";
    readonly args: ValidatorJsonV1;
    readonly returns: ValidatorJsonV1 | null;
    readonly partition: ApplicationFunctionPartitionV1 | null;
  }>;
}
```

The schema and partition shapes reuse the already accepted Flarex deployment
semantics through analysis-owned types; they do not import the old verifier or
Semantic Artifact codecs. Modules sort by canonical path. Tables, indexes, and
functions use the existing deterministic analyzer order. Object keys have one
encoder-owned order. Duplicate function paths, duplicate module paths, missing
runtime entries, invalid registration markers, invalid validators, and invalid
schema relationships fail before encoding.

The exact first runtime entry is the manifest's execution module path plus the
function's module name and export name. The runtime loads that execution
module's default registration map and selects the same nested entry inspected
by analysis. It does not infer which dependency module originally defined the
handler.

Source positions, diagnostics, auth configuration, static references, call
edges, ABI sites, verifier arenas, progress cursors, parser state, and runtime
capabilities are not manifest fields. Auth remains unsupported in the private
replacement and is an explicit `AA-R9` production-cutover prerequisite.

### `ApplicationAnalysisReceiptV1`

The backend, not evaluated application code, creates the receipt. It is a
canonical tagged union with common fields:

- format `flarex.application-analysis-receipt`, version `1`;
- backend-issued analysis ID and candidate ID;
- trusted scope ID and Source Artifact V2 root;
- exact analyzer identity and policy identity;
- terminal status `analyzed` or `rejected`; and
- backend completion timestamp.

An analyzed receipt includes `manifestSha256`. A rejected receipt includes one
bounded stable failure code and bounded redacted detail. Receipt and manifest
bytes are stored by digest. A replay returns the first terminal settlement;
it does not mint a different receipt timestamp.

No persisted or transported `ApplicationAnalysisRequestV1` is needed for the
first private implementation. Host-neutral code uses an ordinary internal
input type. If a later service boundary needs a wire request, it receives its
own preflight and V1 codec rather than freezing an incidental function
parameter now.

### Error family and defect boundary

The first typed recoverable variants are invalid or stale authenticated source
input, import or module-link failure, invalid registration or schema metadata,
admitted-limit exhaustion, timeout or interruption, nondeterministic
registration, and retryable host or persistence integration failure.

Unexpected analyzer defects remain defects at the package boundary and become
redacted internal failures only at the trusted host. Application exception
objects, stacks, secrets, response bodies, and arbitrary logged values never
enter the receipt.

### First admitted profile

The first private profile is intentionally small:

- at most 128 source modules;
- at most 2,000,000 total source bytes and 1,048,576 bytes in one module;
- at most 1,024 registered functions;
- at most 256 tables and 1,024 indexes;
- at most 1,048,576 canonical manifest bytes;
- at most 100 diagnostics and 65,536 total diagnostic UTF-8 bytes; and
- a 30,000 millisecond whole-attempt deadline.

Every accepted run performs two fresh cold loads from the same authenticated
bytes. Equal canonical manifest bytes are required. A success/failure mismatch,
different stable failure classifications, or different manifest bytes is
`nondeterministic_registration`. Diagnostics are bounded observations and do
not participate in manifest equality.

The hosted policy supplies no application bindings or environment values and
sets outbound to `null`. Fetch, random bytes, wall clock, high-resolution time,
database, executor, R2 mutation, deployment, activation, and secret access are
absent or rejected during import. Deterministic substitutes may be installed
only by the host policy and are part of the analyzer policy identity.

## Migration Invariants

1. One candidate has exactly one analysis authority.
2. New candidates never fall back to the old verifier, compare acceptance with
   it, or dual-write its evidence.
3. Old candidates never become valid inputs to the new readiness or activation
   generation merely because their fields look similar.
4. The manifest digest is not a semantic-root, verifier-receipt, registration-
   root, package, artifact, or runtime-projection digest.
5. Whole-bundle publication changes code selection only. Runtime capabilities,
   OCC, commit compilation/execution, journals, idempotency, feeds, outbox, and
   authoritative application-row semantics remain with their current owners.
6. Temporary source-code coexistence is compile-time migration structure only;
   there is no request-time fallback or two accepted authorities.
7. Every new persisted or wire shape uses a new concrete contract generation.
   Historical V1/V2 decoders remain exact until their removal gate passes.
8. Destructive migrations are additive migration files with explicit nonempty
   and reference guards. Migration history is never rewritten.

## Challenged Roadmap Gates

### `AA-R1` — inventory accepted for additive work

The repository consumer and persistence inventory above is sufficient to begin
additive contract work. The original wording was too broad to require access to
every external database before writing pure code. Named-environment row proof
is instead a mandatory destructive subgate of `AA-R8`.

Exit evidence still required before removal includes no production consumer of
old analyzer or semantic authority, no old row referenced by a new generation,
and explicit zero-row or guarded-refusal evidence from genuine PostgreSQL.

### `AA-R2` — contract preflight accepted

The manifest, receipt, error boundary, determinism rule, admitted profile, and
new-generation rule above are accepted. The preflight rejects a request wire
contract, source positions, auth, static references, and resumable analysis for
the first migration.

### `AA-R3` — host-neutral core

**Completed by `15beb1fc`.** The final reviewed slice implements:

- analysis-owned V1 model, decoder, canonical encoder, digest input, and tests;
- pure lowering from the existing loaded-source analysis result plus exact
  source-module identity to `ApplicationManifestV1`; and
- no dependency on old verifier, canonical program, materializer, Semantic
  Artifact, backend, persistence, Worker Loader, or clock APIs.

Focused analyzer and contract tests, package typecheck, and the workspace
Effect-boundary check pass. Both required reviewers accepted the exact final
diff. The full package suite exceeded repeated bounded test windows without
emitting a failure and is recorded as timed out, not as passing evidence.

The root package may retain old exports during migration. New code uses plain
Application Analysis names; old exported contracts keep their exact names.

### `AA-R4` — trusted cold-load host

Implement one cohesive hosted slice:

- an analysis-neutral bounded Source Artifact V2 read adapter;
- analyzer-app Worker Loader configuration with no route or public binding;
- fresh module graph load, real execution/schema module inspection, two-load
  comparison, deadline/cancellation, bounded diagnostics, and cleanup proof;
- exact artifact-root and analyzer-policy correlation; and
- failure and defect redaction at the host boundary.

Worker Loader must prove fresh isolation and import-time restrictions. If its
actual lifecycle cannot prove interruption or release within the admitted
profile, stop and amend the host design; do not claim Miniflare disposal proves
the hosted behavior.

#### Live challenge and accepted amendment — 2026-08-11

Current code changes the implementation detail but not this gate's authority:

- `SourceArtifactV2FinalizedContentReader` authenticates exact R2 bytes but
  exposes old verifier budget/path handles. Application Analysis receives a
  narrow analysis-neutral reader that owns fixed admitted ceilings and projects
  only root identity, canonical paths, roles, source digests, and owned source
  bytes/text. No old budget, progress, or path handle crosses that adapter.
- The reader currently rejects every artifact with source maps. Application
  Analysis does not consume source maps, so the shared reader may gain an
  opt-in mode that validates source-map metadata and root totals without
  materializing source-map bodies. The existing default remains rejection, so
  old verifier behavior does not change.
- The installed Worker Loader contract provides fresh `load`, per-worker CPU
  limits, `globalOutbound: null`, and request-owned entrypoint capabilities,
  but no API that proves direct isolate destruction. The host therefore proves
  two uncached `load` calls, bounded CPU, outer Effect interruption, and
  disposal of every returned RPC capability. It must not describe this as
  explicit isolate disposal.
- The analyzer app gains only `ARTIFACTS` and `LOADER` resource bindings plus a
  named private RPC entrypoint. `workers_dev`, preview URLs, routes, and the
  default HTTP surface remain closed. The exact deployment posture and analyzer
  configuration identity must be regenerated rather than silently accepting
  the added bindings.
- Analyzer identity is the generated dynamic-core digest. Policy identity is
  an exact application-analysis policy contract covering compatibility date,
  CPU/deadline/diagnostic limits, import restrictions, and two-load byte
  comparison. Both are checked before source reads or worker loads.

**Decision: accepted for implementation.** Hosted workerd proof must show
fresh-load comparison, import-time outbound rejection, deadline behavior, and
RPC capability disposal. Local Miniflare may provide development parity only;
it cannot close those hosted lifecycle claims.

### `AA-R5` — durable analysis and inactive registration generation

Implement one cohesive persistence slice after rechecking the then-current
migration head and concurrent worktree:

- additive candidate, analysis, and application-revision generation;
- backend-issued IDs, scope-clock fencing, immutable source-root correlation,
  pending/terminal idempotency, exact receipt/manifest bytes and hashes;
- rejected-terminal replay and safe retry of integration failures; and
- inactive registration derived only from an analyzed receipt and decoded
  manifest.

Do not modify old row meanings, write both generations, or add activation in
the same transaction merely for test convenience.

### `AA-R6` — executable producer, publication, and authority migration

This gate is larger than a receipt-table change and is divided into two medium
slices.

First migrate executable authority and publication:

- the private Standard producer and fixtures emit real execution registration
  and schema modules;
- Standard Application Analysis returns the new manifest/receipt through a new
  exact exported contract, while the existing V1 static result remains legacy
  until consumer removal;
- application-named function catalog and whole-bundle runtime publication are
  derived from the manifest; and
- point mutation, query, internal-call, and edge-action runtime-target contract
  generations bind the new candidate and manifest/publication identities.

Then migrate readiness and activation:

- new readiness evidence proves the accepted analysis, inactive revision,
  schema/catalog publication, every required whole-bundle runtime object, cold
  materialization, and existing index readiness;
- new activation and active-selection generations bind that readiness receipt;
- task-capable revisions use a new task runtime-binding generation without a
  semantic-root field; and
- all private consumers select only the new active generation.

This gate may adapt the narrow inputs supplied to existing runtime and
transaction owners. It must not modify their authority or execution semantics.

### `AA-R7` — private proof

Run the complete private application vertical against PGlite and genuine
PostgreSQL from finalized Source Artifact V2 bytes through cold analysis,
inactive registration, whole-bundle publication, readiness, activation, point
mutation, point query, internal calls, edge action, and task binding when the
current test vertical includes it.

Required negative proof includes invalid metadata, missing runtime entry,
forbidden import-time effects, nondeterminism, timeout, interruption, cold
restart from bytes, manifest/receipt corruption, stale scope/candidate evidence,
wrong runtime group, and runtime capability rejection. No suite may pass by
falling back to old evidence or weakening an assertion.

### `AA-R8` — displaced-system removal and migration stop

After all new consumers and proofs are green:

- remove production imports and package exports for the static verifier,
  grammar/parser/linker, ABI/call-graph analysis, progress/restart/evidence,
  analyzer verifier host, and obsolete executor HTTP transports;
- stop Semantic Artifact V1 production and remove its active readers only after
  runtime-target and task-binding consumers have migrated;
- retain historical decoders only when a proven supported row or external
  consumer requires them;
- add guarded retirement migrations after verifying the actual migration head;
  each refuses nonempty or referenced old state; and
- run zero-skip genuine PostgreSQL migration and end-to-end evidence.

Completion of `AA-R8` completes this focused goal. Stop there. Do not enable a
route, Worker binding, production caller, Dynamic V1 retirement, auth support,
or `AA-R9` cutover.

## Medium Implementation Slices

1. **Contracts and pure core:** `AA-R2` plus `AA-R3`.
2. **Trusted exact-byte host:** `AA-R4`.
3. **Durable analysis and inactive revision:** `AA-R5`.
4. **Executable producer and whole-bundle publication:** first half of
   `AA-R6`.
5. **Readiness, activation, runtime-target, and task-binding migration:** second
   half of `AA-R6`.
6. **Private system proof:** `AA-R7`.
7. **Removal and guarded retirement migration:** `AA-R8`, then stop.

Each slice is reviewed against this plan before implementation and again
against its final diff. Significant code checkpoints require both repository
reviewers before commit. Documentation-only preflight and roadmap commits do
not.

## Current Execution Constraints

The worktree currently contains unrelated persistence, durable-task,
system-test, foundation-roadmap, and script changes. They are not part of this
goal and must not be reverted or absorbed. The first contracts/core slice is
package-local and can proceed. Before any persistence or simulation slice, the
main thread must re-read the current schema/migration head and protect or
coordinate overlapping files.

## Preflight Review Decision

**Accepted with amendments.** The replacement is materially simpler than the
static verifier only if executable bundle registration becomes authoritative,
whole-bundle publication replaces static call-graph minimization, and every old
persisted identity receives an honest migration rather than a rename. The plan
is authorized through `AA-R8` under those conditions.

The preflight specifically rejects a new analysis package or product-version
name; hidden Canonical Declarative Program or Semantic Artifact acceptance;
reused old revision/readiness/activation/task/runtime-target meanings; static
JavaScript parsing, ABI inference, or resumable parser progress; fallback,
shadow acceptance, comparison authority, or dual writes; and production
cutover as part of this goal.
