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

#### Implementation checkpoint and failed hosted lifecycle gate — 2026-08-11

Commit `55105371` implements the reviewed local AA-R4 candidate: the bounded
analysis-neutral Source Artifact V2 reader, exact generated dynamic core and
policy identities, two uncached Worker Loader loads, deterministic import
policy, deadline/interruption adapter, exact per-directory framework shims,
private analyzer RPC entrypoint, and failure redaction. The final local receipt
is:

- generated core `949b5cf2809b12dfa6f6000280e40b617640114e1b6b091bae912e24ea26fedd`
  from two byte-identical 319,369-byte builds;
- private analyzer identity
  `60404b4c64c9227fce6bde9badffc82d882252b59b9f33701df7143594a0364e`;
- 24 focused analyzer tests and 10 finalized-source-reader tests passing;
- `flarex-backend` typecheck and the workspace Effect-boundary check passing;
  analyzer-app typecheck blocked only by the separately owned concurrent error
  at `packages/persistence-postgres/src/appRows.ts:434`;
- the complete analyzer suite at 61 of 62 tests, with the unchanged legacy
  Declarative V2 long-path nested-cause assertion failing; and
- both required final staged-diff reviewers approving with no findings.

The hosted challenge did not accept the lifecycle assumption:

- a uniquely named remote preview running the real host returned `analyzed`
  after two fresh loads in 85 milliseconds, returned
  `forbidden_import_effect` for a caught import-time fetch in 62 milliseconds,
  returned `timeout` at the requested 10-millisecond deadline while the child
  computation remained outstanding, and then completed a fresh recovery
  analysis in 72 milliseconds;
- the first preview using the accepted analyzer configuration was rejected by
  Cloudflare with code `10085` because the configured `flarex-artifacts` R2
  bucket does not exist in the authenticated account; no bucket or production
  resource was created; and
- a separate hosted Worker Loader probe successfully obtained and called the
  entrypoint stub, but the subsequent release operation failed with Cloudflare
  `1101` and `TypeError: stub[Symbol.dispose] is not a function`. This differs
  from the local Miniflare/fake capability surface and means the current host
  cannot prove release of the request-owned entrypoint capability.

Expected behavior was a callable, observable release operation on the hosted
entrypoint capability. Actual behavior provides no such operation through the
tested Worker Loader surface. The affected owner is the Cloudflare Worker
Loader/RPC lifecycle boundary and the Application Analysis host policy that
depends on it; this evidence does not authorize any OCC, commit, executor,
persistence, or authoritative-row change.

**Disposition: AA-R4 remains incomplete and AA-R5 must not start.** The local
implementation commit is retained as an inert candidate, but the gate needs a
new explicit preflight that either identifies a documented hosted lifetime
primitive with observable release, proves a platform-owned request-lifetime
guarantee and deliberately amends the release claim, or replaces Worker Loader
for this host. Deployment also needs a separately named real R2 bucket before
the accepted analyzer configuration can be uploaded. Do not infer either
decision, create the missing bucket, deploy the analyzer, or weaken the hosted
proof from this checkpoint.

#### Replacement lifecycle preflight and accepted amendment — 2026-08-11

The failed release assumption is now resolved from the installed contract and
the current hosted platform documentation, without inventing an isolate
destructor:

- In the installed `@cloudflare/workers-types@4.20260613.1`,
  `WorkerStub.getEntrypoint()` returns `Fetcher<T>`. Neither `WorkerStub` nor
  that entrypoint `Fetcher<T>` is `Disposable`. An object returned by an RPC
  method is augmented with `Disposable`; that returned object is the capability
  the caller may and should explicitly release.
- Cloudflare's [Workers RPC lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/)
  contract makes entrypoint-stub lifetime execution-context-owned. Stubs made
  during an event are automatically disposed when its handler returns; an RPC
  execution context ends when the RPC returns if it did not pass or return
  capabilities, and a disconnected client cancels the server context.
- The [Dynamic Workers API](https://developers.cloudflare.com/dynamic-workers/api-reference/)
  still guarantees a fresh worker for each `load()` call, but exposes no direct
  isolate-destruction operation. The hosted `TypeError` from attempting
  `stub[Symbol.dispose]()` therefore demonstrated a false local model, not a
  missing supported cleanup call.

There are three distinct lifetimes and they must not be collapsed:

1. The Worker Loader worker and its entrypoint `Fetcher` are owned by the
   Cloudflare event/RPC execution context. The host must not wrap that fetcher
   in synthetic Effect acquisition/release or claim direct isolate disposal.
2. A data object returned by `analyze()` is a caller-owned RPC result
   capability. The host detaches its admitted data and explicitly disposes the
   original result, including a result that wins a deadline race after Effect
   interruption.
3. The outer deadline interrupts the local Effect wait. Returning the terminal
   timeout from the named host RPC then ends its parent execution context, so
   the platform owns cancellation and automatic stub disposal. This is the
   release claim; Effect interruption alone is not presented as remote isolate
   destruction.

The correction slice removes the unsupported entrypoint disposer, makes the
fake and Miniflare harnesses match the installed non-disposable fetcher
surface, and retains explicit result disposal. Hosted proof must show a real
returned object has a callable disposer, explicit result release succeeds, a
timed-out call is followed by a successful fresh analysis, and two uncached
loads still agree. It must not claim that a direct isolate destructor was
observed.

The security and artifact-reader challenge was also replayed against the
retained candidate. Sticky forbidden-attempt detection, deterministic ambient
policy through lazy registration inspection, framework-path collision
rejection and exact subpath exports, deterministic corruption classification,
and function-role/root correlation all have focused regressions. Those earlier
findings are fixed in `55105371`; they are not new hosted evidence and do not
replace the lifecycle proof above.

The missing `flarex-artifacts` account bucket remains a deployment prerequisite,
not authority to create infrastructure and not a reason to keep the private,
inert migration behind AA-R4. If the corrected host passes the required hosted
Worker Loader/RPC proof and final review, AA-R4 may close and AA-R5 may begin
while analyzer deployment stays fail-closed. A real, explicitly approved R2
binding remains mandatory before any later deployment or AA-R9 cutover.

**Self-review decision: accepted for the bounded AA-R4 correction.** This
amendment uses the platform's documented lifetime owner, narrows the explicit
release claim to the capability that actually implements it, preserves the
deadline and two-load policy, creates no alternate runtime or persistence
authority, and authorizes no bucket creation, route, preview URL, deployment,
OCC, commit, executor, or authoritative-row change.

#### Completed lifecycle correction and hosted receipt — 2026-08-11

**AA-R4 is completed by `d6883020`.** The correction removes the unsupported
entrypoint-stub release attempt and leaves that non-disposable fetcher's
lifetime with the Cloudflare execution context. Returned RPC objects are still
detached and explicitly disposed, including results arriving after local
deadline interruption. The fake and Miniflare harnesses now model that same
ownership, and each acquired Miniflare result has its own partial-failure-safe
finalizer.

The final proof receipt is:

- a temporary, uniquely named remote Worker Loader preview returned two equal
  results from two uncached loads; both returned objects exposed callable
  `Symbol.dispose` operations, and both explicit releases completed;
- a separate request returned `timeout` after 10 milliseconds while its child
  RPC was still slow, followed immediately by a successful fresh two-load
  request with both result disposers present;
- no direct isolate destructor was called or claimed, and all temporary proof
  processes, source, logs, Wrangler cache, and port `8811` were removed;
- 24 focused host/core/Miniflare/identity tests pass, generated-core verification
  remains `949b5cf2809b12dfa6f6000280e40b617640114e1b6b091bae912e24ea26fedd`,
  and the regenerated private analyzer identity is
  `9fd549d245a42ef119e0dbf7c56c11449a9f5faed86323fd45fed5458d2c92c2`;
- the workspace Effect-boundary check passes; analyzer typecheck still reaches
  only the separately owned concurrent error at
  `packages/persistence-postgres/src/appRows.ts:434`; and
- the complete analyzer suite is 62 of 63 tests, with the unchanged legacy
  Declarative V2 long-path nested-cause assertion failing. Both required final
  reviewers approved the exact corrected five-file diff after the Miniflare
  partial-failure cleanup was added.

The absent account R2 bucket still prevents uploading the accepted analyzer
configuration. No bucket, route, preview URL, or production deployment was
created. That operational prerequisite remains fail-closed for later deployment
and AA-R9; it does not reopen this private host implementation gate. AA-R5 may
now begin from the then-current migration and persistence head.

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

#### AA-R5 persistence preflight and accepted cut — 2026-08-11

The preflight re-read the current schema and migration journal at committed
head `0053_sleepy_morgan_stark`. Concurrent managed-schema work modifies package
metadata and its own code but does not currently add a Postgres table or
migration. The main thread must recheck that head immediately before generation
and must not hand-write a conflicting journal entry.

The new persisted generation is deliberately three tables:

1. `fx_system_application_candidate_v1` owns a backend-issued candidate ID and
   request key, one immutable Source Artifact V2 root, and the exact trusted
   scope storage generation, fence, and epoch observed when it was admitted.
2. `fx_system_application_analysis_v1` owns one backend-issued analysis ID per
   candidate. It starts `pending` and settles once to `analyzed` or `rejected`.
   Terminal rows store exact canonical receipt bytes and digest. Analyzed rows
   additionally store exact canonical manifest bytes and digest; rejected rows
   store only the bounded stable failure and detail carried by their receipt.
3. `fx_system_application_revision_v2` is the new inactive revision generation.
   It has a backend-issued revision ID and a composite foreign key to the same
   analyzed application-analysis row, Source Artifact root, and manifest digest.
   It has no readiness or activation fields and no relationship to an old
   candidate, verifier attempt, Semantic Artifact, verdict, revision, or
   activation table.

One scope-clock-locked admission transaction makes request-key replay exact.
The same key with the same source root and analyzer identities returns the
existing candidate/analysis; reuse with different input is a conflict. The host
runs outside that transaction. A retryable host or transport failure leaves the
analysis pending, so retry invokes the same candidate rather than recording a
false rejection or minting a second authority.

One scope-clock-locked settlement transaction accepts only a terminal host
result whose Source Artifact root and analyzer identities match the pending
row. It decodes and re-canonicalizes an analyzed manifest, requires byte-for-byte
agreement with the host canonical text, constructs the backend-owned canonical
receipt using database time, hashes both through the existing package-owned
SHA-256 boundary, settles the row, and inserts the inactive revision only for an
analyzed receipt. If a terminal row already exists, the operation validates and
returns the first durable receipt and revision projection; it never overwrites
the terminal timestamp, turns a rejection into success, or mints another
revision.

Stored replay re-decodes canonical receipt and manifest bytes and verifies their
digests and cross-row identities before returning them. Database/driver/resource
failures remain retryable integration failures; invalid terminal input,
request-key reuse, stale scope authority, and durable correlation failures are
typed and distinct. Unexpected decoder or platform defects are not converted
to ordinary rejection receipts.

**Self-review decision: accepted for implementation.** The cut is additive,
transactionally fenced, first-terminal-wins, and smaller than adapting the old
registration pipeline. It preserves one authority per candidate, gives rejected
analysis a durable replay without creating a revision, and creates no dual
write, fallback, runtime publication, readiness, activation, OCC, commit, row,
feed, outbox, route, binding, or deployment behavior.

#### AA-R5 implementation checkpoint — 2026-08-11

**Migration-portability correction complete.** A genuine-PostgreSQL M03-A
upgrade probe against the repository-standard isolated non-public `search_path`
found hard-coded `public` parent references in migrations `0054` through
`0056`. Their bounded unshipped-history repair is committed: the seven foreign
keys retain their exact names, column tuples, actions, and ordering while parent
lookup is now search-path-relative. Fresh and upgrade migration lanes can
therefore create the same schema outside `public`; the new M03-A migration also
uses an unqualified parent reference.

**Completed by `d119d756`.** Migration `0054_material_la_nuit` adds exactly the
three accepted Application Analysis tables on committed head
`0053_sleepy_morgan_stark`. Its generated snapshot points to the exact `0053`
snapshot identity and differs only by those three tables; no concurrent schema
work entered the migration.

The package-local repository now owns scope-clock-locked `begin`, `settle`, and
`inspect` operations. It enforces the candidate's captured storage generation,
fence, and epoch on every replay and settlement; exact request, source-root,
analyzer, and policy correlation; one immutable terminal; canonical stored
receipt and manifest bytes plus recomputed SHA-256; rejected replay without a
revision; and analyzed-only creation of one inactive V2 revision. It writes no
old Declarative V2 candidate, verifier, verdict, readiness, activation, or V1
revision row.

The final review challenge found and corrected four substantive boundary risks:
fresh authority could initially settle a stale-fence candidate, caller-owned
terminal input could change after validation, interruption cleanup could hide an
unexpected settlement failure, and a failing cleanup initially replaced rather
than combined the interruption cause. Direct regressions now prove captured
input, concurrent request and terminal serialization, post-update rollback and
retry, stale-candidate rejection by a fresh caller, interruption plus settlement
defect preservation, and correlated rollback-sentinel handling.

Validation receipts are persistence typecheck, Drizzle migration check, the
workspace Effect-boundary check, staged diff check, and 36 focused PGlite
migration/repository tests. Both required final reviewers approved the exact
committed diff with no findings. This is deliberately PGlite evidence only;
zero-skip genuine PostgreSQL concurrency and migration proof remains mandatory
at `AA-R7`. The repository remains package-local until the first cross-package
consumer is introduced by `AA-R6`.

### `AA-R6` — executable producer, publication, and authority migration

This gate is larger than a receipt-table change and is divided into three
medium slices after the post-publication owner audit below.

#### AA-R6 executable-authority preflight and accepted cut — 2026-08-11

The source and consumer inventory challenges two unnecessarily complex readings
of the original gate. First, whole-bundle publication does not require copying
the authenticated module bodies into a second R2 namespace. Source Artifact V2
already owns immutable content-addressed module bytes and Application Analysis
already authenticates their root and per-module identities. A second runtime
blob store would create two byte authorities, another settlement protocol, and
another corruption surface without changing the executable graph. Second,
point mutation, point query, internal calls, and edge action do not require four
new descriptions of the same selected application function. Their hosts differ
in capabilities and invocation envelopes, not in application-revision
authority.

The first medium slice is therefore accepted with this exact cut:

1. The Standard Application definition owner adds a private executable-source
   producer. During migration it may consume the decoded Canonical Declarative
   Program V1 and prebuilt source graph as code-generation input, but it emits
   real handler imports, real Flarex registrations, and a real schema module.
   The generated execution and schema paths are reserved, collisions fail, raw
   handler modules remain byte-exact, and the output is an inert Source Artifact
   V2 upload input. Once uploaded, only the cold-loaded source registrations are
   analyzer authority. The analyzer never receives the Canonical Declarative
   Program or Semantic Artifact as a second acceptance input.
2. The Standard Application Analysis owner adds one plain, unversioned current
   facade whose exact success contains `ApplicationManifestV1` and
   `ApplicationAnalysisReceiptV1`. Its injected context owns host and durable
   registration composition. The existing `./v1` API remains an exact legacy
   compatibility surface until its consumers are removed; it is not renamed or
   reinterpreted.
3. Persistence adds `fx_system_application_publication_v1` and
   `fx_system_application_function_v1`. One publication row is correlated by
   foreign key to the exact inactive Application Revision V2 and analyzed
   Application Analysis V1 identities. It stores canonical schema and function
   catalog bytes plus their SHA-256 digests and one publication commitment.
   Function rows are derived only from the accepted manifest and bind their
   exact canonical entry digest. Publication is idempotent for byte-identical
   input and rejects conflicting replay. It does not write old candidate,
   projection, function-group, revision, readiness, or activation tables.
4. Runtime code reuses Source Artifact V2 as the only module-body store. The
   publication commitment binds scope, revision, candidate, analysis, source
   root, manifest digest, schema digest, and function-catalog digest. A single
   `ApplicationRuntimeTargetV1` contract binds that publication, the manifest
   execution path, and one exact function entry. Point mutation, query,
   internal-call, and edge-action adapters must later narrow the function kind
   and visibility required by their own envelope; they must not fork the
   application authority contract.
5. This slice remains private and inactive. It proves producer output by real
   cold analysis, proves canonical publication and conflicting-replay behavior
   in PGlite, and proves runtime-target encode/decode and identity changes. It
   does not select an active revision, adapt a production runtime, change an
   OCC or commit owner, deploy the analyzer, or claim genuine PostgreSQL proof.

The remaining gate consumes these exact outputs through two medium slices. The
first adds private whole-bundle runtime materialization and a genuinely new task
binding without a semantic root. The second adds new readiness and activation
generations, an active-selection generation, and private consumer migration.
Readiness proves the stored schema and function catalog, every manifest module's
authenticated Source Artifact V2 identity, cold materialization through the new
runtime host, and existing index readiness. It does not introduce a second
bundle object or static call graph.

Preflight self-review found no owner-boundary exception requiring wider
approval. The implementation is additive, keeps Source Artifact V2 and the
existing runtime hosts in their current ownership, and reduces rather than
duplicates authority. The accepted stop conditions are any need to reinterpret
an old persisted row, copy runtime module bytes into a new store, infer a static
dependency graph, change transaction or executor semantics, or repair a shared
runtime defect discovered by the new proof.

#### AA-R6 first-slice implementation checkpoint — 2026-08-11

Commit `1c4fd455` completes the accepted executable-producer and publication
slice. The Standard definition owner now generates one real registration
module and one real schema module while preserving owned copies of handler
bytes. Generated-path and analyzer framework-shim collisions fail through one
analysis-owned path policy. A genuine Miniflare cold load proves that the
analyzer observes the generated registrations rather than a second decoded
program input. The unversioned Standard Analysis facade returns only the exact
Application Manifest V1 or rejected Analysis Receipt V1 result; the existing
`./v1` compatibility surface is unchanged.

Migration `0055_familiar_jasper_sitwell` adds only the application publication
and function catalog tables plus the exact inactive-revision key required by
their foreign key. Publication derives canonical schema, catalog, entry, and
commitment bytes from the accepted manifest, locks the current scope/candidate
authority, serializes exact replays, and rejects corrupt or conflicting state.
It persists no module body: Source Artifact V2 remains the sole immutable byte
owner. Before any transaction opens, every derived function must canonicalize
as a complete `ApplicationRuntimeTargetV1`, so a durable publication cannot
contain a function that its runtime contract rejects.

The runtime target is one concrete publication-and-function contract shared by
the later host adapters. Its sole public decoding authority captures hostile
plain data without invoking accessors, bounds and admits both validator graphs,
enforces ordinary and default-export path spelling, snapshots ownership, and
checks the complete canonical-byte budget. The raw structural Schema remains
private. Default-export spelling is identical in the manifest, runtime target,
Drizzle schema, migration SQL, and generated snapshot.

Final review challenged and corrected six material gaps: changing-accessor and
cyclic validator input, publication/target byte and multibyte-name disagreement,
framework-shim path collisions, duplicated Promise/Effect transaction
settlement logic, default-export database disagreement, and a public structural
Schema that was weaker than the named decoder. Both required reviewers approved
the corrected committed diff with no findings.

Validation receipts are protocol typecheck and 65 files/505 tests, Standard
definition typecheck and 4 files/32 tests, Standard Analysis typecheck and 5
tests, analysis package typecheck plus the focused path-policy tests, persistence
typecheck and 42 focused PGlite repository/migration tests, Drizzle migration
check, 19 analyzer host/core/Miniflare tests, the workspace Effect-boundary
check, and two clean reproductions of private analyzer identity
`449d27278611b6750797356f1f983a7211352d7281e5693503edc382656669ff`.
The broad analysis test command did not finish within the five-minute validation
ceiling and reported no assertion failure; the directly affected owner test and
typecheck passed. Analyzer package typecheck remains blocked only by the
pre-existing untouched `packages/persistence-postgres/src/appRows.ts:434`
`noUncheckedIndexedAccess` error.

This checkpoint is still private and inactive. Its database evidence is PGlite
only; genuine PostgreSQL concurrency and migration proof remains mandatory at
`AA-R7`. It selects no active revision, exports no persistence repository,
adapts no production runtime, and changes no OCC, commit, executor, or task
authority. The next authorized work is the second AA-R6 medium slice only.

#### AA-R6 remaining-authority preflight and accepted amendment — 2026-08-11

The post-publication owner inventory rejects the earlier readiness-first order.
The old readiness operation proves cold materialization of candidate-derived
runtime projections. Application publication intentionally has no such
projection and Source Artifact V2 is now the only module-body owner. A new
readiness row created before a whole-bundle runtime host exists could prove only
that bytes were readable or that analysis could run again; neither proves that
the selected application can execute. Readiness therefore follows runtime
materialization rather than preceding it.

The inventory also rejects reuse of the current durable-task binding. Its wire
contract, persistence row, run-creation authority, and compute-delivery evidence
all commit the displaced candidate digest, package/artifact identities, and
`semanticRootSha256`, and its foreign key selects Application Revision V1.
Removing one field or pointing that row at Application Revision V2 would
reinterpret shipped evidence. Application Manifest V1 deliberately contains
only analyzed source, schema, and function registrations; a task catalog remains
a separate Standard definition input and must be correlated to the accepted
source/publication explicitly.

The next medium slice is accepted with this cut:

1. Add one private Application Runtime materialization owner. It receives a
   canonical `ApplicationRuntimeTargetV1`, the exact stored Application Manifest
   V1, and an authenticated Source Artifact V2 reader. It rereads the complete
   source graph, compares the root, execution/schema paths, ordered module
   paths, roles, byte lengths, and source digests with the manifest, and builds
   Worker Loader code from those bytes. It does not store or republish a module
   body.
2. Do not feed the application target into an existing exact-runtime worker
   core. Those concrete request contracts require an `artifactId`,
   `sourcePackageHash`, and artifact execution identity; deriving those names
   from the source or publication digest would create semantically false
   evidence. Add one application transaction worker contract for query,
   mutation, workflow mutation, and internal calls, and one application action
   worker contract for action plus its callback capabilities. Reuse the existing
   lower-level Function API, syscall, validation, transaction, and action-host
   capability owners only where their inputs retain the same meaning. Both new
   workers accept the one application target and reject the wrong kind or
   visibility. They must not manufacture candidate, semantic, projection,
   package, artifact, or static-call-graph evidence.
3. Cold proof means Worker Loader evaluates the authenticated whole bundle with
   outbound networking disabled and resolves the exact registered function from
   the generated execution module. It is not a second analysis pass and does
   not invoke a database mutation. The receipt binds runtime-host identity,
   compatibility date, source root, manifest/publication digests, and the exact
   target digest.
4. Add a new concrete Application task-binding generation rather than mutate
   the existing task-definition contracts. Its Standard producer correlates a
   canonical task catalog and handler module/export with the prepared source
   mapping. Its commitment binds scope, Application Revision V2, candidate and
   analysis identities, publication digest, Source Artifact V2 root, task
   catalog/manifest identity, exact handler module/export, and runtime-host
   policy. It contains no semantic root, package/artifact digest, candidate
   frame, or runtime projection object.
5. The new task definition persistence generation is private and inactive. It
   does not dual-write or reinterpret `fx_system_durable_task_definition_revision_v1`.
   Existing run creation and compute delivery remain unchanged until their
   bounded migration in the following slice; no task run may select the new row
   early.

The final AA-R6 medium slice then adds Application Revision V2 readiness,
activation revision/head, and issuer-backed active selection generations plus
the bounded runtime and Task System consumer migrations. The revision row stays
immutable with its registered `inactive` status; activation is separate
scope-clock-locked head history, not a status mutation. The selection retains
only the exact authority, manifest, publication, and optional new task binding
needed by consumers. It must not copy the old active metadata's semantic,
projection, package, or candidate-frame fields.

Readiness in that final slice must prove exact publication replay, authenticated
source/manifest agreement, a successful cold receipt for every published
function target under the same runtime-host policy, the separately bound task
catalog when present, and existing index readiness through an injected narrow
index-readiness port. It may not claim index readiness from manifest bytes
alone. Activation locks the scope clock before its new head, validates the
readiness receipt again in the same transaction, uses an explicit compare-and-
swap token, and never writes the displaced activation or verdict tables.

Self-review accepts this amendment because it removes two false shortcuts:
analysis replay as runtime proof and field-deleted reuse of the old task row.
The stop conditions are any need to change an exact runtime worker's invocation
semantics, modify OCC/commit authority, weaken Source Artifact V2 authentication,
write both task generations, infer a dependency graph, or treat an old
readiness/activation/selection/task value as new evidence. A defect exposed in
one of those shared owners is recorded and stopped at its boundary under the
repository rule.

The subsequent exact-runtime ABI trace strengthens that decision. Existing
worker-definition builders do accept caller-supplied source modules, but their
configuration and request decoders still pin the displaced artifact reference.
Therefore "reuse the worker cores through adapters" is rejected; only the
lower-level capability mechanics may be reused. This correction does not widen
runtime or transaction authority. It prevents a source-root or publication
digest from being relabeled as a source-package hash merely to satisfy an old
type.

#### AA-R6 runtime-materialization checkpoint — 2026-08-11

Commit `1eaa5f4b` completes the runtime-materialization portion of the accepted
second slice. A private Application Runtime materializer now authenticates and
rereads the complete Source Artifact V2 graph, verifies its exact ordered
agreement with the stored Application Manifest V1, replays the canonical
schema, catalog, function-entry, and whole-publication commitments, and asks
Worker Loader to cold-resolve the exact Application Runtime Target V1. It stores
no module body and changes no OCC, commit, readiness, activation, or active
selection authority.

Analyzer admission and cold runtime loading now share one deterministic, sticky
import policy. The generated runtime core evaluates application modules inside
that policy and compares the registered kind, visibility, arguments, return
validator, and partition metadata with the accepted target. The cold receipt
binds the runtime-host identity, compatibility date, source root, manifest and
publication digests, and exact target digest. Framework shims expose only their
owned export surfaces, application paths cannot overwrite them, outbound
networking is disabled, and interrupted Worker Loader RPC results are disposed
exactly once even when they settle late.

Focused validation passed all four affected package typechecks, 25 analyzer
tests, seven backend materializer tests, two protocol receipt tests, six
persistence publication tests, both deterministic generated-core checks, the
private analyzer identity check, and the Effect runtime-boundary check. The
generated Application Runtime core identity is
`87592eba2b544223f59312d64f5d42847ca1dc5e4f1ca95015fdf0874fc076ae`.
Both required final reviewers approved the exact committed diff with no
actionable findings. The broader backend build reached and passed the new
runtime-core check, then stopped at an unrelated pre-existing stale
edge-action runtime-kernel check; this checkpoint did not regenerate or modify
that displaced owner.

This does not close the second slice. The new application transaction and
action worker contracts plus the separate Application task-binding generation
and private persistence remain required. No new task row may be selected and no
old task binding may be reinterpreted while that work is incomplete.

#### AA-R6 Application task-binding implementation preflight — 2026-08-11

The concrete producer and storage trace rejects adapting
`TaskDefinitionRuntimeBindingV1`. That contract is not merely an inconvenient
container: its canonical bytes commit the displaced Application Revision V1,
candidate digest, semantic root, package/artifact identities, runtime
projection objects, and activation authority. Field deletion, placeholder
digests, or an adapter that silently supplies those fields would create false
evidence. The existing Canonical Task Catalog V1 and Canonical Task Manifest V1
remain reusable because they own task intent, validators, attempt policy,
compute profile, queue, and the logical/source handler mapping rather than
application activation or artifact authority.

The accepted implementation cut is:

1. Add new versioned Application task-catalog and task-definition binding
   contracts beside, not inside, the displaced runtime-binding contract. The
   catalog binding commits scope, inactive Application Revision V2,
   candidate/analysis identities, publication digest, Source Artifact V2 root,
   canonical task-catalog digest and count, runtime-host identity, and
   compatibility date. Each definition binding commits that catalog-binding
   digest and additionally commits its task identity, canonical manifest
   digest, and exact logical module, authenticated source module, and export
   name; it does not repeat authority fields that the catalog digest already
   binds.
2. The Standard producer accepts an already canonical hashed task catalog and
   a prepared Standard Application definition. For every task it proves that
   the logical-to-source module pair exactly matches
   `artifactIngressPlan.source.functionEntries`, that the source module exists,
   and that task IDs remain unique and canonically ordered. It does not infer a
   dependency graph or claim that an export executed successfully; final
   readiness owns cold runtime proof.
3. Persist one immutable catalog header and immutable child definition rows.
   The header is required even for an empty catalog, avoiding an absence that
   could mean either "no tasks" or "tasks not generated." Child rows reference
   the exact header and retain canonical manifest and binding bytes for later
   verified decoding. Both generations foreign-key to the exact inactive
   Application Revision/publication authority and contain no module body.
4. Keep the repository private and registration-only. It supports idempotent
   exact replay and rejects conflicting replay. It does not export a public task
   API, write `fx_system_durable_task_definition_revision_v1`, create a task
   run, publish compute-delivery evidence, select an active revision, or add a
   fallback between task generations.

Self-review accepts this cut because the catalog header makes empty intent
explicit, the child rows keep lookup simple, and the canonical commitments are
smaller than the displaced runtime-projection model while retaining every
authority needed by later readiness and selection. The stop conditions are any
need to reinterpret an old task digest, manufacture artifact or semantic
identity, inspect user code statically to prove an export, dual-write task
generations, or change current run-creation/compute-delivery semantics.

#### AA-R6 Application task-binding producer checkpoint — 2026-08-11

Commit `243616dd` completes the contract and Standard-producer half of the
accepted task-binding cut. The private Application task-catalog binding commits
the exact inactive revision, candidate/analysis identities,
publication/source authority, canonical task catalog, and runtime-host policy.
Each ordered task definition commits the catalog-binding digest, canonical task
manifest digest, and correlated logical/source module and export. The producer
rehashes the supplied catalog and every manifest, rejects any digest mismatch,
and proves the logical-to-source module mapping against the prepared Standard
Application graph without inspecting or executing user code.

The final diff also rejects symbol keys, accessors, hostile Proxy reflection,
and conflicting extra fields through the typed decoder channel without
invoking caller code. Impossible internally constructed SHA input failures are
named defects; actual SHA resource failures remain recoverable. Typecheck, all
39 Standard Application tests, the Effect boundary check, and both required
final reviews passed. The package export remains private and no persistence,
run creation, compute delivery, activation, selection, OCC, or commit owner was
changed.

This checkpoint does not complete the task-binding cut. The immutable catalog
header and definition persistence generation plus idempotent exact registration
remain next; current task rows and consumers are still unchanged.

#### AA-R6 Application task-binding persistence checkpoint — 2026-08-11

Commit `79e8b818` completes the private persistence half of the accepted
Application task-binding cut. Migration `0056_lively_yellowjacket` adds one
immutable catalog header per scope/revision and immutable child definition rows.
The header exists for both populated and explicitly empty catalogs and foreign
keys to the exact inactive Application publication authority. Registration
locks the scope clock, candidate, and publication in owner-compatible order,
then inserts the header and all children in one transaction. Exact concurrent
replay converges; competing replay is rejected; a child failure rolls back the
header.

The final admission boundary re-decodes and owns every binding and manifest
before asynchronous work, rejects non-exact or accessor-backed wrapper arrays,
NUL or non-scalar persisted text, detached, resizable, growable, or shared byte
views, and enforces the shared 32 MiB aggregate evidence budget before copying,
SHA, or database work. Replay compares children by exact task identity rather
than database collation order. These checks preserve agreement between retained
canonical bytes, digests, scalar columns, and the returned projection.

Both required final reviews approved the staged checkpoint. Standard Application
typecheck and all 40 tests passed; persistence typecheck, all 15 focused
task-binding tests, all 27 PGlite migration tests, Drizzle schema check, targeted
strict compilation, the Effect boundary check, and the staged diff check passed.
Follow-up commit `231eb769` corrected the complete Application migration chain
from `0054` through `0056` so all seven foreign keys follow the migration
session's selected schema instead of hard-coding `public`. The exact staged
chain passed its dedicated PGlite upgrade, failed-migration rollback, recovery,
and replay lane plus an independent non-public-search-path migration probe; both
required reviewers approved the correction. Genuine PostgreSQL execution was
not available because `FLAREX_POSTGRES_DATABASE_URL` was unset and remains a
mandatory `AA-R7` acceptance proof rather than an implied pass here.
The repository remains private and registration-only: it does not write the old
durable-task definition generation, create or select task runs, publish compute
delivery, activate a revision, or change OCC/commit authority.

The second AA-R6 medium slice remains open for the new Application transaction
and action worker contracts. No current task consumer may read this generation,
and no old task binding may be reinterpreted before final readiness and selection
migration.

#### AA-R6 Application worker-contract implementation preflight — 2026-08-11

The current exact-runtime request families are not reusable contracts for the
Application runtime. Their artifact and function members require an
`artifactId`, `sourcePackageHash`, artifact execution module, and, in several
cases, a public-only function shape. The separately named internal-call profiles
still reuse those same root envelopes. Replacing those fields with a source root
or publication digest would not be an adapter; it would relabel different
authority as shipped artifact evidence. The existing Standard invocation
services also still select the displaced active generation and are consumers,
not protocol owners for this slice.

The accepted implementation is one private transaction-worker wire contract
and one private action-worker wire contract in `flarex-protocol`. Both carry one
owned canonical `ApplicationRuntimeTargetV1` and never carry an artifact
reference, candidate frame, semantic root, projection, stored module body, or a
second function definition. The transaction contract admits query and mutation
or workflow-mutation targets at public or internal visibility and rejects
action targets. Its context is an exact discriminated query-versus-write union:
query retains snapshot execution context, while mutation and workflow mutation
retain transaction execution context. Internal query/mutation calls are
capabilities of the eventual transaction worker, not new target kinds or a
reason to duplicate the root request contract.

The action contract admits only public or internal action targets. It retains
the action invocation generation, time/deadline, random seed, authenticated
caller, canonical arguments, and host-policy commitment needed by the existing
action authority. The callback capability remains a separate Worker RPC
capability supplied by the trusted host; it is not serialized into the wire
value and the protocol package does not import Cloudflare runtime types.
The two operation families share one private normalized worker-result envelope
because its complete meaning is exactly the validated returned Flarex value;
action lifecycle and transaction commit disposition remain outside the worker.

Both decoders must establish ownership at the unknown-input boundary, enforce
exact own-data shapes and byte/value budgets, canonicalize arguments and the
embedded target, and verify argument semantic size. Structural decoding proves
only a well-formed operation-family request. A backend-owned target claim must
separately compare the canonical target and its path, kind, and visibility with
the trusted selected authority before Worker Loader evaluation. This avoids the
false claim that an untrusted request authorizes itself merely by repeating a
valid target. Result envelopes normalize only the returned Flarex value.

This checkpoint is contract-only and inert. It may add protocol exports, pure
claim helpers, and focused tests, but no Worker Loader call, route, dispatcher,
Standard invocation consumer, persistence write, readiness row, activation,
task run, callback execution, OCC behavior, or commit behavior. The following
bounded host slice may build the two worker definitions from authenticated
whole-bundle bytes and reuse lower-level Function API, syscall, validation,
transaction, and action-host mechanics without widening their authority.
Workflow mutation remains a contract kind only until its separately accepted
execution semantics exist; this slice does not reinterpret ordinary mutation
execution as workflow execution.

Self-review accepts this cut because it produces two predictable operation
families rather than cloning the five artifact-era exact-runtime envelopes, and
because it keeps wire validation, trusted authority comparison, host
capabilities, and production selection as separate owners. Stop and amend the
roadmap if implementation needs an artifact identity, treats internal calls as
new authority, serializes a callback, executes workflow mutation through the
ordinary mutation path, reads old active/task state, or changes an OCC, commit,
action-lifecycle, or Worker Loader owner.

#### AA-R6 Application worker-contract implementation checkpoint — 2026-08-11

**Completed by `9da527b5`.** `flarex-protocol` now exposes one private
transaction-worker request, one private action-worker request, and one shared
worker-result envelope. The requests carry only the canonical Application
runtime target, owned auth and arguments, exact operation context, and the
transaction table catalog where applicable. They reject the wrong function
family and do not carry artifact-era identity, source modules, callbacks,
runtime selection, or commit disposition.

The challenged decoder now rejects over-advertised transaction arguments before
context traversal, establishes an owned snapshot before canonicalization, and
bounds all operation work: query and action arguments are limited to 1 MiB,
write arguments retain the existing mutation ceiling, results are limited to
8 MiB, auth is limited to 64 KiB, and one request may visit at most 65,536 value
nodes and inspect 131,072 container members. Those independent ceilings close
large-buffer copying, repeated-alias expansion, undefined-member traversal,
late descriptor reflection, and caller-mutation gaps without changing the
shared Value Codec or any generated runtime identity. Expected codec failures
remain typed; unexpected codec or platform failures remain defects.

Protocol typecheck, all 26 focused contract tests, all 533 protocol tests, the
Effect boundary check, and the byte-identical Application Runtime core check
passed. Both required reviewers approved the final staged snapshot after the
resource and hostile-reflection regressions were added. The contract remains
inert: it loads no Worker, claims no trusted target, invokes no callback, opens
no transaction, writes no persistence, and changes no OCC, commit, readiness,
activation, task-run, route, or production-selection owner.

The next bounded AA-R6 host slice may consume these contracts only after its own
preflight identifies the existing lower-level Function API, syscall,
validation, transaction, action-host, and Worker Loader capabilities it will
reuse. Workflow mutation remains contract-only until separately accepted
execution semantics exist.

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
4. **Executable producer and whole-bundle publication:** first slice of
   `AA-R6`.
5. **Whole-bundle runtime materialization and new task-binding generation:**
   second slice of `AA-R6`.
6. **Readiness, activation, active selection, and private consumer migration:**
   final slice of `AA-R6`.
7. **Private system proof:** `AA-R7`.
8. **Removal and guarded retirement migration:** `AA-R8`, then stop.

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
